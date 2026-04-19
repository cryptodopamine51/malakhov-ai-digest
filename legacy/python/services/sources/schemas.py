from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Any


@dataclass(slots=True)
class FetchedItem:
    external_id: str
    published_at: datetime | None
    canonical_url: str
    title: str
    text: str | None
    author_name: str | None
    language: str | None
    payload: dict[str, Any] = field(default_factory=dict)


@dataclass(slots=True)
class FetchResult:
    items: list[FetchedItem]
    warnings: list[str] = field(default_factory=list)
