from __future__ import annotations

from dataclasses import dataclass
from datetime import date

from app.db.models import AlphaEntryStatus


@dataclass(frozen=True, slots=True)
class AlphaEntryCreate:
    title: str
    body_short: str
    body_long: str | None
    source_links_json: list[str]
    event_id: int | None
    priority_rank: int
    publish_date: date
    status: AlphaEntryStatus
    created_by: str | None


@dataclass(frozen=True, slots=True)
class AlphaEntryUpdate:
    title: str | None = None
    body_short: str | None = None
    body_long: str | None = None
    source_links_json: list[str] | None = None
    event_id: int | None = None
    priority_rank: int | None = None
    publish_date: date | None = None
    status: AlphaEntryStatus | None = None
    created_by: str | None = None
