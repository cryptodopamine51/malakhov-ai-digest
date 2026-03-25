from __future__ import annotations

from dataclasses import dataclass
from datetime import date

from app.db.models import DigestIssueItem, DigestIssueStatus, DigestIssueType, DigestSection


@dataclass(frozen=True, slots=True)
class BuildIssueRequest:
    issue_type: DigestIssueType
    issue_date: date
    period_start: date
    period_end: date
    title: str


@dataclass(frozen=True, slots=True)
class RenderedMessage:
    text: str
    section: DigestSection | None = None


@dataclass(frozen=True, slots=True)
class IssueBuildResult:
    issue_id: int
    issue_type: DigestIssueType
    issue_date: date
    status: DigestIssueStatus
    reused_snapshot: bool


@dataclass(frozen=True, slots=True)
class DailyMainSuppression:
    item_id: int
    event_id: int | None
    source_section: DigestSection
    shown_in_section: DigestSection
    reason: str


@dataclass(frozen=True, slots=True)
class DailyMainPreview:
    visible_by_section: dict[DigestSection, list[DigestIssueItem]]
    suppressed: list[DailyMainSuppression]


@dataclass(frozen=True, slots=True)
class IssueSelectionDebug:
    selected_event_ids_by_section: dict[DigestSection, list[int]]
    suppressed_by_section: dict[DigestSection, list[DailyMainSuppression]]
