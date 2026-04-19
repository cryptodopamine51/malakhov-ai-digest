from __future__ import annotations

from datetime import date

from app.db.models import DigestIssue, DigestIssueType
from app.services.digest import DigestBuilderService


class IssueSnapshotService:
    def __init__(self, digest_builder: DigestBuilderService) -> None:
        self.digest_builder = digest_builder

    async def get_or_build_daily_issue(self, issue_date: date) -> DigestIssue | None:
        issue = await self.digest_builder.get_latest_issue(DigestIssueType.DAILY)
        if issue is not None and issue.issue_date == issue_date:
            return issue
        result = await self.digest_builder.build_daily_issue(issue_date)
        return await self.digest_builder.get_issue(result.issue_id)

    async def get_latest_weekly_issue(self) -> DigestIssue | None:
        return await self.digest_builder.get_latest_issue(DigestIssueType.WEEKLY)
