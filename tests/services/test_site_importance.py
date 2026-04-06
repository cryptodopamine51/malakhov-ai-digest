from __future__ import annotations

from app.services.site import classify_event_impact_type, compute_event_importance, select_homepage_events


def _item(
    *,
    item_id: int,
    title: str,
    short_summary: str,
    ranking_score: float,
    primary_section: str,
    source_title: str,
) -> dict[str, object]:
    return {
        "id": item_id,
        "title": title,
        "short_summary": short_summary,
        "long_summary": short_summary,
        "ranking_score": ranking_score,
        "primary_section": primary_section,
        "event_date": "2026-03-25",
        "primary_source": {"title": source_title, "region": "global"},
    }


def test_event_importance_assigns_tiers_from_overlay_rules():
    tier_1 = _item(
        item_id=1,
        title="OpenAI acquires TBPN",
        short_summary="Deal expands OpenAI infra position.",
        ranking_score=74,
        primary_section="important",
        source_title="Reuters AI",
    )
    tier_2 = _item(
        item_id=2,
        title="GitHub Copilot adds CLI workflow",
        short_summary="New tooling changes developer workflows.",
        ranking_score=68,
        primary_section="coding",
        source_title="TechCrunch AI",
    )
    tier_3 = _item(
        item_id=3,
        title="Company shared dev log update",
        short_summary="Minor roadmap note from a dev blog.",
        ranking_score=49,
        primary_section="ai_news",
        source_title="Small Dev Blog",
    )

    assert classify_event_impact_type(tier_1).value == "market_shift"
    assert classify_event_impact_type(tier_2).value == "dev_update"
    assert compute_event_importance(tier_1).tier.value == "tier_1"
    assert compute_event_importance(tier_2).tier.value == "tier_2"
    assert compute_event_importance(tier_3).tier.value == "tier_3"


def test_homepage_selection_uses_structured_editorial_mix():
    items = [
        _item(
            item_id=1,
            title="OpenAI acquires TBPN",
            short_summary="Acquisition shifts infra strategy.",
            ranking_score=74,
            primary_section="important",
            source_title="Reuters AI",
        ),
        _item(
            item_id=2,
            title="Major funding round for AI company",
            short_summary="Large investment changes market expectations.",
            ranking_score=70,
            primary_section="investments",
            source_title="VentureBeat AI",
        ),
        _item(
            item_id=3,
            title="GitHub Copilot adds CLI workflow",
            short_summary="Developer tooling update with broader impact.",
            ranking_score=68,
            primary_section="coding",
            source_title="TechCrunch AI",
        ),
        _item(
            item_id=4,
            title="Another tool update",
            short_summary="Meaningful but mid-tier product update.",
            ranking_score=64,
            primary_section="coding",
            source_title="The Verge AI",
        ),
        _item(
            item_id=5,
            title="New AI platform launches",
            short_summary="Launch creates a new competitive option for enterprise buyers.",
            ranking_score=71,
            primary_section="ai_news",
            source_title="Reuters AI",
        ),
        _item(
            item_id=6,
            title="Минцифры готовит регулирование AI-сервисов",
            short_summary="Regulation changes compliance requirements for local AI vendors.",
            ranking_score=63,
            primary_section="ai_news",
            source_title="Reuters AI",
        ),
        _item(
            item_id=7,
            title="Яндекс Cloud запускает новую AI-платформу",
            short_summary="New infra stack changes local platform choices for enterprise teams.",
            ranking_score=61,
            primary_section="ai_news",
            source_title="Reuters AI",
        ),
        _item(
            item_id=8,
            title="Company shared dev log update",
            short_summary="Minor roadmap note from a dev blog.",
            ranking_score=49,
            primary_section="ai_news",
            source_title="Small Dev Blog",
        ),
    ]

    selected = select_homepage_events(items)
    selected_ids = [int(item["id"]) for item in selected]

    assert 1 in selected_ids
    assert 2 in selected_ids
    assert 5 in selected_ids
    assert 3 in selected_ids or 4 in selected_ids or 7 in selected_ids
    assert 6 in selected_ids or 7 in selected_ids
    assert 8 not in selected_ids
    assert len([item for item in selected if str(item["primary_section"]) == "ai_news"]) <= 2


def test_weak_official_dev_item_is_demoted_without_clear_consequence():
    item = _item(
        item_id=9,
        title="GitHub Blog updates internal tooling note",
        short_summary="Команда поделилась небольшим обновлением внутренних сценариев разработки.",
        ranking_score=66,
        primary_section="coding",
        source_title="GitHub Blog AI and ML",
    )

    decision = compute_event_importance(item)

    assert decision.consequence_gate_triggered is True
    assert decision.excluded is True
    assert decision.exclusion_reason == "weak_official_without_consequence"


def test_strong_official_item_with_real_market_or_infra_impact_can_surface():
    item = _item(
        item_id=10,
        title="OpenAI запускает новый enterprise GPU platform stack",
        short_summary="Компания запускает новую инфраструктурную платформу для enterprise-клиентов. Это влияет на рынок облачных AI-сервисов и конкуренцию платформ.",
        ranking_score=67,
        primary_section="important",
        source_title="OpenAI News",
    )

    decision = compute_event_importance(item)

    assert decision.consequence_gate_triggered is False
    assert decision.excluded is False
    assert decision.tier.value in {"tier_1", "tier_2"}
