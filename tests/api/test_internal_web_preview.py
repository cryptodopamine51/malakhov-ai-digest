from __future__ import annotations

from datetime import date

from httpx import ASGITransport, AsyncClient

from app.api.main import create_app
from app.db.models import AlphaEntry, AlphaEntryStatus
from app.services.digest import DigestBuilderService
from tests.digest.test_digest_builder_and_delivery import seed_daily_event_data


async def test_internal_web_preview_routes_render(session_factory):
    await seed_daily_event_data(session_factory)
    async with session_factory() as session:
        session.add(
            AlphaEntry(
                title="Preview alpha",
                body_short="Internal alpha preview item.",
                body_long="Longer alpha body for internal preview.",
                source_links_json=["https://example.com/alpha-preview"],
                event_id=None,
                priority_rank=5,
                publish_date=date(2026, 3, 25),
                status=AlphaEntryStatus.PUBLISHED,
                created_by="editor",
            )
        )
        await session.commit()

    builder = DigestBuilderService(session_factory)
    issue_result = await builder.build_daily_issue(date(2026, 3, 25))
    issue = await builder.get_issue(issue_result.issue_id)
    assert issue is not None
    first_event_id = next(item.event_id for item in issue.items if item.event_id is not None)

    app = create_app(session_factory=session_factory, enable_scheduler=False)

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        homepage = await client.get("/preview")
        events_feed = await client.get("/preview/events")
        event_detail = await client.get(f"/preview/events/{first_event_id}")
        issue_detail = await client.get(f"/preview/issues/{issue_result.issue_id}")
        issue_section = await client.get(f"/preview/issues/{issue_result.issue_id}/sections/all")
        alpha_page = await client.get("/preview/alpha", params={"date": "2026-03-25"})

    assert homepage.status_code == 200
    assert "Internal Web Preview" in homepage.text
    assert "Latest issue" in homepage.text
    assert "OpenAI launches GPT-5" in homepage.text

    assert events_feed.status_code == 200
    assert "Все события" in events_feed.text
    assert "OpenAI launches GPT-5" in events_feed.text

    assert event_detail.status_code == 200
    assert "Event detail" in event_detail.text
    assert "OpenAI launches GPT-5" in event_detail.text

    assert issue_detail.status_code == 200
    assert "Issue" in issue_detail.text
    assert issue.title in issue_detail.text

    assert issue_section.status_code == 200
    assert "Issue section" in issue_section.text
    assert "all" in issue_section.text

    assert alpha_page.status_code == 200
    assert "Published alpha" in alpha_page.text
    assert "Preview alpha" in alpha_page.text
