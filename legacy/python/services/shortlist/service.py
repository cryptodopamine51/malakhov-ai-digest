from __future__ import annotations

from collections import Counter
from datetime import datetime

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.datetime import ensure_utc
from app.db.models import RawItem, RawItemStatus
from app.services.normalization.utils import clean_text
from app.services.shortlist.policy import RawShortlistPolicy, get_raw_shortlist_policy, normalize_candidate_url, utc_now
from app.services.shortlist.schemas import RawItemShortlistBatchResult, RawItemShortlistDecision
from app.services.sources import should_source_be_active


class RawItemShortlistService:
    def __init__(self, policy: RawShortlistPolicy | None = None) -> None:
        self.policy = policy or get_raw_shortlist_policy()

    async def evaluate_batch(self, *, session: AsyncSession, raw_items: list[RawItem]) -> RawItemShortlistBatchResult:
        if not raw_items:
            return RawItemShortlistBatchResult(
                decisions=[],
                evaluated_count=0,
                accepted_count=0,
                rejected_count=0,
                reject_breakdown={},
            )

        current_ids = [item.id for item in raw_items]
        duplicate_cutoff = utc_now() - self.policy.duplicate_recent_delta
        existing_rows = (
            await session.execute(
                select(
                    RawItem.id,
                    RawItem.canonical_url,
                ).where(
                    RawItem.id.not_in(current_ids),
                    RawItem.status != RawItemStatus.FETCHED,
                    or_(
                        RawItem.published_at >= duplicate_cutoff,
                        RawItem.fetched_at >= duplicate_cutoff,
                    ),
                )
            )
        ).all()
        existing_normalized_urls = {
            normalized
            for _, url in existing_rows
            for normalized in [normalize_candidate_url(url)]
            if normalized
        }

        decisions: list[RawItemShortlistDecision] = []
        seen_batch_urls: set[str] = set()
        reject_breakdown: Counter[str] = Counter()
        accepted_count = 0

        for raw_item in raw_items:
            decision = self._evaluate_one(
                raw_item=raw_item,
                existing_normalized_urls=existing_normalized_urls,
                seen_batch_urls=seen_batch_urls,
            )
            decisions.append(decision)
            if decision.accepted:
                accepted_count += 1
                normalized_url = decision.signals.get("normalized_url")
                if isinstance(normalized_url, str):
                    seen_batch_urls.add(normalized_url)
            else:
                for reason in decision.reasons:
                    if reason.startswith("passed_"):
                        continue
                    reject_breakdown[reason] += 1

        return RawItemShortlistBatchResult(
            decisions=decisions,
            evaluated_count=len(decisions),
            accepted_count=accepted_count,
            rejected_count=len(decisions) - accepted_count,
            reject_breakdown=dict(sorted(reject_breakdown.items())),
        )

    def _evaluate_one(
        self,
        *,
        raw_item: RawItem,
        existing_normalized_urls: set[str],
        seen_batch_urls: set[str],
    ) -> RawItemShortlistDecision:
        now = utc_now()
        source = raw_item.source
        title = clean_text(raw_item.raw_title)
        text = clean_text(raw_item.raw_text)
        normalized_url = normalize_candidate_url(raw_item.canonical_url)
        published_at = raw_item.published_at or raw_item.fetched_at
        age_hours = round((now - ensure_utc(published_at)).total_seconds() / 3600, 3) if published_at else None
        title_tokens = len(title.split()) if title else 0
        reasons: list[str] = []

        source_ok = source is not None and should_source_be_active(status=source.status, is_active=source.is_active)
        if not source_ok:
            reasons.append("source_not_effectively_active")
        else:
            reasons.append("passed_source_check")

        if published_at is None or title is None or normalized_url is None:
            reasons.append("missing_required_fields")

        if published_at is None or ensure_utc(published_at) < now - self.policy.max_age_delta:
            reasons.append("stale_item")
        else:
            reasons.append("passed_recency_check")

        if normalized_url and (normalized_url in existing_normalized_urls or normalized_url in seen_batch_urls):
            reasons.append("duplicate_url")

        if title is None or len(title) < self.policy.min_title_length or title_tokens < self.policy.min_title_tokens:
            reasons.append("weak_title")

        if text is None or len(text) < self.policy.min_text_length:
            reasons.append("insufficient_text")

        accepted = not any(
            reason
            for reason in reasons
            if reason
            in {
                "source_not_effectively_active",
                "missing_required_fields",
                "stale_item",
                "duplicate_url",
                "weak_title",
                "insufficient_text",
            }
        )
        if accepted:
            reasons.append("passed_quality_gate")

        return RawItemShortlistDecision(
            raw_item_id=raw_item.id,
            accepted=accepted,
            reasons=reasons,
            signals={
                "source_status": source.status.value if source is not None else None,
                "source_is_active": source.is_active if source is not None else None,
                "canonical_url": raw_item.canonical_url,
                "normalized_url": normalized_url,
                "age_hours": age_hours,
                "title_length": len(title) if title else 0,
                "title_token_count": title_tokens,
                "text_length": len(text) if text else 0,
            },
        )
