from __future__ import annotations

import logging
from datetime import UTC, datetime

from app.core.datetime import ensure_utc
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker
from sqlalchemy.orm import selectinload

from app.db.models import (
    Event,
    EventCategory,
    EventSource,
    EventSourceRole,
    EventTag,
    RawItem,
    RawItemStatus,
    SourceType,
)
from app.services.classification import ClassificationService
from app.services.clustering import ClusteringService
from app.services.events.schemas import ProcessEventsResult
from app.services.events.summary import SummaryBuilder
from app.services.normalization import NormalizationService
from app.services.scoring import ScoringService

logger = logging.getLogger(__name__)


class ProcessEventsService:
    def __init__(
        self,
        session_factory: async_sessionmaker[AsyncSession],
        normalization_service: NormalizationService | None = None,
        clustering_service: ClusteringService | None = None,
        classification_service: ClassificationService | None = None,
        scoring_service: ScoringService | None = None,
        summary_builder: SummaryBuilder | None = None,
    ) -> None:
        self.session_factory = session_factory
        self.normalization_service = normalization_service or NormalizationService()
        self.clustering_service = clustering_service or ClusteringService()
        self.classification_service = classification_service or ClassificationService()
        self.scoring_service = scoring_service or ScoringService()
        self.summary_builder = summary_builder or SummaryBuilder()

    async def process(self, limit: int = 100) -> ProcessEventsResult:
        async with self.session_factory() as session:
            normalized_count, discarded_count = await self._normalize_fetched_items(session=session, limit=limit)
            clustered_count, created_events, touched_event_ids = await self._cluster_normalized_items(session=session, limit=limit)
            updated_events = 0
            for event_id in sorted(touched_event_ids):
                await self._refresh_event(session=session, event_id=event_id)
                updated_events += 1

            await session.commit()

        logger.info(
            "process-events completed normalized=%s discarded=%s clustered=%s created_events=%s updated_events=%s",
            normalized_count,
            discarded_count,
            clustered_count,
            created_events,
            updated_events,
        )
        return ProcessEventsResult(
            normalized_count=normalized_count,
            clustered_count=clustered_count,
            discarded_count=discarded_count,
            created_events=created_events,
            updated_events=updated_events,
        )

    async def _normalize_fetched_items(self, session: AsyncSession, limit: int) -> tuple[int, int]:
        stmt = (
            select(RawItem)
            .where(RawItem.status == RawItemStatus.FETCHED)
            .options(selectinload(RawItem.source))
            .order_by(RawItem.published_at.asc().nulls_last(), RawItem.id.asc())
            .limit(limit)
        )
        raw_items = list((await session.scalars(stmt)).all())

        normalized_count = 0
        discarded_count = 0
        for raw_item in raw_items:
            result = self.normalization_service.normalize(raw_item=raw_item, source=raw_item.source)
            if result.discarded:
                raw_item.status = RawItemStatus.DISCARDED
                discarded_count += 1
                continue

            raw_item.normalized_title = result.normalized_title
            raw_item.normalized_text = result.normalized_text
            raw_item.entities_json = result.entities
            raw_item.outbound_links_json = result.outbound_links
            raw_item.language = result.language
            raw_item.status = RawItemStatus.NORMALIZED
            normalized_count += 1

        await session.flush()
        return normalized_count, discarded_count

    async def _cluster_normalized_items(self, session: AsyncSession, limit: int) -> tuple[int, int, set[int]]:
        stmt = (
            select(RawItem)
            .where(RawItem.status == RawItemStatus.NORMALIZED)
            .options(selectinload(RawItem.source), selectinload(RawItem.event_links))
            .order_by(RawItem.published_at.asc().nulls_last(), RawItem.id.asc())
            .limit(limit)
        )
        raw_items = list((await session.scalars(stmt)).all())

        clustered_count = 0
        created_events = 0
        touched_event_ids: set[int] = set()

        for raw_item in raw_items:
            if raw_item.event_links:
                raw_item.status = RawItemStatus.CLUSTERED
                continue

            event = await self.clustering_service.find_matching_event(session=session, raw_item=raw_item)
            if event is None:
                event = Event(
                    event_date=(raw_item.published_at or raw_item.fetched_at).date(),
                    title=raw_item.normalized_title or raw_item.raw_title,
                    short_summary=None,
                    long_summary=None,
                    importance_score=0.0,
                    market_impact_score=0.0,
                    ai_news_score=0.0,
                    coding_score=0.0,
                    investment_score=0.0,
                    confidence_score=0.0,
                    is_highlight=False,
                )
                session.add(event)
                await session.flush()
                created_events += 1

            session.add(
                EventSource(
                    event_id=event.id,
                    raw_item_id=raw_item.id,
                    source_id=raw_item.source_id,
                    role=EventSourceRole.SUPPORTING,
                    citation_url=raw_item.canonical_url,
                )
            )
            raw_item.status = RawItemStatus.CLUSTERED
            clustered_count += 1
            touched_event_ids.add(event.id)

        await session.flush()
        return clustered_count, created_events, touched_event_ids

    async def _refresh_event(self, session: AsyncSession, event_id: int) -> None:
        stmt = (
            select(Event)
            .where(Event.id == event_id)
            .options(
                selectinload(Event.event_sources).selectinload(EventSource.raw_item).selectinload(RawItem.source),
                selectinload(Event.event_sources).selectinload(EventSource.source),
                selectinload(Event.categories),
                selectinload(Event.tags),
            )
        )
        event = await session.scalar(stmt)
        if event is None:
            return

        raw_items = [link.raw_item for link in event.event_sources if link.raw_item is not None]
        if not raw_items:
            return

        primary_link = self._select_primary_link(event.event_sources)
        if primary_link is not None:
            event.primary_source_id = primary_link.source_id
            event.primary_source_url = primary_link.citation_url
            event.primary_source = primary_link.source
            event.title = primary_link.raw_item.normalized_title or primary_link.raw_item.raw_title
            event.event_date = (primary_link.raw_item.published_at or primary_link.raw_item.fetched_at).date()

        for link in event.event_sources:
            if primary_link is not None and link.id == primary_link.id:
                link.role = EventSourceRole.PRIMARY
            else:
                link.role = self._supporting_role(link=link, primary_link=primary_link)

        categories, tags = self.classification_service.classify(raw_items)
        scores = self.scoring_service.score(raw_items, categories)
        summary = await self.summary_builder.build(event, raw_items)

        event.title = summary.title
        event.short_summary = summary.short_summary
        event.long_summary = summary.long_summary
        event.importance_score = scores.importance_score
        event.market_impact_score = scores.market_impact_score
        event.ai_news_score = scores.ai_news_score
        event.coding_score = scores.coding_score
        event.investment_score = scores.investment_score
        event.confidence_score = scores.confidence_score
        event.is_highlight = scores.is_highlight
        event.updated_at = datetime.now(UTC)

        for category in list(event.categories):
            await session.delete(category)
        for tag in list(event.tags):
            await session.delete(tag)
        await session.flush()

        event.categories = [
            EventCategory(
                section=category.section,
                score=category.score,
                is_primary_section=category.is_primary_section,
            )
            for category in categories
        ]
        event.tags = [
            EventTag(
                tag=tag.tag,
                tag_type=tag.tag_type,
            )
            for tag in tags
        ]

    def _select_primary_link(self, event_sources: list[EventSource]) -> EventSource | None:
        def rank(link: EventSource) -> tuple[float, float, float, float]:
            source = link.source
            raw_item = link.raw_item
            source_priority = float(source.priority_weight if source else 50)
            source_type_score = {
                SourceType.OFFICIAL_BLOG: 3.0,
                SourceType.RSS_FEED: 2.0,
                SourceType.WEBSITE: 1.0,
            }.get(source.source_type if source else SourceType.WEBSITE, 1.0)
            source_title = (source.title if source else "").lower()
            editorial_bonus = 0.0
            if "engineering" in source_title or "research" in source_title:
                editorial_bonus = 0.6
            published_score = -(
                (raw_item.published_at or raw_item.fetched_at).timestamp()
                if raw_item is not None
                else 0.0
            )
            return (source_type_score, editorial_bonus, source_priority, published_score)

        if not event_sources:
            return None
        return max(event_sources, key=rank)

    def _supporting_role(self, link: EventSource, primary_link: EventSource | None) -> EventSourceRole:
        if primary_link is None or link.raw_item is None or primary_link.raw_item is None:
            return EventSourceRole.SUPPORTING
        delta_seconds = ensure_utc(link.raw_item.published_at or link.raw_item.fetched_at) - ensure_utc(
            primary_link.raw_item.published_at or primary_link.raw_item.fetched_at
        )
        is_reaction = delta_seconds.total_seconds() > 12 * 3600 and (
            (link.source.priority_weight if link.source else 0) < (primary_link.source.priority_weight if primary_link.source else 0)
        )
        return EventSourceRole.REACTION if is_reaction else EventSourceRole.SUPPORTING
