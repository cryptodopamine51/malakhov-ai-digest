from __future__ import annotations

from dataclasses import dataclass
from html import escape
import re


TELEGRAM_MAX_LEN = 3800
HEADLINE_MAX_LEN = 90
SUMMARY_MAX_LEN = 220

_SPACE_RE = re.compile(r"\s+")
_URL_RE = re.compile(r"https?://\S+")
_DATE_RE = re.compile(r"\b\d{1,2}\s+[А-Яа-яЁё]+\s+\d{4}\s+года\b")
_LEAD_PATTERNS = [
    re.compile(
        r"^[^.]{0,120}\sопубликовал[а-я]*\s(?:блог-пост|пост|материал|запись|анонс)?\s*(?:о|про)\s+",
        re.IGNORECASE,
    ),
    re.compile(
        r"^[^.]{0,120}\sпредставил[а-я]*\s(?:новый|новую|новые)?\s*",
        re.IGNORECASE,
    ),
    re.compile(
        r"^[^.]{0,120}\sвыпустил[а-я]*\s(?:новый|новую|новые)?\s*",
        re.IGNORECASE,
    ),
    re.compile(
        r"^[^.]{0,120}\sобъявил[а-я]*\s(?:о|про)\s+",
        re.IGNORECASE,
    ),
]


@dataclass(frozen=True, slots=True)
class RenderedChunk:
    text: str


class TelegramRenderingService:
    def escape_text(self, value: str | None) -> str:
        return escape(value or "", quote=False)

    def escape_attr(self, value: str | None) -> str:
        return escape(value or "", quote=True)

    def normalize_text(self, value: str | None) -> str:
        collapsed = _SPACE_RE.sub(" ", value or "").strip()
        return collapsed

    def trim_text(self, value: str | None, limit: int) -> str:
        normalized = self.normalize_text(value)
        if len(normalized) <= limit:
            return normalized
        trimmed = normalized[:limit].rstrip()
        split_at = max(trimmed.rfind(" "), trimmed.rfind("—"), trimmed.rfind("-"), trimmed.rfind(","))
        if split_at > 40:
            trimmed = trimmed[:split_at].rstrip()
        return f"{trimmed}…"

    def compact_headline(self, value: str | None) -> str:
        return self.trim_text(value, HEADLINE_MAX_LEN)

    def compact_summary(self, value: str | None, *, section_title: str) -> str:
        text = self.normalize_text(value)
        text = _URL_RE.sub("", text)
        text = _DATE_RE.sub("", text)
        for pattern in _LEAD_PATTERNS:
            updated = pattern.sub("", text).strip()
            if updated != text:
                text = updated
                break
        text = text.replace("  ", " ").strip(" .")
        if text.lower().startswith("новом "):
            text = f"Новый {text[6:]}"
        elif text.lower().startswith("новая "):
            text = f"Новая {text[6:]}"
        elif text.lower().startswith("новые "):
            text = f"Новые {text[6:]}"
        if text:
            text = text[0].upper() + text[1:]
        if text and not re.search(r"[.!?]$", text):
            text = f"{text}."

        if text and text.count(".") < 2:
            significance = {
                "Важное": "Это стоит держать в фокусе рынка и продуктовой повестки.",
                "Новости ИИ": "Это помогает понять, куда сейчас двигается AI-рынок.",
                "Кодинг": "Это полезно как ориентир для инструментов и AI-workflow разработчиков.",
                "Инвестиции": "Это сигнал для оценки интереса капитала и движения в секторе.",
                "Альфа": "Это можно держать в фокусе как авторский сигнал.",
                "Все за день": "Это один из заметных сигналов дня.",
            }.get(section_title)
            if significance and significance.lower() not in text.lower():
                text = f"{text} {significance}"

        return self.trim_text(text or value or "", SUMMARY_MAX_LEN)

    def format_source_links(self, links: list[str]) -> str:
        unique_links: list[str] = []
        seen: set[str] = set()
        for link in links:
            if link and link not in seen:
                seen.add(link)
                unique_links.append(link)
        if not unique_links:
            return ""
        if len(unique_links) == 1:
            href = self.escape_attr(unique_links[0])
            return f'<a href="{href}">Источник</a>'
        linked = " · ".join(
            f'<a href="{self.escape_attr(link)}">{index}</a>'
            for index, link in enumerate(unique_links[:3], start=1)
        )
        return f"Источники: {linked}"

    def chunk_blocks(self, header: str, blocks: list[str], max_length: int = TELEGRAM_MAX_LEN) -> list[str]:
        chunks: list[str] = []
        header = header.strip()
        current = header
        for block in blocks:
            candidate = f"{current}\n\n{block}".strip()
            if len(candidate) <= max_length:
                current = candidate
                continue

            if current and current != header:
                chunks.append(current)
            if len(block) <= max_length:
                current = f"{header}\n\n{block}".strip() if not chunks else block
                continue

            split_max_length = max_length
            if not chunks and current == header:
                split_max_length = max(1, max_length - len(f"{header}\n\n"))
            split_chunks = self._split_long_block(block, split_max_length)
            if not chunks and current == header:
                split_chunks[0] = f"{header}\n\n{split_chunks[0]}".strip()
            chunks.extend(split_chunks[:-1])
            current = split_chunks[-1]

        if current:
            chunks.append(current)
        return chunks

    def _split_long_block(self, block: str, max_length: int) -> list[str]:
        parts: list[str] = []
        remaining = block
        while len(remaining) > max_length:
            split_at = remaining.rfind("\n", 0, max_length)
            if split_at <= 0:
                split_at = remaining.rfind(" ", 0, max_length)
            if split_at <= 0:
                split_at = max_length
            parts.append(remaining[:split_at].rstrip())
            remaining = remaining[split_at:].lstrip()
        if remaining:
            parts.append(remaining)
        return parts
