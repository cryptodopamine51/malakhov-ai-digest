from __future__ import annotations

from datetime import UTC, datetime

from app.core.datetime import ensure_utc
from app.core.pipeline import SCORING_CONFIG
from app.db.models import EventSection, RawItem
from app.services.classification.schemas import ClassifiedCategory
from app.services.normalization.utils import entity_count
from app.services.scoring.schemas import ScoreResult
from app.services.sources.reputation import score_raw_item_source


class ScoringService:
    def __init__(self) -> None:
        self.config = SCORING_CONFIG

    def score(self, raw_items: list[RawItem], categories: list[ClassifiedCategory]) -> ScoreResult:
        supporting_sources = max(len(raw_items) - 1, 0)
        max_priority = max(((item.source.priority_weight if item.source else 50) for item in raw_items), default=50)
        priority_signal = min(max_priority / 100, 1.5)
        official_signal = max(
            (score_raw_item_source(item) for item in raw_items),
            default=0.6,
        )
        entity_signal = min(
            sum(entity_count(item.entities_json or {}) for item in raw_items) / max(len(raw_items), 1),
            5,
        ) / 5
        freshness_signal = self._freshness_signal(raw_items)
        category_map = {category.section: category.score for category in categories}

        importance_score = round(
            (
                priority_signal * 28
                + official_signal * 22
                + supporting_sources * 8
                + category_map.get(EventSection.IMPORTANT, 0.0) * 20
                + freshness_signal * 12
                + entity_signal * 10
            ),
            2,
        )
        market_impact_score = round(
            (
                category_map.get(EventSection.IMPORTANT, 0.0) * 35
                + category_map.get(EventSection.INVESTMENTS, 0.0) * 25
                + priority_signal * 20
                + official_signal * 10
                + freshness_signal * 10
            ),
            2,
        )
        ai_news_score = round((category_map.get(EventSection.AI_NEWS, 0.0) * 70 + official_signal * 20 + entity_signal * 10), 2)
        coding_score = round((category_map.get(EventSection.CODING, 0.0) * 75 + entity_signal * 10 + priority_signal * 15), 2)
        investment_score = round(
            (category_map.get(EventSection.INVESTMENTS, 0.0) * 75 + priority_signal * 10 + supporting_sources * 5 + freshness_signal * 10),
            2,
        )
        confidence_score = round((official_signal * 40 + min(supporting_sources, 3) * 10 + priority_signal * 25 + freshness_signal * 25), 2)
        is_highlight = importance_score >= self.config.highlight_threshold and category_map.get(EventSection.IMPORTANT, 0.0) > 0

        return ScoreResult(
            importance_score=min(importance_score, 100.0),
            market_impact_score=min(market_impact_score, 100.0),
            ai_news_score=min(ai_news_score, 100.0),
            coding_score=min(coding_score, 100.0),
            investment_score=min(investment_score, 100.0),
            confidence_score=min(confidence_score, 100.0),
            is_highlight=is_highlight,
        )

    def _freshness_signal(self, raw_items: list[RawItem]) -> float:
        latest = max((ensure_utc(item.published_at or item.fetched_at) for item in raw_items), default=datetime.now(UTC))
        delta_hours = abs((datetime.now(UTC) - latest).total_seconds()) / 3600
        if delta_hours <= 48:
            return 1.0
        if delta_hours <= 168:
            return 0.7
        return 0.4
