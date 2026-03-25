from __future__ import annotations

import logging
from datetime import UTC, datetime

from app.core.datetime import ensure_utc
from app.core.config import get_settings
from app.core.logging import log_structured
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker
from sqlalchemy.orm import selectinload

from app.db.models import (
    Event,
    EventCategory,
    EventSource,
    EventSourceRole,
    EventTag,
    LlmUsageLog,
    ProcessRun,
    ProcessRunStatus,
    RawItem,
    RawItemStatus,
)
from app.services.classification import ClassificationService
from app.services.clustering import ClusteringService
from app.services.events.schemas import ProcessEventsResult
from app.services.events.summary import SummaryBuilder
from app.services.normalization import NormalizationService
from app.services.scoring import ScoringService
from app.services.sources.reputation import score_event_source_link, score_event_source_quality

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
        self.settings = get_settings()

    async def process(self, limit: int = 100) -> ProcessEventsResult:
        async with self.session_factory() as session:
            started_at = datetime.now(UTC)
            process_run = ProcessRun(
                started_at=started_at,
                status=ProcessRunStatus.FAILED,
            )
            session.add(process_run)
            await session.flush()
            try:
                raw_items_considered, normalized_count, discarded_count = await self._normalize_fetched_items(session=session, limit=limit)
                clustered_count, created_events, touched_event_ids, clusters_merged, ambiguous_count = await self._cluster_normalized_items(session=session, limit=limit)
                updated_events = 0
                shortlist_count = 0
                llm_event_count = 0
                for event_id in sorted(touched_event_ids):
                    shortlisted, llm_used = await self._refresh_event(session=session, event_id=event_id)
                    updated_events += 1
                    shortlist_count += int(shortlisted)
                    llm_event_count += int(llm_used)

                finished_at = datetime.now(UTC)
                process_run.finished_at = finished_at
                process_run.status = ProcessRunStatus.SUCCESS
                process_run.raw_items_considered = raw_items_considered
                process_run.normalized_count = normalized_count
                process_run.clustered_count = clustered_count
                process_run.discarded_count = discarded_count
                process_run.created_events = created_events
                process_run.updated_events = updated_events
                process_run.clusters_merged = clusters_merged
                process_run.ambiguous_count = ambiguous_count
                process_run.shortlist_count = shortlist_count
                process_run.llm_event_count = llm_event_count
                process_run.duration_ms = self._duration_ms(started_at, finished_at)

                await session.commit()
                log_structured(
                    logger,
                    "process_events_completed",
                    process_run_id=process_run.id,
                    status=process_run.status.value,
                    raw_items_considered=raw_items_considered,
                    normalized_count=normalized_count,
                    clustered_count=clustered_count,
                    discarded_count=discarded_count,
                    created_events=created_events,
                    updated_events=updated_events,
                    clusters_merged=clusters_merged,
                    ambiguous_count=ambiguous_count,
                    shortlist_count=shortlist_count,
                    llm_event_count=llm_event_count,
                    duration_ms=process_run.duration_ms,
                )
                return ProcessEventsResult(
                    process_run_id=process_run.id,
                    raw_items_considered=raw_items_considered,
                    normalized_count=normalized_count,
                    clustered_count=clustered_count,
                    discarded_count=discarded_count,
                    created_events=created_events,
                    updated_events=updated_events,
                    clusters_merged=clusters_merged,
                    ambiguous_count=ambiguous_count,
                    shortlist_count=shortlist_count,
                    llm_event_count=llm_event_count,
                )
            except Exception as exc:
                await session.rollback()
                process_run.finished_at = datetime.now(UTC)
                process_run.status = ProcessRunStatus.FAILED
                process_run.error_message = str(exc)
                process_run.duration_ms = self._duration_ms(started_at, process_run.finished_at)
                session.add(process_run)
                await session.commit()
                log_structured(
                    logger,
                    "process_events_failed",
                    process_run_id=process_run.id,
                    status=process_run.status.value,
                    error_message=str(exc),
                    duration_ms=process_run.duration_ms,
                )
                raise

    async def _normalize_fetched_items(self, session: AsyncSession, limit: int) -> tuple[int, int, int]:
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
        return len(raw_items), normalized_count, discarded_count

    async def _cluster_normalized_items(self, session: AsyncSession, limit: int) -> tuple[int, int, set[int], int, int]:
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
        ambiguous_count = 0

        for raw_item in raw_items:
            if raw_item.event_links:
                raw_item.status = RawItemStatus.CLUSTERED
                continue

            decision = await self.clustering_service.analyze_match(session=session, raw_item=raw_item)
            event = decision.event
            if decision.event is None and decision.candidate_count > 0 and decision.best_score >= self.clustering_service.config.match_threshold - 0.06:
                ambiguous_count += 1
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
        clusters_merged = max(clustered_count - created_events, 0)
        return clustered_count, created_events, touched_event_ids, clusters_merged, ambiguous_count

    async def _refresh_event(self, session: AsyncSession, event_id: int) -> tuple[bool, bool]:
        stmt = (
            select(Event)
            .where(Event.id == event_id)
            .options(
                selectinload(Event.event_sources).selectinload(EventSource.raw_item).selectinload(RawItem.source),
                selectinload(Event.event_sources).selectinload(EventSource.source),
                selectinload(Event.categories),
                selectinload(Event.tags),
                selectinload(Event.primary_source),
            )
        )
        event = await session.scalar(stmt)
        if event is None:
            return False, False

        raw_items = [link.raw_item for link in event.event_sources if link.raw_item is not None]
        if not raw_items:
            return False, False

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
        shortlist_passed = self._passes_llm_shortlist(event=event, scores=scores, raw_items=raw_items)
        event.related_previous_event_id = await self._find_related_previous_event_id(session=session, event=event, raw_items=raw_items)
        summary = await self.summary_builder.build(event, raw_items, use_llm=shortlist_passed)
        if summary.usage is not None:
            session.add(
                LlmUsageLog(
                    pipeline_step=summary.usage.pipeline_step,
                    model_name=summary.usage.model_name,
                    item_count=summary.usage.item_count,
                    latency_ms=summary.usage.latency_ms,
                    prompt_tokens=summary.usage.prompt_tokens,
                    completion_tokens=summary.usage.completion_tokens,
                    total_tokens=summary.usage.total_tokens,
                    success=summary.usage.success,
                    error_message=summary.usage.error_message,
                )
            )

        event.title = summary.payload.title
        event.short_summary = summary.payload.short_summary
        event.long_summary = summary.payload.long_summary
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
        await session.flush()
        self._log_event_decision(event=event, shortlist_passed=shortlist_passed)
        return shortlist_passed, summary.llm_used

    def _select_primary_link(self, event_sources: list[EventSource]) -> EventSource | None:
        if not event_sources:
            return None
        return max(event_sources, key=score_event_source_link)

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

    def _passes_llm_shortlist(self, *, event: Event, scores, raw_items: list[RawItem]) -> bool:
        if scores.is_highlight:
            return True
        source_quality = score_event_source_quality(event).score
        max_signal = max(scores.importance_score, scores.ai_news_score, scores.coding_score, scores.investment_score)
        if max_signal >= self.settings.event_llm_shortlist_threshold:
            return True
        return source_quality >= 1.35 and max_signal >= self.settings.event_llm_shortlist_secondary_threshold and len(raw_items) >= 2

    async def _find_related_previous_event_id(self, session: AsyncSession, event: Event, raw_items: list[RawItem]) -> int | None:
        entities = {
            value.lower()
            for raw_item in raw_items
            for values in (raw_item.entities_json or {}).values()
            for value in values
        }
        if not entities:
            return None
        previous_events = list(
            (
                await session.scalars(
                    select(Event)
                    .where(
                        Event.id != event.id,
                        Event.event_date < event.event_date,
                        Event.event_date >= event.event_date.fromordinal(event.event_date.toordinal() - 7),
                    )
                    .options(selectinload(Event.tags), selectinload(Event.categories))
                    .order_by(Event.event_date.desc(), Event.importance_score.desc(), Event.id.desc())
                    .limit(20)
                )
            ).all()
        )
        for previous_event in previous_events:
            text = " ".join(filter(None, [previous_event.title, previous_event.short_summary, previous_event.long_summary])).lower()
            if any(entity in text for entity in entities):
                return previous_event.id
        return None

    def _log_event_decision(self, *, event: Event, shortlist_passed: bool) -> None:
        primary_section = next((category.section.value for category in event.categories if category.is_primary_section), None)
        secondary_sections = [category.section.value for category in event.categories if not category.is_primary_section]
        reputation = score_event_source_quality(event)
        log_structured(
            logger,
            "event_decision",
            event_id=event.id,
            primary_source_id=event.primary_source_id,
            source_quality_tier=reputation.tier,
            source_quality_score=reputation.score,
            importance_score=event.importance_score,
            confidence_score=event.confidence_score,
            section_scores={category.section.value: category.score for category in event.categories},
            shortlist_passed=shortlist_passed,
            selected_for_issue=False,
            suppression_reason=None,
            primary_section=primary_section,
            secondary_sections=secondary_sections,
            related_previous_event_id=event.related_previous_event_id,
        )

    def _duration_ms(self, started_at: datetime, finished_at: datetime | None) -> int | None:
        if finished_at is None:
            return None
        return max(int((finished_at - started_at).total_seconds() * 1000), 0)
