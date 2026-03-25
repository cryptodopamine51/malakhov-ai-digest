from __future__ import annotations

from dataclasses import dataclass

from app.db.models import EventSection, EventTagType


@dataclass(frozen=True, slots=True)
class ClassifiedCategory:
    section: EventSection
    score: float
    is_primary_section: bool = False


@dataclass(frozen=True, slots=True)
class ClassifiedTag:
    tag: str
    tag_type: EventTagType
