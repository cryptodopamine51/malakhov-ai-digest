from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class NormalizationResult:
    normalized_title: str | None
    normalized_text: str | None
    language: str | None
    entities: dict[str, list[str]]
    outbound_links: list[str]
    discarded: bool
    discard_reason: str | None = None
