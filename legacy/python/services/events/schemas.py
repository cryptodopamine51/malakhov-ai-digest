from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class ProcessEventsResult:
    raw_items_considered: int
    normalized_count: int
    clustered_count: int
    discarded_count: int
    created_events: int
    updated_events: int
    clusters_merged: int
    ambiguous_count: int
    shortlist_count: int
    llm_event_count: int
    raw_shortlist_evaluated_count: int = 0
    raw_shortlist_accepted_count: int = 0
    raw_shortlist_rejected_count: int = 0
    raw_shortlist_reject_breakdown: dict[str, int] | None = None
    process_run_id: int | None = None
