from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from time import monotonic

import httpx

from app.core.config import get_settings
from app.db.models import Event, RawItem

logger = logging.getLogger(__name__)


@dataclass(slots=True)
class EventSummaryPayload:
    title: str
    short_summary: str
    long_summary: str


@dataclass(slots=True)
class LlmUsagePayload:
    pipeline_step: str
    model_name: str
    item_count: int
    latency_ms: int | None
    prompt_tokens: int | None
    completion_tokens: int | None
    total_tokens: int | None
    success: bool
    error_message: str | None = None


@dataclass(slots=True)
class SummaryBuildResult:
    payload: EventSummaryPayload
    llm_used: bool
    usage: LlmUsagePayload | None = None


class RuleBasedSummaryBuilder:
    def build(self, event: Event, raw_items: list[RawItem]) -> EventSummaryPayload:
        source_count = len(raw_items)
        primary_title = event.title
        primary_source = event.primary_source.title if event.primary_source else "основной источник"

        unique_entities: list[str] = []
        seen: set[str] = set()
        for raw_item in raw_items:
            for values in (raw_item.entities_json or {}).values():
                for value in values:
                    lowered = value.lower()
                    if lowered not in seen:
                        seen.add(lowered)
                        unique_entities.append(value)
        entity_snippet = ", ".join(unique_entities[:4]) if unique_entities else "ключевых участников инфоповода"

        source_label = "источником" if source_count == 1 else "источниками"
        related_label = "материал" if source_count == 1 else "материалов"

        short_summary = (
            f"{primary_title}. "
            f"Инфоповод подтвержден {source_count} {source_label}, основной источник — {primary_source}."
        )
        long_summary = (
            f"{primary_title}. "
            f"Событие собрано по {source_count} связанным {related_label}. "
            f"Базовое покрытие дает {primary_source}, дополнительные сигналы связаны с {entity_snippet}."
        )
        return EventSummaryPayload(
            title=primary_title,
            short_summary=short_summary,
            long_summary=long_summary,
        )


class OpenAIRuSummaryClient:
    def __init__(
        self,
        *,
        api_key: str,
        model: str,
        api_base: str,
        timeout_seconds: float,
        http_client: httpx.AsyncClient | None = None,
    ) -> None:
        self.api_key = api_key
        self.model = model
        self.api_base = api_base.rstrip("/")
        self.timeout_seconds = timeout_seconds
        self.http_client = http_client

    async def summarize(self, *, event: Event, raw_items: list[RawItem]) -> tuple[EventSummaryPayload, LlmUsagePayload]:
        payload = self._build_payload(event=event, raw_items=raw_items)
        owned_client = self.http_client is None
        client = self.http_client or httpx.AsyncClient(timeout=self.timeout_seconds)
        started = monotonic()
        try:
            response = await client.post(
                f"{self.api_base}/chat/completions",
                headers={
                    "Authorization": f"Bearer {self.api_key}",
                    "Content-Type": "application/json",
                },
                json=payload,
            )
            response.raise_for_status()
            data = response.json()
            content = data["choices"][0]["message"]["content"]
            parsed = json.loads(content)
            usage = data.get("usage") or {}
            return (
                EventSummaryPayload(
                    title=str(parsed["title"]).strip(),
                    short_summary=str(parsed["short_summary"]).strip(),
                    long_summary=str(parsed["long_summary"]).strip(),
                ),
                LlmUsagePayload(
                    pipeline_step="event_summary",
                    model_name=self.model,
                    item_count=len(raw_items),
                    latency_ms=max(int((monotonic() - started) * 1000), 0),
                    prompt_tokens=usage.get("prompt_tokens"),
                    completion_tokens=usage.get("completion_tokens"),
                    total_tokens=usage.get("total_tokens"),
                    success=True,
                ),
            )
        finally:
            if owned_client:
                await client.aclose()

    def _build_payload(self, *, event: Event, raw_items: list[RawItem]) -> dict[str, object]:
        sources_payload: list[dict[str, object]] = []
        for raw_item in raw_items[:6]:
            sources_payload.append(
                {
                    "source_title": raw_item.source.title if raw_item.source else None,
                    "title": raw_item.normalized_title or raw_item.raw_title,
                    "text": (raw_item.normalized_text or raw_item.raw_text or "")[:2000],
                    "canonical_url": raw_item.canonical_url,
                    "published_at": raw_item.published_at.isoformat() if raw_item.published_at else None,
                    "entities": raw_item.entities_json or {},
                }
            )

        return {
            "model": self.model,
            "response_format": {
                "type": "json_schema",
                "json_schema": {
                    "name": "ru_event_summary",
                    "strict": True,
                    "schema": {
                        "type": "object",
                        "properties": {
                            "title": {"type": "string"},
                            "short_summary": {"type": "string"},
                            "long_summary": {"type": "string"},
                        },
                        "required": ["title", "short_summary", "long_summary"],
                        "additionalProperties": False,
                    },
                },
            },
            "messages": [
                {
                    "role": "system",
                    "content": (
                        "Ты редактор Malakhov AI Digest. "
                        "Пиши только на русском языке, деловым и кратким стилем. "
                        "Не выдумывай факты. "
                        "Верни JSON с полями title, short_summary, long_summary. "
                        "title: короткий русский заголовок события. "
                        "short_summary: 1-2 предложения для карточки. "
                        "long_summary: 2-4 предложения без воды."
                    ),
                },
                {
                    "role": "user",
                    "content": json.dumps(
                        {
                            "event_title": event.title,
                            "primary_source": event.primary_source.title if event.primary_source else None,
                            "raw_items": sources_payload,
                        },
                        ensure_ascii=False,
                    ),
                },
            ],
        }


class SummaryBuilder:
    def __init__(
        self,
        *,
        llm_client: OpenAIRuSummaryClient | None = None,
        fallback_builder: RuleBasedSummaryBuilder | None = None,
    ) -> None:
        settings = get_settings()
        self.fallback_builder = fallback_builder or RuleBasedSummaryBuilder()
        self.llm_client = llm_client
        if self.llm_client is None and settings.openai_summary_enabled and settings.openai_api_key:
            self.llm_client = OpenAIRuSummaryClient(
                api_key=settings.openai_api_key,
                model=settings.openai_summary_model,
                api_base=settings.openai_api_base,
                timeout_seconds=settings.openai_summary_timeout_seconds,
            )

    async def build(self, event: Event, raw_items: list[RawItem], *, use_llm: bool = True) -> SummaryBuildResult:
        if self.llm_client is None or not use_llm:
            return SummaryBuildResult(
                payload=self.fallback_builder.build(event, raw_items),
                llm_used=False,
            )
        try:
            payload, usage = await self.llm_client.summarize(event=event, raw_items=raw_items)
            if payload.title and payload.short_summary and payload.long_summary:
                return SummaryBuildResult(payload=payload, llm_used=True, usage=usage)
        except Exception as exc:
            logger.exception("openai ru summary failed; falling back to rule-based summary")
            if self.llm_client is not None:
                return SummaryBuildResult(
                    payload=self.fallback_builder.build(event, raw_items),
                    llm_used=False,
                    usage=LlmUsagePayload(
                        pipeline_step="event_summary",
                        model_name=self.llm_client.model,
                        item_count=len(raw_items),
                        latency_ms=None,
                        prompt_tokens=None,
                        completion_tokens=None,
                        total_tokens=None,
                        success=False,
                        error_message=str(exc),
                    ),
                )
        return SummaryBuildResult(
            payload=self.fallback_builder.build(event, raw_items),
            llm_used=False,
        )
