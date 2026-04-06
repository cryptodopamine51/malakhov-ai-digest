from __future__ import annotations

from datetime import date

from httpx import ASGITransport, AsyncClient

from app.api.main import create_app
from app.db.models import Event, EventCategory, EventSection, Source, SourceType, SubscriptionMode, User
from tests.digest.test_digest_builder_and_delivery import FakeBot


async def seed_issue_endpoint_data(session_factory):
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
        event = Event(
            event_date=date(2026, 3, 25),
            title="OpenAI launches GPT-5",
            short_summary="OpenAI shipped GPT-5 and highlighted market impact.",
            long_summary="OpenAI shipped GPT-5 with API updates.",
            primary_source_id=source.id,
            primary_source_url="https://openai.com/news/gpt-5",
            importance_score=92,
            market_impact_score=88,
            ai_news_score=95,
            coding_score=60,
            investment_score=10,
            confidence_score=90,
            is_highlight=True,
        )
        session.add(event)
        await session.flush()
        session.add(EventCategory(event_id=event.id, section=EventSection.IMPORTANT, score=0.9, is_primary_section=True))
        session.add(EventCategory(event_id=event.id, section=EventSection.AI_NEWS, score=0.8, is_primary_section=False))
        session.add(User(telegram_user_id=1, telegram_chat_id=101, subscription_mode=SubscriptionMode.DAILY, is_active=True))
        session.add(User(telegram_user_id=2, telegram_chat_id=202, subscription_mode=SubscriptionMode.WEEKLY, is_active=True))
        await session.commit()


async def test_manual_issue_build_and_send_endpoints(session_factory):
    await seed_issue_endpoint_data(session_factory)
    bot = FakeBot()
    app = create_app(session_factory=session_factory, telegram_bot=bot, enable_scheduler=False)

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        build_daily = await client.post("/internal/jobs/build-daily", params={"date": "2026-03-25"})
        build_weekly = await client.post("/internal/jobs/build-weekly", params={"date": "2026-03-25"})
        issues = await client.get("/internal/issues")
        issue_id = build_daily.json()["issue_id"]
        issue_detail = await client.get(f"/internal/issues/{issue_id}")
        debug_issue = await client.get(f"/internal/debug/issues/{issue_id}")
        debug_scheduler = await client.get("/internal/debug/scheduler")
        debug_deliveries_before = await client.get("/internal/debug/deliveries")
        section_detail = await client.get(f"/internal/issues/{issue_id}/section/important")
        send_daily = await client.post("/internal/jobs/send-daily", params={"date": "2026-03-25"})
        send_weekly = await client.post("/internal/jobs/send-weekly", params={"date": "2026-03-25"})
        debug_deliveries_after = await client.get("/internal/debug/deliveries")
        resend = await client.post(f"/internal/issues/{issue_id}/resend", params={"telegram_user_id": 1, "telegram_chat_id": 101})

    assert build_daily.status_code == 200
    assert build_weekly.status_code == 200
    assert issues.status_code == 200
    assert len(issues.json()["items"]) == 2
    assert issue_detail.status_code == 200
    assert "daily_main_debug" in issue_detail.json()
    assert "excluded" in issue_detail.json()["daily_main_debug"]
    assert debug_issue.status_code == 200
    assert "section_counts" in debug_issue.json()
    assert "selected_event_ids_by_section" in debug_issue.json()
    assert debug_issue.json()["selected_event_ids_by_section"]["important"]
    assert "telegram_selection" in debug_issue.json()
    assert debug_scheduler.status_code == 200
    assert "configured_jobs" in debug_scheduler.json()
    assert debug_deliveries_before.status_code == 200
    assert section_detail.status_code == 200
    assert "suppressed_from_main" in section_detail.json()
    assert send_daily.status_code == 200
    assert send_daily.json()["sent_count"] == 1
    assert send_weekly.status_code == 200
    assert send_weekly.json()["sent_count"] == 1
    assert debug_deliveries_after.status_code == 200
    assert debug_deliveries_after.json()["aggregate_by_type"]["daily_main"] >= 1
    assert resend.status_code == 200
    assert len(bot.messages) == 3
