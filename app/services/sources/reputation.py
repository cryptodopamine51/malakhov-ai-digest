from __future__ import annotations

from dataclasses import dataclass

from app.db.models import Event, EventSource, RawItem, Source, SourceType


@dataclass(frozen=True, slots=True)
class SourceReputation:
    tier: str
    score: float
    is_official: bool
    is_engineering: bool
    is_research: bool


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

    is_official = source.source_type is SourceType.OFFICIAL_BLOG or any(token in combined for token in ("official", "product", "release notes"))
    is_engineering = any(token in combined for token in ("engineering", "developer", "dev blog", "sdk", "api", "github"))
    is_research = any(token in combined for token in ("research", "labs", "paper", "arxiv", "benchmark"))

    type_score = {
        SourceType.OFFICIAL_BLOG: 1.15,
        SourceType.RSS_FEED: 0.8,
        SourceType.WEBSITE: 0.55,
    }.get(source.source_type, 0.55)
    priority_score = min(source.priority_weight / 100, 1.0)

    bonus = 0.0
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

    score = round(min(type_score + priority_score * 0.5 + bonus, 1.85), 3)
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


def score_raw_item_source(raw_item: RawItem) -> float:
    return score_source(raw_item.source).score


def score_event_source_quality(event: Event) -> SourceReputation:
    return score_source(event.primary_source)
