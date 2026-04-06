from __future__ import annotations

from datetime import UTC, datetime, timedelta

from app.db.models import EventSection, RawItem, RawItemStatus, Source, SourceRegion, SourceRole, SourceType
from app.services.classification.schemas import ClassifiedCategory
from app.services.scoring import ScoringService


def _build_source(
    *,
    title: str,
    source_type: SourceType,
    priority_weight: int,
    role: SourceRole,
    region: SourceRegion = SourceRegion.GLOBAL,
) -> Source:
    return Source(
        title=title,
        handle_or_url=f"https://example.com/{title.lower().replace(' ', '-')}",
        source_type=source_type,
        priority_weight=priority_weight,
        editorial_priority=priority_weight,
        role=role,
        region=region,
        is_active=True,
        language="en",
        country_scope="global",
    )


def _build_raw_item(*, source: Source, title: str, published_at: datetime) -> RawItem:
    item = RawItem(
        source_id=1,
        external_id=title.lower().replace(" ", "-"),
        source_type=source.source_type,
        author_name="Author",
        published_at=published_at,
        fetched_at=published_at,
        canonical_url=f"https://example.com/{title.lower().replace(' ', '-')}",
        raw_title=title,
        raw_text=f"{title} with enough supporting detail for scoring and verification analysis.",
        raw_payload_json={"title": title},
        language="en",
        status=RawItemStatus.CLUSTERED,
        entities_json={"companies": ["OpenAI"], "products": ["GPT-5"]},
    )
    item.source = source
    return item


def test_stronger_source_and_support_combination_scores_above_weaker_one():
    service = ScoringService()
    strong_verification = _build_source(
        title="OpenAI News",
        source_type=SourceType.OFFICIAL_BLOG,
        priority_weight=100,
        role=SourceRole.VERIFICATION,
    )
    strong_support = _build_source(
        title="TechCrunch AI",
        source_type=SourceType.WEBSITE,
        priority_weight=90,
        role=SourceRole.SIGNAL_FEEDER,
    )
    weak_source = _build_source(
        title="Small AI Blog",
        source_type=SourceType.WEBSITE,
        priority_weight=45,
        role=SourceRole.SIGNAL_FEEDER,
    )
    categories = [ClassifiedCategory(section=EventSection.AI_NEWS, score=0.9, is_primary_section=True)]

    strong_score = service.score(
        [
            _build_raw_item(source=strong_verification, title="OpenAI launches GPT-5", published_at=datetime.now(UTC) - timedelta(hours=2)),
            _build_raw_item(source=strong_support, title="TechCrunch confirms GPT-5 launch", published_at=datetime.now(UTC) - timedelta(hours=1)),
        ],
        categories,
    )
    weak_score = service.score(
        [
            _build_raw_item(source=weak_source, title="AI blog roundup", published_at=datetime.now(UTC) - timedelta(hours=2)),
        ],
        categories,
    )

    assert strong_score.ranking_score > weak_score.ranking_score
    assert strong_score.confidence_score > weak_score.confidence_score
    assert strong_score.supporting_source_count == 1


def test_verification_source_increases_score_and_confidence():
    service = ScoringService()
    feeder = _build_source(
        title="TechCrunch AI",
        source_type=SourceType.WEBSITE,
        priority_weight=90,
        role=SourceRole.SIGNAL_FEEDER,
    )
    verification = _build_source(
        title="Anthropic News",
        source_type=SourceType.OFFICIAL_BLOG,
        priority_weight=98,
        role=SourceRole.VERIFICATION,
    )
    categories = [ClassifiedCategory(section=EventSection.AI_NEWS, score=0.8, is_primary_section=True)]

    without_verification = service.score(
        [_build_raw_item(source=feeder, title="Claude update", published_at=datetime.now(UTC) - timedelta(hours=2))],
        categories,
    )
    with_verification = service.score(
        [
            _build_raw_item(source=feeder, title="Claude update", published_at=datetime.now(UTC) - timedelta(hours=2)),
            _build_raw_item(source=verification, title="Anthropic confirms Claude update", published_at=datetime.now(UTC) - timedelta(hours=1)),
        ],
        categories,
    )

    assert without_verification.has_verification_source is False
    assert with_verification.has_verification_source is True
    assert with_verification.verification_source_count == 1
    assert with_verification.confidence_score > without_verification.confidence_score
    assert with_verification.ranking_score > without_verification.ranking_score


def test_russia_regulation_event_gets_stronger_local_relevance_signals():
    service = ScoringService()
    source = _build_source(
        title="Минцифры Новости",
        source_type=SourceType.OFFICIAL_BLOG,
        priority_weight=92,
        role=SourceRole.RUSSIA,
        region=SourceRegion.RUSSIA,
    )
    pr_source = _build_source(
        title="VK Company Press",
        source_type=SourceType.WEBSITE,
        priority_weight=70,
        role=SourceRole.RUSSIA,
        region=SourceRegion.RUSSIA,
    )
    categories = [ClassifiedCategory(section=EventSection.AI_NEWS, score=0.75, is_primary_section=True)]

    regulation_score = service.score(
        [
            _build_raw_item(
                source=source,
                title="Минцифры готовит регулирование AI-сервисов",
                published_at=datetime.now(UTC) - timedelta(hours=3),
            ),
        ],
        categories,
    )
    weak_pr_score = service.score(
        [
            _build_raw_item(
                source=pr_source,
                title="VK рассказал на форуме про AI-направление",
                published_at=datetime.now(UTC) - timedelta(hours=3),
            ),
        ],
        categories,
    )

    assert regulation_score.score_components["russia_relevance_score"] > weak_pr_score.score_components["russia_relevance_score"]
    assert "russia_policy_signal" in regulation_score.score_components["russia_reason_codes"]
    assert weak_pr_score.score_components["russia_weak_pr_penalty"] is True
    assert regulation_score.ranking_score > weak_pr_score.ranking_score


def test_russia_major_platform_event_gets_market_signal():
    service = ScoringService()
    source = _build_source(
        title="Yandex Cloud Blog",
        source_type=SourceType.OFFICIAL_BLOG,
        priority_weight=88,
        role=SourceRole.RUSSIA,
        region=SourceRegion.RUSSIA,
    )
    categories = [ClassifiedCategory(section=EventSection.AI_NEWS, score=0.78, is_primary_section=True)]

    platform_score = service.score(
        [
            _build_raw_item(
                source=source,
                title="Яндекс Cloud запускает новую AI-платформу с GPU-кластером",
                published_at=datetime.now(UTC) - timedelta(hours=2),
            ),
        ],
        categories,
    )

    assert platform_score.score_components["russia_market_infra_signal"] is True
    assert platform_score.score_components["russia_major_company_signal"] is True
    assert platform_score.score_components["russia_relevance_score"] >= 0.58
