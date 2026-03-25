from __future__ import annotations

from dataclasses import dataclass
from datetime import date

from httpx import ASGITransport, AsyncClient
from sqlalchemy import func, select

from app.api.main import create_app
from app.bot.handlers import start as start_module
from app.bot.handlers.start import start_handler
from app.bot.renderers import render_start_welcome
from app.db.models import AlphaEntry, AlphaEntryStatus, SubscriptionMode, User


@dataclass
class FakeSentMessage:
    message_id: int


class FakeChat:
    def __init__(self, chat_id: int) -> None:
        self.id = chat_id


class FakeFromUser:
    def __init__(self, user_id: int) -> None:
        self.id = user_id


class FakeMessage:
    def __init__(self, *, user_id: int, chat_id: int) -> None:
        self.from_user = FakeFromUser(user_id)
        self.chat = FakeChat(chat_id)
        self.sent: list[dict[str, object]] = []

    async def answer(self, text: str, reply_markup=None):
        self.sent.append({"text": text, "reply_markup": reply_markup})
        return FakeSentMessage(message_id=len(self.sent))


async def test_create_and_publish_alpha_entry(session_factory):
    app = create_app(session_factory=session_factory, enable_scheduler=False)

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        created = await client.post(
            "/internal/alpha",
            json={
                "title": "Alpha signal",
                "body_short": "A strong founder signal.",
                "body_long": "A longer alpha note.",
                "source_links_json": ["https://example.com/alpha"],
                "priority_rank": 1,
                "publish_date": "2026-03-25",
                "status": "ready",
                "created_by": "editor",
            },
        )
        entry_id = created.json()["item"]["id"]
        published = await client.post(f"/internal/alpha/{entry_id}/publish")
        listed = await client.get("/internal/alpha", params={"status": "published"})

    assert created.status_code == 200
    assert published.status_code == 200
    assert published.json()["item"]["status"] == "published"
    assert listed.status_code == 200
    assert len(listed.json()["items"]) == 1


async def test_published_alpha_is_included_in_daily_and_weekly(session_factory):
    async with session_factory() as session:
        session.add(
            AlphaEntry(
                title="Alpha signal",
                body_short="A strong founder signal.",
                body_long="A longer alpha note.",
                source_links_json=["https://example.com/alpha"],
                event_id=None,
                priority_rank=1,
                publish_date=date(2026, 3, 25),
                status=AlphaEntryStatus.PUBLISHED,
                created_by="editor",
            )
        )
        await session.commit()

    app = create_app(session_factory=session_factory, enable_scheduler=False)

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        daily = await client.post("/internal/jobs/build-daily", params={"date": "2026-03-25"})
        weekly = await client.post("/internal/jobs/build-weekly", params={"date": "2026-03-25"})
        daily_alpha = await client.get(f"/internal/issues/{daily.json()['issue_id']}/section/alpha")
        weekly_issue = await client.get(f"/internal/issues/{weekly.json()['issue_id']}")

    assert daily_alpha.status_code == 200
    assert any(item["alpha_entry_id"] is not None for item in daily_alpha.json()["items"])
    assert any(item["alpha_entry_id"] is not None for item in weekly_issue.json()["items"])


def test_start_welcome_message_rendering_contains_required_parts():
    text = "\n".join(render_start_welcome(None))
    assert "Добро пожаловать" in text
    assert "Альфа" in text
    assert "каждый день" in text


async def test_start_flow_for_new_user(session_factory, monkeypatch):
    monkeypatch.setattr(start_module, "AsyncSessionLocal", session_factory)
    message = FakeMessage(user_id=123, chat_id=456)

    await start_handler(message)

    async with session_factory() as session:
        user_count = await session.scalar(select(func.count()).select_from(User))

    assert user_count == 1
    assert len(message.sent) >= 1
    assert "Добро пожаловать" in message.sent[0]["text"]


async def test_start_flow_for_existing_user(session_factory, monkeypatch):
    async with session_factory() as session:
        session.add(
            User(
                telegram_user_id=123,
                telegram_chat_id=456,
                subscription_mode=SubscriptionMode.WEEKLY,
                is_active=True,
            )
        )
        await session.commit()

    monkeypatch.setattr(start_module, "AsyncSessionLocal", session_factory)
    message = FakeMessage(user_id=123, chat_id=456)

    await start_handler(message)

    assert len(message.sent) >= 1
    assert "Текущий режим" in message.sent[0]["text"]
