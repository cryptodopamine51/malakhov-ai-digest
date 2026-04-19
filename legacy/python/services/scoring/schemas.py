from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class ScoreResult:
    importance_score: float
    market_impact_score: float
    ai_news_score: float
    coding_score: float
    investment_score: float
    confidence_score: float
    ranking_score: float
    supporting_source_count: int
    verification_source_count: int
    has_verification_source: bool
    score_components: dict[str, object]
    is_highlight: bool
