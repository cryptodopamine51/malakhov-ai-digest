from __future__ import annotations

from dataclasses import dataclass
from datetime import date

from app.db.models import DigestIssueStatus, DigestIssueType, DigestSection


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
