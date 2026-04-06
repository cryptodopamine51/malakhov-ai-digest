from __future__ import annotations

from datetime import date, timedelta
import re

from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker
from sqlalchemy.orm import selectinload

from app.core.logging import log_structured
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
    EventTagType,
)
from app.services.alpha import AlphaService
from app.services.digest.schemas import (
    BuildIssueRequest,
    DailyMainPreview,
    DailyMainSuppression,
    IssueBuildResult,
    IssueSelectionDebug,
    TelegramSelectionDecision,
)
from app.services.digest.telegram_policy import TelegramPackageSection, get_telegram_packaging_policy
from app.services.russia import qualifies_for_ai_russia_event
from app.services.digest.texts import EMPTY_ALPHA_TEXT, EMPTY_GENERIC_TEXT, EMPTY_INVESTMENTS_TEXT, EMPTY_WEEKLY_TEXT
from app.services.sources.reputation import score_event_source_quality
import logging

DAILY_MAIN_SECTION_ORDER = (
    TelegramPackageSection.MODELS_SERVICES,
    TelegramPackageSection.TOOLS_CODING,
    TelegramPackageSection.INVESTMENTS_MARKET,
    TelegramPackageSection.AI_RUSSIA,
    TelegramPackageSection.ALPHA,
)
_SENTENCE_SPLIT_RE = re.compile(r"(?<=[.!?])\s+")
logger = logging.getLogger(__name__)
MIN_TELEGRAM_ITEMS = 3
TELEGRAM_TIER3_FLOOR = 33.0


