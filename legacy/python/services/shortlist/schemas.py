from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class RawItemShortlistDecision:
    raw_item_id: int
    accepted: bool
    reasons: list[str]
    signals: dict[str, object]


@dataclass(frozen=True, slots=True)
class RawItemShortlistBatchResult:
    decisions: list[RawItemShortlistDecision]
    evaluated_count: int
    accepted_count: int
    rejected_count: int
    reject_breakdown: dict[str, int]
