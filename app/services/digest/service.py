from __future__ import annotations

from datetime import date, timedelta

from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker
from sqlalchemy.orm import selectinload

from app.db.models import (
    AlphaEntry,
    AlphaEntryStatus,
    DigestIssue,
    DigestIssueItem,
    DigestIssueStatus,
    DigestIssueType,
    DigestSection,
    Event,
    EventCategory,
    EventSection,
)
from app.services.alpha import AlphaService
from app.services.digest.schemas import BuildIssueRequest, IssueBuildResult
from app.services.digest.texts import EMPTY_ALPHA_TEXT, EMPTY_GENERIC_TEXT, EMPTY_INVESTMENTS_TEXT, EMPTY_WEEKLY_TEXT


class DigestBuilderService:
    def __init__(self, session_factory: async_sessionmaker[AsyncSession]) -> None:
        self.session_factory = session_factory
        self.alpha_service = AlphaService(session_factory)

    async def build_daily_issue(self, issue_date: date) -> IssueBuildResult:
        request = BuildIssueRequest(
            issue_type=DigestIssueType.DAILY,
            issue_date=issue_date,
            period_start=issue_date,
            period_end=issue_date,
            title=f"Malakhov AI Digest — {issue_date.isoformat()}",
        )
        return await self._build_issue(request)

    async def build_weekly_issue(self, issue_date: date) -> IssueBuildResult:
        period_end = issue_date
        period_start = issue_date - timedelta(days=6)
        request = BuildIssueRequest(
            issue_type=DigestIssueType.WEEKLY,
            issue_date=issue_date,
            period_start=period_start,
            period_end=period_end,
            title=f"Malakhov AI Digest — Weekly — {period_start.isoformat()} to {period_end.isoformat()}",
        )
        return await self._build_issue(request)

    async def _build_issue(self, request: BuildIssueRequest) -> IssueBuildResult:
        async with self.session_factory() as session:
            existing = await session.scalar(
                select(DigestIssue)
                .where(
                    DigestIssue.issue_type == request.issue_type,
                    DigestIssue.issue_date == request.issue_date,
                )
                .options(selectinload(DigestIssue.items))
            )
            if existing is not None:
                return IssueBuildResult(
                    issue_id=existing.id,
                    issue_type=existing.issue_type,
                    issue_date=existing.issue_date,
                    status=existing.status,
                    reused_snapshot=True,
                )

            issue = DigestIssue(
                issue_type=request.issue_type,
                issue_date=request.issue_date,
                period_start=request.period_start,
                period_end=request.period_end,
                title=request.title,
                status=DigestIssueStatus.DRAFT,
            )
            session.add(issue)
            await session.flush()

            events = await self._load_events(
                session=session,
                start=request.period_start,
                end=request.period_end,
            )
            alpha_entries = await self._load_alpha_entries(
                session=session,
                start=request.period_start,
                end=request.period_end,
            )
            items = self._build_issue_items(issue_type=request.issue_type, events=events, alpha_entries=alpha_entries)
            for item in items:
                item.issue_id = issue.id
                session.add(item)
            issue.status = DigestIssueStatus.READY
            await session.commit()

            return IssueBuildResult(
                issue_id=issue.id,
                issue_type=issue.issue_type,
                issue_date=issue.issue_date,
                status=issue.status,
                reused_snapshot=False,
            )

    async def get_latest_issue(self, issue_type: DigestIssueType) -> DigestIssue | None:
        async with self.session_factory() as session:
            return await session.scalar(
                select(DigestIssue)
                .where(DigestIssue.issue_type == issue_type, DigestIssue.status.in_([DigestIssueStatus.READY, DigestIssueStatus.SENT]))
                .order_by(DigestIssue.issue_date.desc(), DigestIssue.id.desc())
                .options(selectinload(DigestIssue.items))
            )

    async def get_issue(self, issue_id: int) -> DigestIssue | None:
        async with self.session_factory() as session:
            return await session.scalar(
                select(DigestIssue)
                .where(DigestIssue.id == issue_id)
                .options(selectinload(DigestIssue.items))
            )

    async def list_issues(
        self,
        *,
        issue_type: DigestIssueType | None = None,
        issue_date: date | None = None,
        limit: int = 20,
    ) -> list[DigestIssue]:
        async with self.session_factory() as session:
            stmt = select(DigestIssue).options(selectinload(DigestIssue.items)).order_by(DigestIssue.issue_date.desc(), DigestIssue.id.desc()).limit(limit)
            if issue_type is not None:
                stmt = stmt.where(DigestIssue.issue_type == issue_type)
            if issue_date is not None:
                stmt = stmt.where(DigestIssue.issue_date == issue_date)
            return list((await session.scalars(stmt)).all())

    async def mark_issue_sent(self, issue_id: int) -> None:
        async with self.session_factory() as session:
            issue = await session.get(DigestIssue, issue_id)
            if issue is None:
                return
            issue.status = DigestIssueStatus.SENT
            await session.commit()

    async def get_section_items(self, issue_id: int, section: DigestSection) -> list[DigestIssueItem]:
        async with self.session_factory() as session:
            return list(
                (
                    await session.scalars(
                        select(DigestIssueItem)
                        .where(DigestIssueItem.issue_id == issue_id, DigestIssueItem.section == section)
                        .order_by(DigestIssueItem.rank_order.asc(), DigestIssueItem.id.asc())
                    )
                ).all()
            )

    async def _load_events(self, session: AsyncSession, start: date, end: date) -> list[Event]:
        return list(
            (
                await session.scalars(
                    select(Event)
                    .where(and_(Event.event_date >= start, Event.event_date <= end))
                    .options(selectinload(Event.categories), selectinload(Event.tags))
                    .order_by(Event.event_date.desc(), Event.importance_score.desc(), Event.id.desc())
                )
            ).all()
        )

    async def _load_alpha_entries(self, session: AsyncSession, start: date, end: date) -> list[AlphaEntry]:
        return list(
            (
                await session.scalars(
                    select(AlphaEntry)
                    .where(
                        and_(
                            AlphaEntry.status == AlphaEntryStatus.PUBLISHED,
                            AlphaEntry.publish_date >= start,
                            AlphaEntry.publish_date <= end,
                        )
                    )
                    .order_by(AlphaEntry.publish_date.desc(), AlphaEntry.priority_rank.asc(), AlphaEntry.id.asc())
                )
            ).all()
        )

    def _build_issue_items(self, *, issue_type: DigestIssueType, events: list[Event], alpha_entries: list[AlphaEntry]) -> list[DigestIssueItem]:
        if issue_type is DigestIssueType.DAILY:
            return self._build_daily_items(events, alpha_entries)
        return self._build_weekly_items(events, alpha_entries)

    def _build_daily_items(self, events: list[Event], alpha_entries: list[AlphaEntry]) -> list[DigestIssueItem]:
        items: list[DigestIssueItem] = []
        items.extend(self._section_snapshot(DigestSection.IMPORTANT, self._top_important(events), primary=True))
        items.extend(self._section_snapshot(DigestSection.AI_NEWS, self._top_by_section(events, EventSection.AI_NEWS, "ai_news_score", limit=5)))
        items.extend(self._section_snapshot(DigestSection.CODING, self._top_by_section(events, EventSection.CODING, "coding_score", limit=5)))
        items.extend(self._section_snapshot(DigestSection.INVESTMENTS, self._top_by_section(events, EventSection.INVESTMENTS, "investment_score", limit=4)))
        items.extend(self._section_snapshot(DigestSection.ALL, self._top_all(events)))
        items.extend(self._alpha_snapshot(alpha_entries))
        return items

    def _build_weekly_items(self, events: list[Event], alpha_entries: list[AlphaEntry]) -> list[DigestIssueItem]:
        top_events = sorted(events, key=lambda event: (event.importance_score, event.confidence_score), reverse=True)[:7]
        if not top_events:
            items = [
                DigestIssueItem(
                    section=DigestSection.ALL,
                    event_id=None,
                    alpha_entry_id=None,
                    rank_order=1,
                    card_title="Итоги недели",
                    card_text=EMPTY_WEEKLY_TEXT,
                    card_links_json=[],
                    is_primary_block=True,
                )
            ]
            items.extend(self._alpha_snapshot(alpha_entries))
            return items

        items: list[DigestIssueItem] = []
        for index, event in enumerate(top_events, start=1):
            items.append(self._snapshot_item(DigestSection.ALL, event, index, primary=index == 1))
        for index, entry in enumerate(alpha_entries, start=len(items) + 1):
            items.append(self._alpha_item(entry, DigestSection.ALL, index))
        items.extend(self._alpha_snapshot(alpha_entries))
        return items

    def _top_important(self, events: list[Event]) -> list[Event]:
        return sorted(events, key=lambda event: (event.importance_score, event.market_impact_score, event.confidence_score), reverse=True)[:5]

    def _top_all(self, events: list[Event]) -> list[Event]:
        return sorted(events, key=lambda event: (event.importance_score, event.confidence_score), reverse=True)[:10]

    def _top_by_section(self, events: list[Event], section: EventSection, score_field: str, limit: int) -> list[Event]:
        relevant = [
            event
            for event in events
            if any(category.section == section for category in event.categories)
        ]
        return sorted(relevant, key=lambda event: (getattr(event, score_field), event.confidence_score), reverse=True)[:limit]

    def _section_snapshot(self, section: DigestSection, events: list[Event], primary: bool = False) -> list[DigestIssueItem]:
        if not events:
            return [self._empty_section_item(section)]
        return [
            self._snapshot_item(section, event, index, primary=primary and index == 1)
            for index, event in enumerate(events, start=1)
        ]

    def _snapshot_item(self, section: DigestSection, event: Event, index: int, primary: bool = False) -> DigestIssueItem:
        return DigestIssueItem(
            section=section,
            event_id=event.id,
            alpha_entry_id=None,
            rank_order=index,
            card_title=event.title,
            card_text=event.short_summary or event.long_summary or event.title,
            card_links_json=[event.primary_source_url] if event.primary_source_url else [],
            is_primary_block=primary,
        )

    def _empty_section_item(self, section: DigestSection) -> DigestIssueItem:
        text = EMPTY_GENERIC_TEXT
        if section is DigestSection.ALPHA:
            text = EMPTY_ALPHA_TEXT
        elif section is DigestSection.INVESTMENTS:
            text = EMPTY_INVESTMENTS_TEXT
        return DigestIssueItem(
            section=section,
            event_id=None,
            alpha_entry_id=None,
            rank_order=1,
            card_title=self._section_title(section),
            card_text=text,
            card_links_json=[],
            is_primary_block=True,
        )

    def _alpha_snapshot(self, alpha_entries: list[AlphaEntry]) -> list[DigestIssueItem]:
        if not alpha_entries:
            return [self._empty_section_item(DigestSection.ALPHA)]
        return [self._alpha_item(entry, DigestSection.ALPHA, index) for index, entry in enumerate(alpha_entries, start=1)]

    def _alpha_item(self, entry: AlphaEntry, section: DigestSection, rank_order: int) -> DigestIssueItem:
        return DigestIssueItem(
            section=section,
            event_id=entry.event_id,
            alpha_entry_id=entry.id,
            rank_order=rank_order,
            card_title=entry.title,
            card_text=entry.body_short,
            card_links_json=entry.source_links_json or [],
            is_primary_block=rank_order == 1,
        )

    def _section_title(self, section: DigestSection) -> str:
        titles = {
            DigestSection.IMPORTANT: "Важное",
            DigestSection.AI_NEWS: "Новости ИИ",
            DigestSection.CODING: "Кодинг",
            DigestSection.INVESTMENTS: "Инвестиции",
            DigestSection.ALPHA: "Альфа",
            DigestSection.ALL: "Все за день",
        }
        return titles[section]