class DigestBuilderService:
    def __init__(self, session_factory: async_sessionmaker[AsyncSession]) -> None:
        self.session_factory = session_factory
        self.alpha_service = AlphaService(session_factory)
        self.telegram_policy = get_telegram_packaging_policy()

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

            preview = self._daily_main_preview_from_items(items, events=events) if request.issue_type is DigestIssueType.DAILY else None
            selection_debug = self._issue_selection_debug(items, preview)
            telegram_selected = []
            telegram_candidates_considered = 0
            telegram_after_filtering = 0
            telegram_excluded_reasons: dict[str, int] = {}
            telegram_relaxed_mode = False
            if preview is not None:
                telegram_selected = [
                    item.event_id
                    for visible_items in preview.visible_by_section.values()
                    for item in visible_items
                    if item.event_id is not None
                ]
                telegram_candidates_considered = int(preview.policy_snapshot.get("candidates_considered") or 0)
                telegram_after_filtering = int(preview.policy_snapshot.get("events_after_filtering") or 0)
                telegram_excluded_reasons = dict(preview.policy_snapshot.get("excluded_reasons") or {})
                telegram_relaxed_mode = bool(preview.policy_snapshot.get("relaxed_mode"))
            log_structured(
                logger,
                "issue_built",
                issue_id=issue.id,
                issue_type=issue.issue_type.value,
                issue_date=issue.issue_date.isoformat(),
                period_start=issue.period_start.isoformat(),
                period_end=issue.period_end.isoformat(),
                events_considered=len(events),
                shortlist_count=sum(1 for event in events if self._signal_score(event) >= 45),
                section_counts=self._section_counts(items),
                selected_event_ids_by_section={
                    section.value: event_ids for section, event_ids in selection_debug.selected_event_ids_by_section.items()
                },
                suppressed_duplicates=[
                    {
                        "event_id": suppression.event_id,
                        "source_section": suppression.source_section.value,
                        "shown_in_section": suppression.shown_in_section.value,
                        "reason": suppression.reason,
                    }
                    for suppressions in selection_debug.suppressed_by_section.values()
                    for suppression in suppressions
                ],
                telegram_total_events_available=len(events),
                telegram_candidates_considered=telegram_candidates_considered,
                telegram_events_after_filtering=telegram_after_filtering,
                telegram_selected_event_ids=telegram_selected,
                telegram_excluded_reasons=telegram_excluded_reasons,
                telegram_relaxed_mode=telegram_relaxed_mode,
                suppressed_duplicate_count=len(preview.suppressed) if preview is not None else 0,
                weak_day_mode=self._is_weak_day(events),
            )

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

    async def get_issue_by_type_and_date(self, issue_type: DigestIssueType, issue_date: date) -> DigestIssue | None:
        async with self.session_factory() as session:
            return await session.scalar(
                select(DigestIssue)
                .where(
                    DigestIssue.issue_type == issue_type,
                    DigestIssue.issue_date == issue_date,
                    DigestIssue.status.in_([DigestIssueStatus.READY, DigestIssueStatus.SENT]),
                )
                .order_by(DigestIssue.id.desc())
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

    async def get_daily_main_preview(self, issue_id: int) -> DailyMainPreview | None:
        async with self.session_factory() as session:
            issue = await session.scalar(
                select(DigestIssue)
                .where(DigestIssue.id == issue_id)
                .options(
                    selectinload(DigestIssue.items)
                    .selectinload(DigestIssueItem.event)
                    .selectinload(Event.categories),
                    selectinload(DigestIssue.items)
                    .selectinload(DigestIssueItem.event)
                    .selectinload(Event.tags),
                    selectinload(DigestIssue.items)
                    .selectinload(DigestIssueItem.event)
                    .selectinload(Event.primary_source),
                )
            )
        if issue is None or issue.issue_type is not DigestIssueType.DAILY:
            return None
        event_map = {
            item.event_id: item.event
            for item in issue.items
            if item.event_id is not None and item.event is not None
        }
        return self._daily_main_preview_from_items(issue.items, events=list(event_map.values()))

    def _daily_main_preview_from_items(self, items: list[DigestIssueItem], *, events: list[Event]) -> DailyMainPreview:
        strict_candidates = self._telegram_candidates_from_items(items, events, broaden_pool=False)
        strict_preview, strict_meta = self._select_telegram_items(strict_candidates, relaxed=False)
        preview_payload = strict_preview
        preview_meta = strict_meta
        if strict_meta["selected_count"] < MIN_TELEGRAM_ITEMS:
            relaxed_candidates = self._telegram_candidates_from_items(items, events, broaden_pool=True)
            relaxed_preview, relaxed_meta = self._select_telegram_items(relaxed_candidates, relaxed=True)
            if relaxed_meta["selected_count"] >= MIN_TELEGRAM_ITEMS or relaxed_meta["selected_count"] > strict_meta["selected_count"]:
                preview_payload = relaxed_preview
                preview_meta = relaxed_meta

        visible = preview_payload["visible"]
        suppressed = preview_payload["suppressed"]
        excluded = preview_payload["excluded"]

        alpha_items = sorted(
            [item for item in items if item.section is DigestSection.ALPHA],
            key=lambda item: (item.rank_order, item.id),
        )
        if alpha_items and not self._is_empty_section(alpha_items):
            visible[TelegramPackageSection.ALPHA] = alpha_items[:1]

        excluded_reason_counts: dict[str, int] = {}
        for decision in excluded:
            excluded_reason_counts[decision.reason] = excluded_reason_counts.get(decision.reason, 0) + 1

        return DailyMainPreview(
            visible_by_section=visible,
            suppressed=suppressed,
            excluded=excluded,
            policy_snapshot={
                "min_ranking_score": self.telegram_policy.min_ranking_score,
                "fallback_min_score": self.telegram_policy.fallback_min_score,
                "effective_threshold": preview_meta["threshold"],
                "total_cap": preview_meta["total_cap"],
                "section_caps": {section.value: cap for section, cap in self.telegram_policy.section_caps.items()},
                "weak_day_mode": preview_meta["weak_day_mode"],
                "relaxed_mode": preview_meta["relaxed_mode"],
                "min_telegram_items": MIN_TELEGRAM_ITEMS,
                "total_events_available": len(events),
                "candidates_considered": preview_meta["candidates_considered"],
                "events_after_filtering": preview_meta["after_filtering_count"],
                "selected_for_telegram": preview_meta["selected_event_ids"],
                "excluded_reasons": excluded_reason_counts,
            },
        )

    def _select_telegram_items(
        self,
        candidates: list[dict[str, object]],
        *,
        relaxed: bool,
    ) -> tuple[dict[str, object], dict[str, object]]:
        visible: dict[TelegramPackageSection, list[DigestIssueItem]] = {section: [] for section in DAILY_MAIN_SECTION_ORDER}
        suppressed: list[DailyMainSuppression] = []
        excluded: list[TelegramSelectionDecision] = []
        shown_events: dict[int, TelegramPackageSection] = {}
        section_counts = {section: 0 for section in DAILY_MAIN_SECTION_ORDER}
        tier1_count = len([candidate for candidate in candidates if candidate["rank"] >= self.telegram_policy.min_ranking_score])
        is_weak_day = tier1_count <= 1
        strict_threshold = self.telegram_policy.fallback_min_score if is_weak_day else self.telegram_policy.min_ranking_score
        tier3_floor = max(self.telegram_policy.fallback_min_score - 12, TELEGRAM_TIER3_FLOOR)
        threshold = tier3_floor if relaxed else strict_threshold
        total_cap = self.telegram_policy.weak_day_total_cap if is_weak_day else self.telegram_policy.total_cap
        total_cap = max(total_cap, MIN_TELEGRAM_ITEMS if relaxed else total_cap)
        tier3_used = 0
        total_selected = 0
        after_filtering_count = 0

        for candidate_index, candidate in enumerate(candidates):
            item = candidate["item"]
            event = candidate["event"]
            section = candidate["section"]
            rank = candidate["rank"]

            if rank < threshold:
                excluded.append(
                    TelegramSelectionDecision(
                        event_id=event.id,
                        candidate_section=section,
                        included_section=None,
                        ranking_score=rank,
                        reason="below_telegram_threshold",
                    )
                )
                continue
            after_filtering_count += 1
            if relaxed and rank < strict_threshold:
                if tier3_used >= 2:
                    excluded.append(
                        TelegramSelectionDecision(
                            event_id=event.id,
                            candidate_section=section,
                            included_section=None,
                            ranking_score=rank,
                            reason="tier_3_cap_reached",
                        )
                    )
                    continue
            if total_selected >= total_cap:
                excluded.append(
                    TelegramSelectionDecision(
                        event_id=event.id,
                        candidate_section=section,
                        included_section=None,
                        ranking_score=rank,
                        reason="telegram_total_cap_reached",
                    )
                )
                continue
            if (
                relaxed
                and total_selected < MIN_TELEGRAM_ITEMS
                and section_counts[section] >= 1
                and self._has_pending_telegram_section_candidate(
                    candidates=candidates,
                    current_index=candidate_index,
                    shown_events=shown_events,
                    section_counts=section_counts,
                    threshold=threshold,
                )
            ):
                excluded.append(
                    TelegramSelectionDecision(
                        event_id=event.id,
                        candidate_section=section,
                        included_section=None,
                        ranking_score=rank,
                        reason="holding_for_section_diversity",
                    )
                )
                continue
            section_cap = self.telegram_policy.section_caps[section] + (1 if relaxed and section is not TelegramPackageSection.ALPHA else 0)
            if section_counts[section] >= section_cap:
                excluded.append(
                    TelegramSelectionDecision(
                        event_id=event.id,
                        candidate_section=section,
                        included_section=None,
                        ranking_score=rank,
                        reason="telegram_section_cap_reached",
                    )
                )
                continue
            if event.id in shown_events:
                shown_in_section = shown_events[event.id]
                suppressed.append(
                    DailyMainSuppression(
                        item_id=item.id,
                        event_id=item.event_id,
                        source_section=self._suppression_section_for(section),
                        shown_in_section=self._suppression_section_for(shown_in_section),
                        reason="duplicate_in_daily_main",
                    )
                )
                continue

            shown_events[event.id] = section
            visible[section].append(item)
            section_counts[section] += 1
            total_selected += 1
            if relaxed and rank < strict_threshold:
                tier3_used += 1

        return (
            {
                "visible": visible,
                "suppressed": suppressed,
                "excluded": excluded,
            },
            {
                "weak_day_mode": is_weak_day,
                "threshold": threshold,
                "total_cap": total_cap,
                "relaxed_mode": relaxed,
                "candidates_considered": len(candidates),
                "after_filtering_count": after_filtering_count,
                "selected_count": total_selected,
                "selected_event_ids": [item.event_id for visible_items in visible.values() for item in visible_items if item.event_id is not None],
            },
        )

    def _has_pending_telegram_section_candidate(
        self,
        *,
        candidates: list[dict[str, object]],
        current_index: int,
        shown_events: dict[int, TelegramPackageSection],
        section_counts: dict[TelegramPackageSection, int],
        threshold: float,
    ) -> bool:
        for candidate in candidates[current_index + 1:]:
            event = candidate["event"]
            section = candidate["section"]
            rank = candidate["rank"]
            if rank < threshold:
                continue
            if event.id in shown_events:
                continue
            if section_counts[section] > 0:
                continue
            return True
        return False

    def _issue_selection_debug(self, items: list[DigestIssueItem], preview: DailyMainPreview | None) -> IssueSelectionDebug:
        if preview is None:
            selected = {
                section: [item.event_id for item in items if item.section is section and item.event_id is not None]
                for section in DigestSection
            }
            suppressed = {section: [] for section in DigestSection}
            return IssueSelectionDebug(selected_event_ids_by_section=selected, suppressed_by_section=suppressed)

        selected = {
            self._suppression_section_for(section): [item.event_id for item in visible_items if item.event_id is not None]
            for section, visible_items in preview.visible_by_section.items()
        }
        selected[DigestSection.ALL] = [item.event_id for item in items if item.section is DigestSection.ALL and item.event_id is not None]
        suppressed_by_section: dict[DigestSection, list[DailyMainSuppression]] = {section: [] for section in DigestSection}
        for suppression in preview.suppressed:
            suppressed_by_section[suppression.source_section].append(suppression)
        return IssueSelectionDebug(selected_event_ids_by_section=selected, suppressed_by_section=suppressed_by_section)

    async def _load_events(self, session: AsyncSession, start: date, end: date) -> list[Event]:
        return list(
            (
                await session.scalars(
                    select(Event)
                    .where(and_(Event.event_date >= start, Event.event_date <= end))
                    .options(selectinload(Event.categories), selectinload(Event.tags), selectinload(Event.primary_source))
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
        items.extend(self._section_snapshot(DigestSection.AI_NEWS, self._top_ai_news(events)))
        items.extend(self._section_snapshot(DigestSection.CODING, self._top_coding(events)))
        items.extend(self._section_snapshot(DigestSection.INVESTMENTS, self._top_investments(events)))
        items.extend(self._section_snapshot(DigestSection.ALL, self._top_all(events)))
        items.extend(self._alpha_snapshot(alpha_entries))
        return items

    def _build_weekly_items(self, events: list[Event], alpha_entries: list[AlphaEntry]) -> list[DigestIssueItem]:
        top_events = [
            event
            for event in sorted(events, key=lambda event: (self._telegram_rank(event), event.confidence_score), reverse=True)
            if self._telegram_rank(event) >= self.telegram_policy.fallback_min_score
        ][:5]
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
        candidates = [
            event
            for event in events
            if event.importance_score >= 68
            and (
                event.is_highlight
                or self._is_primary_section(event, EventSection.IMPORTANT)
                or event.market_impact_score >= 65
            )
        ]
        return self._limit_for_day(
            sorted(
                candidates,
                key=lambda event: (
                    event.is_highlight,
                    self._is_primary_section(event, EventSection.IMPORTANT),
                    event.importance_score,
                    event.market_impact_score,
                    event.confidence_score,
                    self._source_quality_rank(event),
                ),
                reverse=True,
            ),
            strong_limit=4,
            weak_limit=2,
        )

    def _top_all(self, events: list[Event]) -> list[Event]:
        candidates = [event for event in events if self._signal_score(event) >= 45]
        return self._limit_for_day(
            sorted(
                candidates,
                key=lambda event: (
                    self._telegram_rank(event),
                    event.confidence_score,
                    self._source_quality_rank(event),
                ),
                reverse=True,
            ),
            strong_limit=8,
            weak_limit=5,
        )

    def _top_by_section(self, events: list[Event], section: EventSection, score_field: str, limit: int) -> list[Event]:
        relevant = [
            event
            for event in events
            if any(category.section == section for category in event.categories)
        ]
        return sorted(relevant, key=lambda event: (getattr(event, score_field), event.confidence_score), reverse=True)[:limit]

    def _top_ai_news(self, events: list[Event]) -> list[Event]:
        candidates = [
            event
            for event in events
            if self._has_section(event, EventSection.AI_NEWS)
            and event.ai_news_score >= 42
            and (
                self._is_primary_section(event, EventSection.AI_NEWS)
                or self._is_primary_section(event, EventSection.IMPORTANT)
                or event.ai_news_score >= event.coding_score + 8
            )
        ]
        return self._limit_for_day(
            sorted(
                candidates,
                key=lambda event: (
                    self._is_primary_section(event, EventSection.AI_NEWS),
                    event.ai_news_score,
                    event.importance_score,
                    event.confidence_score,
                    self._source_quality_rank(event),
                ),
                reverse=True,
            ),
            strong_limit=3,
            weak_limit=2,
        )

    def _top_coding(self, events: list[Event]) -> list[Event]:
        candidates = [
            event
            for event in events
            if (
                self._has_section(event, EventSection.CODING)
                or self._looks_like_coding_candidate(event)
            )
            and (event.coding_score >= 40 or self._looks_like_coding_candidate(event))
            and (
                self._is_primary_section(event, EventSection.CODING)
                or event.coding_score >= event.ai_news_score + 10
                or self._has_tech_tag(event)
                or self._looks_like_coding_candidate(event)
            )
        ]
        return self._limit_for_day(
            sorted(
                candidates,
                key=lambda event: (
                    self._looks_like_coding_candidate(event),
                    self._is_primary_section(event, EventSection.CODING),
                    event.coding_score,
                    event.confidence_score,
                    event.importance_score,
                    self._source_quality_rank(event),
                ),
                reverse=True,
            ),
            strong_limit=3,
            weak_limit=2,
        )

    def _top_investments(self, events: list[Event]) -> list[Event]:
        candidates = [
            event
            for event in events
            if self._has_section(event, EventSection.INVESTMENTS)
            and event.investment_score >= 60
            and (
                self._is_primary_section(event, EventSection.INVESTMENTS)
                or event.market_impact_score >= 55
            )
        ]
        return self._limit_for_day(
            sorted(
                candidates,
                key=lambda event: (
                    self._is_primary_section(event, EventSection.INVESTMENTS),
                    event.investment_score,
                    event.market_impact_score,
                    event.confidence_score,
                    self._source_quality_rank(event),
                ),
                reverse=True,
            ),
            strong_limit=2,
            weak_limit=1,
        )

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
            card_text=self._build_card_text(event, section),
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

    def _is_empty_section(self, items: list[DigestIssueItem]) -> bool:
        return len(items) == 1 and items[0].event_id is None and items[0].alpha_entry_id is None

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

    def _build_card_text(self, event: Event, section: DigestSection) -> str:
        lead = self._editorial_lead(event, section)
        impact = self._specific_second_sentence(event, section)
        if not impact:
            return lead
        if lead.rstrip(".!?") == impact.rstrip(".!?"):
            return lead
        return f"{lead.rstrip('.!?')}. {impact}"

    def _first_sentence(self, value: str | None) -> str:
        if not value:
            return ""
        sentences = [part.strip() for part in _SENTENCE_SPLIT_RE.split(value.strip()) if part.strip()]
        return sentences[0] if sentences else value.strip()

    def _editorial_lead(self, event: Event, section: DigestSection) -> str:
        lead = self._first_sentence(event.short_summary) or self._first_sentence(event.long_summary) or event.title
        if not lead:
            return event.title
        if re.search(r"[А-Яа-яЁё]", lead):
            return lead

        text = " ".join(filter(None, [event.title, event.short_summary, event.long_summary])).lower()
        if "transformers.js" in text or "webgpu" in text:
            return "Transformers.js v3 добавил WebGPU и новые сценарии запуска моделей в браузере."
        if "protect ai" in text or "model security" in text or "ml community" in text:
            return "Hugging Face и Protect AI усиливают фокус на безопасности моделей."
        if "speech-to-speech" in text or "s2s" in text:
            return "Hugging Face упростил запуск speech-to-speech пайплайнов."
        if "outlines-core" in text or "structured generation" in text:
            return "Outlines-core 0.1.0 усиливает structured generation в Rust и Python."
        if "copilot" in text and "cli" in text:
            return "GitHub Copilot добавил новый CLI-сценарий для developer workflow."
        if "embedding" in text and ("domain-specific" in text or "domain specific" in text):
            return "Показан быстрый способ дообучить доменную embedding-модель под свои данные."
        if "granite libraries" in text or "mellea" in text:
            return "IBM обновила стек Granite Libraries и релизнула Mellea 0.4.0."
        if "voice" in text and "eval" in text:
            return "Новый фреймворк задает стандарт для оценки voice-агентов."
        if "security" in text:
            return "Рынок получил новый повод пересмотреть безопасность AI-инфраструктуры."
        if "browser" in text:
            return "Новые AI-сценарии смещаются ближе к браузеру и клиентскому слою."
        return lead

    def _specific_second_sentence(self, event: Event, section: DigestSection) -> str:
        text = " ".join(filter(None, [event.title, event.short_summary, event.long_summary])).lower()
        if section is DigestSection.CODING:
            if any(keyword in text for keyword in ("malware", "malicious", "secret", "credentials", "vulnerability", "security")):
                return "Важно для команд, которые держат этот стек в проде из-за риска утечки секретов."
            if any(keyword in text for keyword in ("webgpu", "browser", "javascript", "transformers.js", "web client")):
                return "Команды получают шанс увести inference ближе к пользователю и снизить зависимость от серверного слоя."
            if any(keyword in text for keyword in ("structured generation", "json schema", "rust", "python")):
                return "Это поднимает требования к качеству вывода и снижает цену ошибок в production-сценариях."
            if any(keyword in text for keyword in ("embedding", "fine-tune", "finetune", "retrieval", "search")):
                return "Команды смогут точнее настраивать retrieval под свои данные и быстрее доводить качество поиска до бизнеса."
            if any(keyword in text for keyword in ("speech", "voice", "speech-to-speech", "s2s")):
                return "Voice-сценарии становятся ближе к продакшену, а компании получают более практичный канал автоматизации."
            if any(keyword in text for keyword in ("eval", "benchmark", "voice", "agent", "testing")):
                return "Рынок поднимает планку оценки AI-агентов, и командам придется быстрее формализовать eval-пайплайны."
            if any(keyword in text for keyword in ("sdk", "api", "cli", "workflow", "tool", "copilot", "open-source", "open source")):
                return "Инструменты меняют ежедневную работу разработчиков и ускоряют выбор нового стека для команд."
            return "Команды пересмотрят рабочий стек, а рынок быстрее отсеет слабые инструменты."

        if section is DigestSection.INVESTMENTS:
            if any(keyword in text for keyword in ("acquisition", "acquire", "merger", "m&a")):
                return "Сделка меняет карту рынка и подталкивает конкурентов к новым альянсам и ответным покупкам."
            if any(keyword in text for keyword in ("partnership", "partner")):
                return "Коммерческие альянсы перераспределяют влияние в секторе и меняют доступ к рынку, клиентам и данным."
            return "Капитал указывает на сегменты, где рынок ждет следующий рост выручки и жесткую борьбу за долю."

        if section is DigestSection.AI_NEWS:
            if any(keyword in text for keyword in ("security", "protect ai", "supply chain", "model security")):
                return "Безопасность моделей и supply chain становятся жестким критерием для платформ и корпоративных закупок."
            if any(keyword in text for keyword in ("webgpu", "browser", "transformers.js")):
                return "Инференс уходит ближе к браузеру, и это меняет продуктовую архитектуру, стоимость и контроль над клиентским опытом."
            if any(keyword in text for keyword in ("embedding", "fine-tune", "finetune", "retrieval")):
                return "Компании получают более точный рычаг для поиска и retrieval, а значит быстрее доводят AI-функции до прикладной ценности."
            if any(keyword in text for keyword in ("speech", "voice", "speech-to-speech", "s2s")):
                return "Voice AI выходит из эксперимента в продуктовый контур и усиливает конкуренцию за реальные пользовательские сценарии."
            if any(keyword in text for keyword in ("structured generation", "outlines", "json schema")):
                return "Рынок требует более надежный контроль вывода, потому что без него корпоративные сценарии упираются в ошибки и потери."
            if any(keyword in text for keyword in ("research", "training", "inference", "reasoning", "model", "benchmark")):
                return "Крупные игроки меняют модельные и инфраструктурные ставки, а рынок подстраивает под это продуктовые планы и бюджеты."
            if any(keyword in text for keyword in ("voice", "agent")):
                return "Рынок агентов выходит на этап жесткой оценки качества, и от этого зависит доверие клиентов и скорость внедрения."
            return "Событие меняет продуктовые решения, рыночные приоритеты и темп конкуренции в AI."

        if section is DigestSection.IMPORTANT:
            if self._has_section(event, EventSection.INVESTMENTS):
                return "Событие быстро отразится на сделках, оценках компаний и продуктовых планах крупных игроков."
            if self._has_section(event, EventSection.CODING):
                return "Команды, которые быстро несут инструменты в прод, будут вынуждены пересматривать стек и темп внедрения."
            return "Событие задает один из ключевых ориентиров дня для рынка, конкурентов и корпоративных команд."

        if section is DigestSection.ALL:
            primary = self._primary_section(event)
            mapped = {
                EventSection.IMPORTANT: DigestSection.IMPORTANT,
                EventSection.AI_NEWS: DigestSection.AI_NEWS,
                EventSection.CODING: DigestSection.CODING,
                EventSection.INVESTMENTS: DigestSection.INVESTMENTS,
            }.get(primary)
            if mapped is not None:
                return self._specific_second_sentence(event, mapped)
            return "Событие влияет на рынок, продуктовые решения и скорость реакции конкурентов."

        return ""

    def _primary_section(self, event: Event) -> EventSection | None:
        category = next((category for category in event.categories if category.is_primary_section), None)
        return category.section if category is not None else None

    def _has_section(self, event: Event, section: EventSection) -> bool:
        return any(category.section == section for category in event.categories)

    def _is_primary_section(self, event: Event, section: EventSection) -> bool:
        return any(category.section == section and category.is_primary_section for category in event.categories)

    def _has_tech_tag(self, event: Event) -> bool:
        return any(tag.tag_type is EventTagType.TECH for tag in event.tags)

    def _looks_like_coding_candidate(self, event: Event) -> bool:
        text = " ".join(filter(None, [event.title, event.short_summary, event.long_summary])).lower()
        return any(
            keyword in text
            for keyword in (
                "webgpu",
                "transformers.js",
                "structured generation",
                "json schema",
                "rust",
                "python",
                "sdk",
                "api",
                "cli",
                "deploy",
                "deployment",
                "speech-to-speech",
                "embedding",
                "retrieval",
                "tooling",
                "open-source",
                "open source",
            )
        )

    def _source_quality_rank(self, event: Event) -> float:
        reputation = score_event_source_quality(event)
        return reputation.score + (0.3 if reputation.is_official else 0.0) + (0.2 if reputation.is_engineering or reputation.is_research else 0.0)

    def _signal_score(self, event: Event) -> float:
        return max(
            event.importance_score,
            event.ai_news_score * 0.92,
            event.coding_score * 0.92,
            event.investment_score * 0.92,
        )

    def _telegram_rank(self, event: Event) -> float:
        return event.ranking_score if event.ranking_score > 0 else self._signal_score(event)

    def _is_russia_event(self, event: Event) -> bool:
        return bool(event.primary_source is not None and getattr(event.primary_source, "region", None) is not None and event.primary_source.region.value == "russia")

    def _qualifies_for_ai_russia(self, event: Event) -> bool:
        return qualifies_for_ai_russia_event(event)

    def _telegram_package_section(self, event: Event) -> TelegramPackageSection:
        if self._qualifies_for_ai_russia(event):
            return TelegramPackageSection.AI_RUSSIA
        if self._has_section(event, EventSection.INVESTMENTS) and event.investment_score >= 55:
            return TelegramPackageSection.INVESTMENTS_MARKET
        coding_relevant = (
            self._is_primary_section(event, EventSection.CODING)
            or (self._has_section(event, EventSection.CODING) and event.coding_score >= max(55, event.ai_news_score))
            or (
                self._looks_like_coding_candidate(event)
                and event.coding_score >= 65
                and event.coding_score >= event.ai_news_score + 5
            )
        )
        if coding_relevant:
            return TelegramPackageSection.TOOLS_CODING
        return TelegramPackageSection.MODELS_SERVICES

    def _telegram_candidates_from_items(self, items: list[DigestIssueItem], events: list[Event], *, broaden_pool: bool) -> list[dict[str, object]]:
        event_map = {event.id: event for event in events}
        if broaden_pool:
            all_items = self._broadened_telegram_item_pool(items)
        else:
            all_items = sorted(
                [item for item in items if item.section is DigestSection.ALL and item.event_id is not None],
                key=lambda item: (item.rank_order, item.id),
            )
            if not all_items:
                all_items = self._broadened_telegram_item_pool(items)
        candidates: list[dict[str, object]] = []
        for item in all_items:
            event = event_map.get(item.event_id)
            if event is None:
                continue
            candidates.append(
                {
                    "item": item,
                    "event": event,
                    "section": self._telegram_package_section(event),
                    "rank": self._telegram_rank(event),
                }
            )
        candidates.sort(
            key=lambda candidate: (
                candidate["rank"],
                candidate["event"].confidence_score,
                self._source_quality_rank(candidate["event"]),
            ),
            reverse=True,
        )
        return candidates

    def _broadened_telegram_item_pool(self, items: list[DigestIssueItem]) -> list[DigestIssueItem]:
        section_priority = {
            DigestSection.IMPORTANT: 0,
            DigestSection.AI_NEWS: 1,
            DigestSection.CODING: 2,
            DigestSection.INVESTMENTS: 3,
            DigestSection.ALL: 4,
        }
        unique: dict[int, DigestIssueItem] = {}
        ordered = sorted(
            [item for item in items if item.event_id is not None and item.section is not DigestSection.ALPHA],
            key=lambda item: (section_priority.get(item.section, 9), item.rank_order, item.id),
        )
        for item in ordered:
            event_id = int(item.event_id)
            if event_id not in unique:
                unique[event_id] = item
        return list(unique.values())

    def _suppression_section_for(self, section: TelegramPackageSection) -> DigestSection:
        mapping = {
            TelegramPackageSection.MODELS_SERVICES: DigestSection.AI_NEWS,
            TelegramPackageSection.TOOLS_CODING: DigestSection.CODING,
            TelegramPackageSection.INVESTMENTS_MARKET: DigestSection.INVESTMENTS,
            TelegramPackageSection.AI_RUSSIA: DigestSection.ALL,
            TelegramPackageSection.ALPHA: DigestSection.ALPHA,
        }
        return mapping[section]

    def _limit_for_day(self, events: list[Event], *, strong_limit: int, weak_limit: int) -> list[Event]:
        if not events:
            return []
        strong_count = sum(1 for event in events if self._signal_score(event) >= 70)
        limit = strong_limit if strong_count >= strong_limit else weak_limit if strong_count <= 1 else max(weak_limit, strong_count)
        return events[:limit]

    def _section_counts(self, items: list[DigestIssueItem]) -> dict[str, int]:
        counts: dict[str, int] = {}
        for section in DigestSection:
            counts[section.value] = sum(1 for item in items if item.section is section and item.event_id is not None)
        return counts

    def _is_weak_day(self, events: list[Event]) -> bool:
        return sum(1 for event in events if self._signal_score(event) >= 65) <= 1
