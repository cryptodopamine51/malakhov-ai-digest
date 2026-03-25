from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class ProcessEventsResult:
    normalized_count: int
    clustered_count: int
    discarded_count: int
    created_events: int
    updated_events: int
