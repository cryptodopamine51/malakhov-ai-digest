from __future__ import annotations

from datetime import UTC, datetime

from httpx import ASGITransport, AsyncClient

from app.api.main import create_app
from app.db.models import RawItem, RawItemStatus, Source, SourceType


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
    assert detail_response.json()["event"]["title"] == "OpenAI launches GPT-5 for developers"
    assert debug_response.status_code == 200
    assert "shortlist_passed" in debug_response.json()
    assert "selected_for_issue" in debug_response.json()
    assert llm_usage_response.status_code == 200
    assert preview_response.status_code == 200
    assert "important" in preview_response.json()["sections"]
