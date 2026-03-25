from __future__ import annotations

from dataclasses import dataclass
from html import escape


TELEGRAM_MAX_LEN = 3800


@dataclass(frozen=True, slots=True)
class RenderedChunk:
    text: str


class TelegramRenderingService:
    def escape_text(self, value: str | None) -> str:
        return escape(value or "", quote=False)

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
