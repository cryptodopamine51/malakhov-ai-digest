from __future__ import annotations

from datetime import date

from httpx import ASGITransport, AsyncClient

from app.api.main import create_app
from app.db.models import AlphaEntry, AlphaEntryStatus
from app.services.digest import DigestBuilderService
from tests.digest.test_digest_builder_and_delivery import seed_daily_event_data


async def test_public_read_api_foundation(session_factory):
    await seed_daily_event_data(session_factory)
    async with session_factory() as session:
        session.add(
            AlphaEntry(
                title="Ручной альфа-сигнал",
                body_short="Короткий альфа-сигнал для публичного API.",
                body_long="Длинное описание альфа-сигнала.",
                source_links_json=["https://example.com/alpha"],
                event_id=None,
                priority_rank=10,
                publish_date=date(2026, 3, 25),
                status=AlphaEntryStatus.PUBLISHED,
                created_by="editor",
            )
        )
        await session.commit()

    builder = DigestBuilderService(session_factory)
    issue_result = await builder.build_daily_issue(date(2026, 3, 25))

    app = create_app(session_factory=session_factory, enable_scheduler=False)

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        events_response = await client.get("/api/events")
        event_id = events_response.json()["items"][0]["id"]
        event_detail_response = await client.get(f"/api/events/{event_id}")
        issues_response = await client.get("/api/issues")
        issue_detail_response = await client.get(f"/api/issues/{issue_result.issue_id}")
        issue_section_response = await client.get(f"/api/issues/{issue_result.issue_id}/sections/all")
        alpha_response = await client.get("/api/alpha", params={"date": "2026-03-25"})

    assert events_response.status_code == 200
    assert event_detail_response.status_code == 200
    assert issues_response.status_code == 200
    assert issue_detail_response.status_code == 200
    assert issue_section_response.status_code == 200
    assert alpha_response.status_code == 200

    public_event = events_response.json()["items"][0]
    assert "title" in public_event
    assert "short_summary" in public_event
    assert "ranking_score" in public_event
    assert "primary_source" in public_event
    assert "score_components_json" not in public_event
    assert "selected_for_issue" not in public_event

    event_detail = event_detail_response.json()["item"]
    assert "long_summary" in event_detail
    assert "categories" in event_detail
    assert "tags" in event_detail
    assert "event_quality" not in event_detail
    assert "editorial" not in event_detail

    issues_payload = issues_response.json()
    assert issues_payload["items"]
    assert "meta" in issues_payload
    assert "daily_main_debug" not in issues_payload["items"][0]

    issue_detail = issue_detail_response.json()
    assert "issue" in issue_detail
    assert "sections" in issue_detail
    assert "items" in issue_detail
    assert "daily_main_debug" not in issue_detail
    assert "telegram_selection" not in issue_detail

    section_payload = issue_section_response.json()
    assert section_payload["section"] == "all"
    assert section_payload["items"]
    assert "suppressed_from_main" not in section_payload
    assert "main_section_visible" not in section_payload

    alpha_payload = alpha_response.json()
    assert len(alpha_payload["items"]) == 1
    assert alpha_payload["items"][0]["title"] == "Ручной альфа-сигнал"
    assert "status" not in alpha_payload["items"][0]
    assert "created_by" not in alpha_payload["items"][0]
