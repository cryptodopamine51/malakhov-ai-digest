import pytest
from httpx import ASGITransport, AsyncClient

from app.api.main import create_app
from app.db.models import User


class FakeBot:
    def __init__(self) -> None:
        self.messages: list[dict[str, object]] = []
        self.documents: list[dict[str, object]] = []

    async def send_message(self, *, chat_id: int, text: str, **kwargs):
        self.messages.append({"chat_id": chat_id, "text": text, "kwargs": kwargs})

    async def send_document(self, *, chat_id: int, document, caption: str | None = None, **kwargs):
        self.documents.append(
            {
                "chat_id": chat_id,
                "document_name": getattr(document, "filename", None),
                "caption": caption,
                "kwargs": kwargs,
            }
        )


@pytest.mark.asyncio
async def test_site_lead_endpoint_sends_message_and_document(session_factory):
    async with session_factory() as session:
        session.add(User(telegram_user_id=123456789, telegram_chat_id=123456789))
        await session.commit()

    bot = FakeBot()
    app = create_app(session_factory=session_factory, telegram_bot=bot, enable_scheduler=False)

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.post(
            "/api/leads",
            data={
                "name": "Иван",
                "company": "Malakhov AI",
                "contact": "+7 900 000-00-00",
                "description": "Нужен аудит процессов",
                "requestType": "Аудит",
                "subject": "Внутренний ассистент",
                "page": "/contacts",
                "utm": "?utm_source=test",
            },
            files={"file": ("brief.txt", b"hello", "text/plain")},
        )

    assert response.status_code == 200
    assert response.json() == {"ok": True, "delivered": True}
    assert len(bot.messages) == 1
    assert bot.messages[0]["chat_id"] == 123456789
    assert "Нужен аудит процессов" in str(bot.messages[0]["text"])
    assert len(bot.documents) == 1
    assert bot.documents[0]["document_name"] == "brief.txt"


@pytest.mark.asyncio
async def test_site_lead_endpoint_honeypot_skips_delivery(session_factory):
    async with session_factory() as session:
        session.add(User(telegram_user_id=123456789, telegram_chat_id=123456789))
        await session.commit()

    bot = FakeBot()
    app = create_app(session_factory=session_factory, telegram_bot=bot, enable_scheduler=False)

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.post(
            "/api/leads",
            data={
                "name": "Спамер",
                "contact": "+7 900 000-00-00",
                "description": "spam",
                "_hp": "filled",
            },
        )

    assert response.status_code == 200
    assert response.json() == {"ok": True}
    assert bot.messages == []
    assert bot.documents == []
