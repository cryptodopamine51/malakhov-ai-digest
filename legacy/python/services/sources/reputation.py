from __future__ import annotations

from dataclasses import dataclass

from app.db.models import Event, EventSource, RawItem, Source, SourceRole, SourceStatus, SourceType
from app.services.sources.policy import validate_source_role, validate_source_status


@dataclass(frozen=True, slots=True)
class SourceReputation:
    tier: str
    score: float
    is_official: bool
    is_engineering: bool
    is_research: bool


def classify_source_pool_role(source: Source | None) -> str:
    if source is None:
        return SourceRole.VERIFICATION.value
    return validate_source_role(source.role).value


def score_source(source: Source | None) -> SourceReputation:
    if source is None:
        return SourceReputation(
            tier="secondary",
            score=0.45,
            is_official=False,
            is_engineering=False,
            is_research=False,
        )

    title = source.title.lower()
    handle = source.handle_or_url.lower()
    combined = f"{title} {handle}"
    role = validate_source_role(source.role)
    status = validate_source_status(source.status)

    is_official = source.source_type is SourceType.OFFICIAL_BLOG or any(token in combined for token in ("official", "product", "release notes"))
    is_engineering = any(token in combined for token in ("engineering", "developer", "dev blog", "sdk", "api", "github"))
    is_research = any(token in combined for token in ("research", "labs", "paper", "arxiv", "benchmark"))

    type_score = {
        SourceType.OFFICIAL_BLOG: 1.15,
        SourceType.RSS_FEED: 0.8,
        SourceType.WEBSITE: 0.55,
    }.get(source.source_type, 0.55)
    priority_score = min(source.priority_weight / 100, 1.0)

    bonus = {
        SourceRole.SIGNAL_FEEDER: 0.15,
        SourceRole.VERIFICATION: 0.2,
        SourceRole.CODING: 0.12,
        SourceRole.INVESTMENTS: 0.12,
        SourceRole.RUSSIA: 0.08,
    }[role]
    tier = "secondary"
    if is_official:
        bonus += 0.35
        tier = "official"
    elif is_engineering or is_research:
        bonus += 0.2
        tier = "engineering_research"
    elif source.priority_weight >= 85:
        bonus += 0.1
        tier = "strong_domain_media"
    elif source.priority_weight >= 65:
        tier = "domain_media"

    if role is SourceRole.VERIFICATION and tier == "secondary":
        tier = "verification"
    if role is SourceRole.RUSSIA and tier == "secondary":
        tier = "regional_media"
    if role is SourceRole.CODING and tier == "secondary":
        tier = "technical_media"
    if role is SourceRole.INVESTMENTS and tier == "secondary":
        tier = "market_media"

    score = min(type_score + priority_score * 0.5 + bonus, 1.85)
    if status is SourceStatus.QUARANTINE:
        score *= 0.75
    elif status is SourceStatus.DISABLED:
        score *= 0.5
    score = round(score, 3)
    return SourceReputation(
        tier=tier,
        score=score,
        is_official=is_official,
        is_engineering=is_engineering,
        is_research=is_research,
    )


def score_event_source_link(link: EventSource) -> float:
    reputation = score_source(link.source)
    raw_item = link.raw_item
    published_ts = (
        (raw_item.published_at or raw_item.fetched_at).timestamp()
        if raw_item is not None and (raw_item.published_at or raw_item.fetched_at) is not None
        else 0.0
    )
    return reputation.score * 1000 - published_ts / 1_000_000


def is_verification_source(source: Source | None) -> bool:
    if source is None:
        return False
    role = validate_source_role(source.role)
    reputation = score_source(source)
    return role is SourceRole.VERIFICATION or reputation.is_official or reputation.is_research or reputation.is_engineering


def score_raw_item_source(raw_item: RawItem) -> float:
    return score_source(raw_item.source).score


def score_event_source_quality(event: Event) -> SourceReputation:
    return score_source(event.primary_source)
