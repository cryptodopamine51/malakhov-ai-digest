from __future__ import annotations

from datetime import UTC, datetime, date

from httpx import ASGITransport, AsyncClient
from sqlalchemy import select

from app.api.main import create_app
from app.db.models import ProcessRun, ProcessRunStatus, Source, SourceRun, SourceRunStatus
from app.services.deliveries import IssueDeliveryService
from app.services.digest import DigestBuilderService
from tests.digest.test_digest_builder_and_delivery import FakeBot, seed_daily_event_data


async def test_quality_report_endpoint_returns_structured_quality_snapshot(session_factory):
    await seed_daily_event_data(session_factory)

    async with session_factory() as session:
        source_rows = list((await session.scalars(select(Source).order_by(Source.id.asc()))).all())
        session.add_all(
            [
                SourceRun(
                    source_id=source_rows[0].id,
                    started_at=datetime(2026, 4, 1, 10, 0, tzinfo=UTC),
                    finished_at=datetime(2026, 4, 1, 10, 0, 3, tzinfo=UTC),
                    status=SourceRunStatus.SUCCESS,
                    fetched_count=4,
                    inserted_count=2,
                    duplicate_count=2,
                    failed_count=0,
                    duration_ms=3000,
                ),
                SourceRun(
                    source_id=source_rows[-1].id,
                    started_at=datetime(2026, 4, 1, 11, 0, tzinfo=UTC),
                    finished_at=datetime(2026, 4, 1, 11, 0, 2, tzinfo=UTC),
                    status=SourceRunStatus.SUCCESS,
                    fetched_count=3,
                    inserted_count=1,
                    duplicate_count=2,
                    failed_count=0,
                    duration_ms=2000,
                ),
                ProcessRun(
                    started_at=datetime(2026, 4, 1, 12, 0, tzinfo=UTC),
                    finished_at=datetime(2026, 4, 1, 12, 0, 5, tzinfo=UTC),
                    status=ProcessRunStatus.SUCCESS,
                    raw_items_considered=5,
                    normalized_count=4,
                    clustered_count=4,
                    discarded_count=1,
                    created_events=5,
                    updated_events=5,
                    clusters_merged=0,
                    ambiguous_count=0,
                    shortlist_count=3,
                    llm_event_count=2,
                    raw_shortlist_evaluated_count=5,
                    raw_shortlist_accepted_count=4,
                    raw_shortlist_rejected_count=1,
                    raw_shortlist_reject_breakdown_json={"weak_title": 1},
                    duration_ms=5000,
                ),
            ]
        )
        await session.commit()

    builder = DigestBuilderService(session_factory)
    await builder.build_daily_issue(date(2026, 3, 25))
    bot = FakeBot()
    await IssueDeliveryService(session_factory).send_daily_issue_to_daily_users(bot, issue_date=date(2026, 3, 25))

    app = create_app(session_factory=session_factory, telegram_bot=bot, enable_scheduler=False)

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.get("/internal/debug/quality-report", params={"days": 30})

    assert response.status_code == 200
    payload = response.json()
    assert payload["window"]["days"] == 30
    assert "sources" in payload
    assert "shortlist" in payload
    assert "events" in payload
    assert "telegram" in payload
    assert "ai_in_russia" in payload
    assert payload["shortlist"]["total_evaluated"] >= 5
    assert "weak_title" in payload["shortlist"]["reject_breakdown"]
    assert payload["events"]["event_count"] >= 5
    assert "average_ranking_score" in payload["events"]
    assert "surface_tier_distribution" in payload["events"]
    assert payload["telegram"]["broader_issue_items"] >= payload["telegram"]["telegram_selected_items"]
    assert "models_services" in payload["telegram"]["per_section_distribution"] or "tools_coding" in payload["telegram"]["per_section_distribution"]
    assert payload["telegram"]["policy_snapshot"]["min_ranking_score"] > 0
    assert payload["ai_in_russia"]["russia_qualified_event_count"] >= 1
    assert payload["ai_in_russia"]["weak_pr_penalty_activations"] >= 1
    assert "surface_excluded_russia_event_count" in payload["ai_in_russia"]
    assert payload["sources"]["summary"]["region_breakdown"]["russia"] >= 1
    assert "top_sources_by_homepage" in payload["sources"]
    assert "top_sources_by_surface_demotions" in payload["sources"]
