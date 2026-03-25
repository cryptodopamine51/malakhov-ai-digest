from __future__ import annotations

import httpx
from httpx import ASGITransport, AsyncClient

from app.api.main import create_app
from app.db.models import Source, SourceType
from tests.helpers import RSS_FEED_XML, build_http_client


async def test_internal_preview_endpoints_and_manual_ingest(session_factory):
    async with session_factory() as session:
        source = Source(
            source_type=SourceType.RSS_FEED,
            title="Example RSS",
            handle_or_url="https://example.com/feed.xml",
            priority_weight=10,
            is_active=True,
            language="en",
            country_scope="global",
        )
        session.add(source)
        await session.commit()
        source_id = source.id

    http_client = build_http_client(
        {
            "https://example.com/feed.xml": httpx.Response(200, text=RSS_FEED_XML),
        }
    )
    app = create_app(session_factory=session_factory, http_client=http_client, enable_scheduler=False)

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        post_response = await client.post("/internal/jobs/ingest")
        sources_response = await client.get("/internal/sources")
        raw_items_response = await client.get("/internal/raw-items", params={"source_id": source_id, "limit": 10})
        runs_response = await client.get("/internal/source-runs")
        debug_runs_response = await client.get("/internal/debug/source-runs")

    await http_client.aclose()

    assert post_response.status_code == 200
    assert post_response.json()["inserted_count"] == 2
    assert post_response.json()["duplicate_count"] == 0
    assert sources_response.status_code == 200
    assert len(sources_response.json()["items"]) == 1
    assert raw_items_response.status_code == 200
    assert len(raw_items_response.json()["items"]) == 2
    assert runs_response.status_code == 200
    assert len(runs_response.json()["items"]) == 1
    assert runs_response.json()["items"][0]["status"] == "success"
    assert "duplicate_count" in runs_response.json()["items"][0]
    assert debug_runs_response.status_code == 200
