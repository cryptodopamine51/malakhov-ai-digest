from __future__ import annotations

from datetime import UTC, datetime

from httpx import ASGITransport, AsyncClient

from app.api.main import create_app
from app.db.models import Event, EventCategory, EventSection, RawItem, RawItemStatus, Source, SourceRegion, SourceRole, SourceType


async def test_internal_event_preview_endpoints(session_factory):
    async with session_factory() as session:
        source = Source(
            title="OpenAI News",
            handle_or_url="https://openai.com/news/",
            source_type=SourceType.OFFICIAL_BLOG,
            priority_weight=100,
            is_active=True,
            language="en",
            country_scope="global",
            section_bias="ai_news|important",
        )
        session.add(source)
        await session.flush()
        session.add(
            RawItem(
                source_id=source.id,
                external_id="gpt5-openai",
                source_type=source.source_type,
                author_name="Author",
                published_at=datetime(2026, 3, 25, 9, 0, tzinfo=UTC),
                canonical_url="https://openai.com/news/gpt-5-launch",
                raw_title="OpenAI launches GPT-5 for developers",
                raw_text="OpenAI launches GPT-5 with a new API and coding tools.",
                raw_payload_json={"title": "OpenAI launches GPT-5 for developers"},
                language="en",
                status=RawItemStatus.FETCHED,
            )
        )
        await session.commit()

    app = create_app(session_factory=session_factory, enable_scheduler=False)

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        process_response = await client.post("/internal/jobs/process-events")
        process_runs_response = await client.get("/internal/debug/process-runs")
        events_response = await client.get("/internal/events")
        event_id = events_response.json()["items"][0]["id"]
        detail_response = await client.get(f"/internal/events/{event_id}")
        debug_response = await client.get(f"/internal/debug/events/{event_id}")
        llm_usage_response = await client.get("/internal/debug/llm-usage")
        preview_response = await client.get("/internal/events/preview/day/2026-03-25")

    assert process_response.status_code == 200
    assert process_response.json()["created_events"] == 1
    assert "process_run_id" in process_response.json()
    assert process_runs_response.status_code == 200
    assert len(process_runs_response.json()["items"]) == 1
    assert events_response.status_code == 200
    assert len(events_response.json()["items"]) == 1
    assert detail_response.status_code == 200
    assert "OpenAI" in detail_response.json()["event"]["title"]
    assert "GPT-5" in detail_response.json()["event"]["title"]
    assert any("\u0400" <= ch <= "\u04FF" for ch in detail_response.json()["event"]["title"])
    assert "ranking_score" in detail_response.json()["event"]
    assert debug_response.status_code == 200
    assert "shortlist_passed" in debug_response.json()
    assert "selected_for_issue" in debug_response.json()
    assert "event_quality" in debug_response.json()
    assert "event_importance_tier" in debug_response.json()["event_quality"]
    assert "event_impact_type" in debug_response.json()["event_quality"]
    assert "impact_boost_applied" in debug_response.json()["event_quality"]
    assert "source_surface_adjustment" in debug_response.json()["event_quality"]
    assert "consequence_gate_triggered" in debug_response.json()["event_quality"]
    assert "surface_excluded" in debug_response.json()["event_quality"]
    assert debug_response.json()["editorial"]["language_default"] == "ru"
    assert llm_usage_response.status_code == 200
    assert preview_response.status_code == 200
    assert "important" in preview_response.json()["sections"]


async def test_internal_event_debug_endpoint_includes_related_previous_event(session_factory):
    async with session_factory() as session:
        source = Source(
            title="OpenAI News",
            handle_or_url="https://openai.com/news/",
            source_type=SourceType.OFFICIAL_BLOG,
            priority_weight=100,
            is_active=True,
            language="en",
            country_scope="global",
            section_bias="ai_news|important",
        )
        session.add(source)
        await session.flush()

        previous_event = Event(
            event_date=datetime(2026, 3, 30, 9, 0, tzinfo=UTC).date(),
            title="OpenAI previews GPT-5",
            short_summary="OpenAI teased GPT-5.",
            long_summary="OpenAI teased GPT-5 in a newsroom update.",
            primary_source_id=source.id,
            primary_source_url="https://openai.com/news/gpt-5-preview",
            importance_score=80,
            market_impact_score=75,
            ai_news_score=88,
            coding_score=55,
            investment_score=10,
            confidence_score=84,
            is_highlight=True,
        )
        session.add(previous_event)
        await session.flush()
        session.add(
            EventCategory(
                event_id=previous_event.id,
                section=EventSection.IMPORTANT,
                score=0.9,
                is_primary_section=True,
            )
        )

        current_event = Event(
            event_date=datetime(2026, 3, 31, 9, 0, tzinfo=UTC).date(),
            related_previous_event_id=previous_event.id,
            title="OpenAI launches GPT-5",
            short_summary="OpenAI launched GPT-5.",
            long_summary="OpenAI launched GPT-5 with new API updates.",
            primary_source_id=source.id,
            primary_source_url="https://openai.com/news/gpt-5-launch",
            importance_score=92,
            market_impact_score=88,
            ai_news_score=95,
            coding_score=60,
            investment_score=10,
            confidence_score=90,
            is_highlight=True,
        )
        session.add(current_event)
        await session.flush()
        session.add(
            EventCategory(
                event_id=current_event.id,
                section=EventSection.IMPORTANT,
                score=0.95,
                is_primary_section=True,
            )
        )
        await session.commit()

    app = create_app(session_factory=session_factory, enable_scheduler=False)

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        debug_response = await client.get(f"/internal/debug/events/{current_event.id}")

    assert debug_response.status_code == 200
    assert debug_response.json()["related_previous_event"]["id"] == previous_event.id
    assert debug_response.json()["related_previous_event"]["primary_section"] == EventSection.IMPORTANT.value


