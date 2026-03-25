from __future__ import annotations

from dataclasses import dataclass


PUBLIC_SECTIONS: tuple[str, ...] = (
    "important",
    "ai_news",
    "coding",
    "investments",
    "alpha",
)


@dataclass(frozen=True, slots=True)
class EditorialGuidance:
    priority_order: tuple[str, ...]
    summary_length_hint: str
    dedup_principle: str
    source_link_policy: str
    section_bias_policy: str


EDITORIAL_GUIDANCE = EditorialGuidance(
    priority_order=(
        "official sources",
        "engineering sources",
        "respected media",
        "local media",
    ),
    summary_length_hint="future summaries should fit into 2-5 lines",
    dedup_principle="one event should become one future card",
    source_link_policy="source links must be preserved through the pipeline",
    section_bias_policy="section_bias from source seeds is advisory metadata, not final truth",
)
