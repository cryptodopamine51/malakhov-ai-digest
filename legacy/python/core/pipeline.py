from __future__ import annotations

from dataclasses import dataclass, field

from app.db.models import EventSection, SourceType


@dataclass(frozen=True, slots=True)
class ClusteringConfig:
    title_similarity_threshold: float = 0.72
    text_similarity_threshold: float = 0.55
    match_threshold: float = 0.4
    time_window_hours: int = 72
    title_weight: float = 0.4
    text_weight: float = 0.2
    entity_weight: float = 0.2
    time_weight: float = 0.1
    url_weight: float = 0.1


@dataclass(frozen=True, slots=True)
class ClassificationConfig:
    section_keywords: dict[EventSection, tuple[str, ...]] = field(
        default_factory=lambda: {
            EventSection.AI_NEWS: (
                "model",
                "models",
                "release",
                "launch",
                "ai",
                "llm",
                "research",
                "inference",
                "training",
                "agent",
                "foundation model",
            ),
            EventSection.CODING: (
                "code",
                "coding",
                "developer",
                "developers",
                "sdk",
                "api",
                "cli",
                "ide",
                "repo",
                "open-source",
                "benchmark",
                "copilot",
                "codex",
                "cursor",
                "tooling",
            ),
            EventSection.INVESTMENTS: (
                "funding",
                "investment",
                "investments",
                "acquisition",
                "acquires",
                "acquired",
                "raises",
                "series a",
                "series b",
                "valuation",
                "startup",
                "partnership",
            ),
            EventSection.IMPORTANT: (
                "flagship",
                "market",
                "major",
                "launch",
                "release",
                "strategic",
                "partnership",
                "funding",
                "acquisition",
            ),
            EventSection.ALPHA: (),
        }
    )
    important_bias_bonus: float = 0.2
    source_bias_bonus: float = 0.3


@dataclass(frozen=True, slots=True)
class ScoringConfig:
    source_type_quality: dict[SourceType, float] = field(
        default_factory=lambda: {
            SourceType.OFFICIAL_BLOG: 1.15,
            SourceType.RSS_FEED: 0.82,
            SourceType.WEBSITE: 0.5,
        }
    )
    highlight_threshold: float = 70.0


CLUSTERING_CONFIG = ClusteringConfig()
CLASSIFICATION_CONFIG = ClassificationConfig()
SCORING_CONFIG = ScoringConfig()
