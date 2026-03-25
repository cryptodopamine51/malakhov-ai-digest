import pytest
from httpx import ASGITransport, AsyncClient

from app.api.main import create_app


@pytest.mark.asyncio
async def test_health_endpoint(session_factory):
    app = create_app(session_factory=session_factory, enable_scheduler=False)

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.get("/health")

    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "ok"
    assert payload["service"] == "malakhov-ai-digest"
    assert "environment" in payload


@pytest.mark.asyncio
async def test_health_db_endpoint(session_factory):
    app = create_app(session_factory=session_factory, enable_scheduler=False)

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.get("/health/db")

    assert response.status_code == 200
    assert response.json()["status"] == "ok"
