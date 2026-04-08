import pytest
import json
from httpx import ASGITransport, AsyncClient

from app.api.main import create_app
from app.core.config import get_settings
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


class FakeSmtp:
    last_instance = None

    def __init__(self, host, port, context=None, timeout=None):
        self.host = host
        self.port = port
        self.context = context
        self.timeout = timeout
        self.logged_in = None
        self.messages = []
        FakeSmtp.last_instance = self

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def login(self, user, password):
        self.logged_in = (user, password)

    def send_message(self, message):
        self.messages.append(message)


class BrokenSmtp(FakeSmtp):
    def send_message(self, message):
        raise TimeoutError("smtp timeout")


class FakeResendResponse:
    def raise_for_status(self):
        return None


class FakeResendClient:
    last_request = None

    @staticmethod
    def post(url, headers=None, content=None, timeout=None):
        FakeResendClient.last_request = {
            "url": url,
            "headers": headers,
            "content": content,
            "timeout": timeout,
        }
        return FakeResendResponse()


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
async def test_site_lead_endpoint_sends_email_when_smtp_configured(session_factory, monkeypatch):
    async with session_factory() as session:
        session.add(User(telegram_user_id=123456789, telegram_chat_id=123456789))
        await session.commit()

    monkeypatch.setenv("SMTP_HOST", "mail.example.com")
    monkeypatch.setenv("SMTP_PORT", "465")
    monkeypatch.setenv("SMTP_SECURE", "true")
    monkeypatch.setenv("SMTP_USER", "robot@example.com")
    monkeypatch.setenv("SMTP_PASS", "secret")
    monkeypatch.setenv("LEADS_EMAIL_TO", "sales@example.com")
    monkeypatch.setenv("LEADS_EMAIL_FROM", "robot@example.com")
    monkeypatch.setenv("LEADS_EMAIL_FROM_NAME", "Malakhov AI")
    get_settings.cache_clear()
    monkeypatch.setattr("app.api.main.smtplib.SMTP_SSL", FakeSmtp)

    bot = FakeBot()
    app = create_app(session_factory=session_factory, telegram_bot=bot, enable_scheduler=False)

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.post(
            "/api/leads",
            data={
                "name": "Иван",
                "company": "Malakhov AI",
                "contact": "+7 900 000-00-00",
                "description": "Нужен пилот",
                "requestType": "Пилот",
                "subject": "RAG",
                "page": "/contacts",
                "utm": "?utm_source=test",
            },
            files={"file": ("brief.txt", b"hello", "text/plain")},
        )

    assert response.status_code == 200
    assert FakeSmtp.last_instance is not None
    assert FakeSmtp.last_instance.host == "mail.example.com"
    assert FakeSmtp.last_instance.port == 465
    assert FakeSmtp.last_instance.logged_in == ("robot@example.com", "secret")
    assert len(FakeSmtp.last_instance.messages) == 1
    message = FakeSmtp.last_instance.messages[0]
    assert message["To"] == "sales@example.com"
    assert "Новая заявка с malakhovai.ru" in message["Subject"]
    assert "Нужен пилот" in message.get_body(preferencelist=("plain",)).get_content()
    assert len(list(message.iter_attachments())) == 1
    get_settings.cache_clear()


@pytest.mark.asyncio
async def test_site_lead_endpoint_keeps_telegram_delivery_when_email_fails(session_factory, monkeypatch):
    async with session_factory() as session:
        session.add(User(telegram_user_id=123456789, telegram_chat_id=123456789))
        await session.commit()

    monkeypatch.setenv("SMTP_HOST", "mail.example.com")
    monkeypatch.setenv("SMTP_PORT", "465")
    monkeypatch.setenv("SMTP_SECURE", "true")
    monkeypatch.setenv("SMTP_USER", "robot@example.com")
    monkeypatch.setenv("SMTP_PASS", "secret")
    monkeypatch.setenv("LEADS_EMAIL_TO", "sales@example.com")
    monkeypatch.setenv("LEADS_EMAIL_FROM", "robot@example.com")
    get_settings.cache_clear()
    monkeypatch.setattr("app.api.main.smtplib.SMTP_SSL", BrokenSmtp)

    bot = FakeBot()
    app = create_app(session_factory=session_factory, telegram_bot=bot, enable_scheduler=False)

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.post(
            "/api/leads",
            data={
                "name": "Иван",
                "contact": "+7 900 000-00-00",
                "description": "Нужен проект",
            },
        )

    assert response.status_code == 200
    assert response.json() == {"ok": True, "delivered": True}
    assert len(bot.messages) == 1
    get_settings.cache_clear()


@pytest.mark.asyncio
async def test_site_lead_endpoint_sends_email_via_resend_when_configured(session_factory, monkeypatch):
    async with session_factory() as session:
        session.add(User(telegram_user_id=123456789, telegram_chat_id=123456789))
        await session.commit()

    monkeypatch.setenv("RESEND_API_KEY", "re_test_123")
    monkeypatch.setenv("LEADS_EMAIL_TO", "sales@example.com")
    monkeypatch.setenv("LEADS_EMAIL_FROM", "noreply@example.com")
    monkeypatch.setenv("LEADS_EMAIL_FROM_NAME", "Malakhov AI")
    get_settings.cache_clear()
    monkeypatch.setattr("app.api.main.httpx.post", FakeResendClient.post)

    bot = FakeBot()
    app = create_app(session_factory=session_factory, telegram_bot=bot, enable_scheduler=False)

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.post(
            "/api/leads",
            data={
                "name": "Иван",
                "contact": "+7 900 000-00-00",
                "description": "Нужен проект",
                "requestType": "Проект",
            },
            files={"file": ("brief.txt", b"hello", "text/plain")},
        )

    assert response.status_code == 200
    assert FakeResendClient.last_request is not None
    assert FakeResendClient.last_request["url"] == "https://api.resend.com/emails"
    assert FakeResendClient.last_request["headers"]["Authorization"] == "Bearer re_test_123"
    payload = json.loads(FakeResendClient.last_request["content"])
    assert payload["subject"] == "Новая заявка с malakhovai.ru | Проект | Иван"
    assert len(payload["attachments"]) == 1
    get_settings.cache_clear()


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