async def test_event_debug_exposes_canonical_source_and_verification_info(session_factory):
    async with session_factory() as session:
        verification_source = Source(
            title="OpenAI News",
            handle_or_url="https://openai.com/news/",
            source_type=SourceType.OFFICIAL_BLOG,
            priority_weight=100,
            role=SourceRole.VERIFICATION,
            is_active=True,
            language="en",
            country_scope="global",
            section_bias="ai_news|important",
        )
        feeder_source = Source(
            title="TechCrunch AI",
            handle_or_url="https://techcrunch.com/category/artificial-intelligence/",
            source_type=SourceType.WEBSITE,
            priority_weight=90,
            role=SourceRole.SIGNAL_FEEDER,
            is_active=True,
            language="en",
            country_scope="global",
            section_bias="ai_news|important",
        )
        session.add_all([verification_source, feeder_source])
        await session.flush()
        session.add_all(
            [
                RawItem(
                    source_id=feeder_source.id,
                    external_id="tc-gpt5",
                    source_type=feeder_source.source_type,
                    author_name="Author",
                    published_at=datetime(2026, 3, 25, 10, 0, tzinfo=UTC),
                    canonical_url="https://techcrunch.com/2026/03/25/openai-gpt5/",
                    raw_title="TechCrunch covers GPT-5 launch",
                    raw_text="TechCrunch covers GPT-5 launch with developer impact and market context.",
                    raw_payload_json={"title": "TechCrunch covers GPT-5 launch"},
                    language="en",
                    status=RawItemStatus.FETCHED,
                ),
                RawItem(
                    source_id=verification_source.id,
                    external_id="openai-gpt5",
                    source_type=verification_source.source_type,
                    author_name="Author",
                    published_at=datetime(2026, 3, 25, 11, 0, tzinfo=UTC),
                    canonical_url="https://openai.com/news/gpt-5-launch",
                    raw_title="OpenAI launches GPT-5 for developers",
                    raw_text="OpenAI launches GPT-5 with a new API, coding tools, and enterprise rollout details.",
                    raw_payload_json={"title": "OpenAI launches GPT-5 for developers"},
                    language="en",
                    status=RawItemStatus.FETCHED,
                ),
            ]
        )
        await session.commit()

    app = create_app(session_factory=session_factory, enable_scheduler=False)

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        process_response = await client.post("/internal/jobs/process-events")
        assert process_response.status_code == 200
        events_response = await client.get("/internal/events")
        event_id = events_response.json()["items"][0]["id"]
        debug_response = await client.get(f"/internal/debug/events/{event_id}")

    assert debug_response.status_code == 200
    event_quality = debug_response.json()["event_quality"]
    assert event_quality["canonical_source"]["title"] == "OpenAI News"
    assert event_quality["canonical_source_reason"] == "verification_source_preferred"
    assert event_quality["has_verification_source"] is True
    assert event_quality["verification_source_count"] >= 1
    assert "source_strength_signal" in event_quality["score_components"]
    assert debug_response.json()["editorial"]["short_summary"]["english_leakage_ratio"] <= 0.5


async def test_event_debug_exposes_russia_relevance_reasons(session_factory):
    async with session_factory() as session:
        source = Source(
            title="Минцифры Новости",
            handle_or_url="https://digital.gov.ru/news/",
            source_type=SourceType.OFFICIAL_BLOG,
            priority_weight=92,
            role=SourceRole.RUSSIA,
            region=SourceRegion.RUSSIA,
            is_active=True,
            language="ru",
            country_scope="russia",
            section_bias="important|ai_news",
        )
        session.add(source)
        await session.flush()
        session.add(
            RawItem(
                source_id=source.id,
                external_id="mincifry-ai-law",
                source_type=source.source_type,
                author_name="Author",
                published_at=datetime(2026, 3, 25, 11, 0, tzinfo=UTC),
                canonical_url="https://digital.gov.ru/news/ai-law",
                raw_title="Минцифры готовит законопроект по регулированию AI-сервисов",
                raw_text="Минцифры и правительство готовят законопроект и правила compliance для AI-сервисов в России.",
                raw_payload_json={"title": "Минцифры готовит законопроект по регулированию AI-сервисов"},
                language="ru",
                status=RawItemStatus.FETCHED,
            )
        )
        await session.commit()

    app = create_app(session_factory=session_factory, enable_scheduler=False)

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        process_response = await client.post("/internal/jobs/process-events")
        assert process_response.status_code == 200
        events_response = await client.get("/internal/events")
        event_id = events_response.json()["items"][0]["id"]
        debug_response = await client.get(f"/internal/debug/events/{event_id}")

    assert debug_response.status_code == 200
    russia = debug_response.json()["event_quality"]["russia_relevance"]
    assert russia["qualified_for_ai_russia"] is True
    assert russia["source_region_is_russia"] is True
    assert "russia_policy_signal" in russia["reason_codes"]
    assert russia["signals"]["state_signal"] is True
