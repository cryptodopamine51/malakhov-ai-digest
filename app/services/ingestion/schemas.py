from __future__ import annotations

from dataclasses import dataclass, field

from app.db.models import SourceRunStatus


@dataclass(slots=True)
class SourceIngestionResult:
    source_id: int
    status: SourceRunStatus
    fetched_count: int
    inserted_count: int
    error_message: str | None = None
    warnings: list[str] = field(default_factory=list)


@dataclass(slots=True)
class BatchIngestionResult:
    results: list[SourceIngestionResult]

    @property
    def total_fetched(self) -> int:
        return sum(result.fetched_count for result in self.results)

    @property
    def total_inserted(self) -> int:
        return sum(result.inserted_count for result in self.results)
