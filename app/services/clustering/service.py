from __future__ import annotations

from datetime import timedelta
from difflib import SequenceMatcher

from sqlalchemy import Select, select
from sqlalchemy.orm import selectinload
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.pipeline import CLUSTERING_CONFIG
from app.db.models import Event, EventSource, RawItem
from app.services.normalization.utils import tokenize


class ClusteringDecision:
    def __init__(self, event: Event | None, best_score: float, candidate_count: int) -> None:
        self.event = event
        self.best_score = best_score
        self.candidate_count = candidate_count


class ClusteringService:
    def __init__(self) -> None:
        self.config = CLUSTERING_CONFIG

    async def find_matching_event(self, session: AsyncSession, raw_item: RawItem) -> Event | None:
        decision = await self.analyze_match(session, raw_item)
        return decision.event

    async def analyze_match(self, session: AsyncSession, raw_item: RawItem) -> ClusteringDecision:
        stmt = self._recent_events_stmt(raw_item)
        candidate_events = list((await session.scalars(stmt)).unique().all())

        best_event: Event | None = None
        best_score = 0.0
        for event in candidate_events:
            score = self._event_similarity(event, raw_item)
            if score > best_score:
                best_score = score
                best_event = event

        if best_score >= self.config.match_threshold:
            return ClusteringDecision(best_event, best_score, len(candidate_events))
        return ClusteringDecision(None, best_score, len(candidate_events))

    def _recent_events_stmt(self, raw_item: RawItem) -> Select[tuple[Event]]:
        event_date = (raw_item.published_at or raw_item.fetched_at).date()
        date_from = event_date - timedelta(days=3)
        date_to = event_date + timedelta(days=3)
        return (
            select(Event)
            .where(Event.event_date >= date_from, Event.event_date <= date_to)
            .options(
                selectinload(Event.event_sources)
                .selectinload(EventSource.raw_item)
                .selectinload(RawItem.source),
                selectinload(Event.event_sources).selectinload(EventSource.source),
                selectinload(Event.categories),
                selectinload(Event.tags),
            )
            .order_by(Event.event_date.desc(), Event.id.desc())
        )

    def _event_similarity(self, event: Event, raw_item: RawItem) -> float:
        return max((self._raw_item_similarity(link.raw_item, raw_item) for link in event.event_sources), default=0.0)

    def _raw_item_similarity(self, left: RawItem, right: RawItem) -> float:
        if left.canonical_url == right.canonical_url:
            return 1.0

        title_similarity = self._text_similarity(left.normalized_title, right.normalized_title)
        text_similarity = self._token_jaccard(left.normalized_text, right.normalized_text)
        entity_similarity = self._entity_overlap(left.entities_json or {}, right.entities_json or {})
        time_similarity = self._time_similarity(left, right)
        url_similarity = 0.0

        if title_similarity >= self.config.title_similarity_threshold:
            text_similarity = max(text_similarity, 0.35)

        return (
            title_similarity * self.config.title_weight
            + text_similarity * self.config.text_weight
            + entity_similarity * self.config.entity_weight
            + time_similarity * self.config.time_weight
            + url_similarity * self.config.url_weight
        )

    def _text_similarity(self, left: str | None, right: str | None) -> float:
        if not left or not right:
            return 0.0
        return SequenceMatcher(None, left.lower(), right.lower()).ratio()

    def _token_jaccard(self, left: str | None, right: str | None) -> float:
        left_tokens = tokenize(left)
        right_tokens = tokenize(right)
        if not left_tokens or not right_tokens:
            return 0.0
        intersection = len(left_tokens & right_tokens)
        union = len(left_tokens | right_tokens)
        return intersection / union if union else 0.0

    def _entity_overlap(self, left: dict, right: dict) -> float:
        left_entities = {value.lower() for values in left.values() for value in values}
        right_entities = {value.lower() for values in right.values() for value in values}
        if not left_entities or not right_entities:
            return 0.0
        return len(left_entities & right_entities) / len(left_entities | right_entities)

    def _time_similarity(self, left: RawItem, right: RawItem) -> float:
        if left.published_at is None or right.published_at is None:
            return 0.5
        delta_hours = abs((left.published_at - right.published_at).total_seconds()) / 3600
        return 1.0 if delta_hours <= self.config.time_window_hours else 0.0
