from __future__ import annotations

from datetime import UTC, datetime

from app.core.datetime import ensure_utc
from app.core.pipeline import SCORING_CONFIG
from app.db.models import EventSection, RawItem
from app.services.classification.schemas import ClassifiedCategory
from app.services.normalization.utils import entity_count
from app.services.russia import assess_russia_relevance
from app.services.scoring.schemas import ScoreResult
from app.services.sources.reputation import is_verification_source, score_raw_item_source, score_source


class ScoringService:
    def __init__(self) -> None:
        self.config = SCORING_CONFIG

    def score(self, raw_items: list[RawItem], categories: list[ClassifiedCategory]) -> ScoreResult:
        supporting_sources = max(len(raw_items) - 1, 0)
        unique_source_ids = {item.source_id for item in raw_items}
        unique_sources = [item.source for item in raw_items if item.source is not None]
        max_priority = max(((item.source.priority_weight if item.source else 50) for item in raw_items), default=50)
        priority_signal = min(max_priority / 100, 1.5)
        official_signal = max(
            (score_raw_item_source(item) for item in raw_items),
            default=0.6,
        )
        verification_source_count = sum(1 for source in unique_sources if is_verification_source(source))
        has_verification_source = verification_source_count > 0
        diversity_signal = min(max(len(unique_source_ids) - 1, 0), 3) / 3
        verification_signal = min(verification_source_count, 2) / 2
        source_strength_signal = max((score_source(source).score for source in unique_sources), default=0.6) / 1.85
        russia_relevance = assess_russia_relevance(raw_items)
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
                + verification_signal * 8
                + russia_relevance.relevance_score * 8
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
                + russia_relevance.relevance_score * 12
            ),
            2,
        )
        ai_news_score = round(
            (
                category_map.get(EventSection.AI_NEWS, 0.0) * 70
                + official_signal * 20
                + entity_signal * 10
                + verification_signal * 6
            ),
            2,
        )
        coding_score = round(
            (
                category_map.get(EventSection.CODING, 0.0) * 75
                + entity_signal * 10
                + priority_signal * 15
                + verification_signal * 4
            ),
            2,
        )
        investment_score = round(
            (category_map.get(EventSection.INVESTMENTS, 0.0) * 75 + priority_signal * 10 + supporting_sources * 5 + freshness_signal * 10),
            2,
        )
        confidence_score = round(
            (
                official_signal * 28
                + min(supporting_sources, 3) * 8
                + priority_signal * 18
                + freshness_signal * 16
                + verification_signal * 18
                + diversity_signal * 12
                + russia_relevance.relevance_score * 6
            ),
            2,
        )
        ranking_score = round(
            (
                source_strength_signal * 26
                + freshness_signal * 18
                + diversity_signal * 14
                + verification_signal * 18
                + category_map.get(EventSection.IMPORTANT, 0.0) * 10
                + category_map.get(EventSection.AI_NEWS, 0.0) * 8
                + category_map.get(EventSection.CODING, 0.0) * 6
                + category_map.get(EventSection.INVESTMENTS, 0.0) * 6
                + russia_relevance.relevance_score * 10
            ),
            2,
        )
        is_highlight = importance_score >= self.config.highlight_threshold and category_map.get(EventSection.IMPORTANT, 0.0) > 0

        return ScoreResult(
            importance_score=min(importance_score, 100.0),
            market_impact_score=min(market_impact_score, 100.0),
            ai_news_score=min(ai_news_score, 100.0),
            coding_score=min(coding_score, 100.0),
            investment_score=min(investment_score, 100.0),
            confidence_score=min(confidence_score, 100.0),
            ranking_score=min(ranking_score, 100.0),
            supporting_source_count=supporting_sources,
            verification_source_count=verification_source_count,
            has_verification_source=has_verification_source,
            score_components={
                "source_strength_signal": round(source_strength_signal, 3),
                "priority_signal": round(priority_signal, 3),
                "freshness_signal": round(freshness_signal, 3),
                "diversity_signal": round(diversity_signal, 3),
                "verification_signal": round(verification_signal, 3),
                "entity_signal": round(entity_signal, 3),
                "important_category_signal": round(category_map.get(EventSection.IMPORTANT, 0.0), 3),
                "ai_news_category_signal": round(category_map.get(EventSection.AI_NEWS, 0.0), 3),
                "coding_category_signal": round(category_map.get(EventSection.CODING, 0.0), 3),
                "investment_category_signal": round(category_map.get(EventSection.INVESTMENTS, 0.0), 3),
                "supporting_source_count": supporting_sources,
                "verification_source_count": verification_source_count,
                "source_count": len(unique_source_ids),
                "russia_relevance_score": russia_relevance.relevance_score,
                "russia_reason_codes": russia_relevance.reason_codes,
                "russia_source_region_count": russia_relevance.source_region_russia_count,
                "russia_source_role_count": russia_relevance.source_role_russia_count,
                "russia_policy_signal": russia_relevance.policy_signal,
                "russia_state_signal": russia_relevance.state_signal,
                "russia_major_company_signal": russia_relevance.major_company_signal,
                "russia_market_infra_signal": russia_relevance.market_infra_signal,
                "russia_adoption_signal": russia_relevance.adoption_signal,
                "russia_restriction_signal": russia_relevance.restriction_signal,
                "russia_weak_pr_penalty": russia_relevance.weak_pr_penalty,
            },
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
