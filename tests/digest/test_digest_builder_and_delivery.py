from __future__ import annotations

from dataclasses import dataclass
from datetime import date
import re

from sqlalchemy import func, select
from sqlalchemy.orm import selectinload

from app.bot.handlers import navigation as navigation_module
from app.bot.handlers.navigation import issue_section_callback_handler
from app.bot.renderers import render_daily_main, render_section, render_weekly_main
from app.db.models import (
    Delivery,
    DeliveryType,
    DigestIssue,
    DigestIssueItem,
    DigestIssueType,
    DigestSection,
    Event,
    EventCategory,
    EventSection,
    Source,
    SourceType,
    SubscriptionMode,
    User,
)
from app.services.deliveries import IssueDeliveryService
from app.services.digest import DigestBuilderService
from app.services.rendering import TelegramRenderingService


@dataclass
class FakeSentMessage:
    message_id: int


class FakeBot:
    def __init__(self) -> None:
        self.messages: list[dict[str, object]] = []
        self._next_id = 100

    async def send_message(self, chat_id: int, text: str, reply_markup=None, **kwargs):
        message = {"chat_id": chat_id, "text": text, "reply_markup": reply_markup, **kwargs}
        self.messages.append(message)
        self._next_id += 1
        return FakeSentMessage(message_id=self._next_id)


class FakeChat:
    def __init__(self, chat_id: int) -> None:
        self.id = chat_id


class FakeMessage:
    def __init__(self, chat_id: int) -> None:
        self.chat = FakeChat(chat_id)


class FakeUser:
    def __init__(self, user_id: int) -> None:
        self.id = user_id


class FakeCallback:
    def __init__(self, *, user_id: int, chat_id: int, data: str, bot: FakeBot) -> None:
        self.from_user = FakeUser(user_id)
        self.message = FakeMessage(chat_id)
        self.data = data
        self.bot = bot
        self.answered = False

    async def answer(self) -> None:
        self.answered = True


async def seed_daily_event_data(session_factory):
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
        coding_source = Source(
            title="GitHub Changelog Copilot",
            handle_or_url="https://github.blog/changelog/copilot/",
            source_type=SourceType.WEBSITE,
            priority_weight=90,
            is_active=True,
            language="en",
            country_scope="global",
            section_bias="coding|ai_news",
        )
        session.add_all([source, coding_source])
        await session.flush()

        event_one = Event(
            event_date=date(2026, 3, 25),
            title="OpenAI launches GPT-5",
            short_summary="OpenAI shipped GPT-5 and highlighted major market impact.",
            long_summary="OpenAI shipped GPT-5 with API and enterprise updates.",
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
        event_two = Event(
            event_date=date(2026, 3, 25),
            title="GitHub Copilot adds CLI workflow",
            short_summary="GitHub added a new Copilot CLI flow for builders.",
            long_summary="GitHub added a Copilot CLI flow for developer automation.",
            primary_source_id=coding_source.id,
            primary_source_url="https://github.blog/changelog/copilot-cli",
            importance_score=70,
            market_impact_score=45,
            ai_news_score=62,
            coding_score=96,
            investment_score=5,
            confidence_score=80,
            is_highlight=False,
        )
        event_three = Event(
            event_date=date(2026, 3, 25),
            title="AI startup raises Series B",
            short_summary="A startup raised a new Series B funding round.",
            long_summary="The company announced a Series B and strategic partnership.",
            primary_source_id=coding_source.id,
            primary_source_url="https://example.com/funding",
            importance_score=66,
            market_impact_score=72,
            ai_news_score=45,
            coding_score=5,
            investment_score=94,
            confidence_score=78,
            is_highlight=False,
        )
        session.add_all([event_one, event_two, event_three])
        await session.flush()
        session.add_all(
            [
                EventCategory(event_id=event_one.id, section=EventSection.IMPORTANT, score=0.9, is_primary_section=True),
                EventCategory(event_id=event_one.id, section=EventSection.AI_NEWS, score=0.95, is_primary_section=False),
                EventCategory(event_id=event_two.id, section=EventSection.CODING, score=0.96, is_primary_section=True),
                EventCategory(event_id=event_two.id, section=EventSection.AI_NEWS, score=0.55, is_primary_section=False),
                EventCategory(event_id=event_three.id, section=EventSection.INVESTMENTS, score=0.94, is_primary_section=True),
            ]
        )
        session.add_all(
            [
                User(telegram_user_id=1, telegram_chat_id=101, subscription_mode=SubscriptionMode.DAILY, is_active=True),
                User(telegram_user_id=2, telegram_chat_id=202, subscription_mode=SubscriptionMode.WEEKLY, is_active=True),
            ]
        )
        await session.commit()


async def test_build_daily_issue_and_snapshot_reuse(session_factory):
    await seed_daily_event_data(session_factory)
    service = DigestBuilderService(session_factory)

    first = await service.build_daily_issue(date(2026, 3, 25))
    second = await service.build_daily_issue(date(2026, 3, 25))

    async with session_factory() as session:
        issue = await session.scalar(select(DigestIssue).where(DigestIssue.id == first.issue_id).options(selectinload(DigestIssue.items)))

    assert first.reused_snapshot is False
    assert second.reused_snapshot is True
    assert issue is not None
    assert issue.issue_type == DigestIssueType.DAILY
    assert any(item.section == DigestSection.IMPORTANT for item in issue.items)
    assert any(item.section == DigestSection.AI_NEWS for item in issue.items)
    assert any(item.section == DigestSection.CODING for item in issue.items)
    assert any(item.section == DigestSection.INVESTMENTS for item in issue.items)
    assert any(item.section == DigestSection.ALPHA for item in issue.items)
    assert any(item.section == DigestSection.ALL for item in issue.items)


async def test_build_weekly_issue(session_factory):
    await seed_daily_event_data(session_factory)
    service = DigestBuilderService(session_factory)
    result = await service.build_weekly_issue(date(2026, 3, 25))

    async with session_factory() as session:
        issue = await session.scalar(select(DigestIssue).where(DigestIssue.id == result.issue_id).options(selectinload(DigestIssue.items)))

    assert issue is not None
    assert issue.issue_type == DigestIssueType.WEEKLY
    assert len(issue.items) >= 1


async def test_renderers_and_empty_alpha(session_factory):
    await seed_daily_event_data(session_factory)
    service = DigestBuilderService(session_factory)
    result = await service.build_daily_issue(date(2026, 3, 25))
    issue = await service.get_issue(result.issue_id)
    assert issue is not None

    preview = await service.get_daily_main_preview(issue.id)
    assert preview is not None
    all_items = await service.get_section_items(issue.id, DigestSection.ALL)
    alpha_items = await service.get_section_items(issue.id, DigestSection.ALPHA)

    daily_text = render_daily_main(issue, preview.visible_by_section)
    all_text = render_section(issue, DigestSection.ALL, all_items)
    alpha_text = render_section(issue, DigestSection.ALPHA, alpha_items)
    weekly_text = render_weekly_main(issue, all_items)

    rendered_daily = "\n".join(daily_text)
    rendered_all = "\n".join(all_text)
    rendered_alpha = "\n".join(alpha_text)
    rendered_weekly = "\n".join(weekly_text)

    assert "Важное" in rendered_daily
    assert "Новости ИИ" not in rendered_daily
    assert "Кодинг" in rendered_daily
    assert "Инвестиции" in rendered_daily
    assert "Альфа" not in rendered_daily
    visible_daily = re.sub(r'href="https?://[^"]+"', 'href=""', rendered_daily)
    visible_all = re.sub(r'href="https?://[^"]+"', 'href=""', rendered_all)

    assert "https://" not in visible_daily
    assert ">Источник<" in rendered_daily
    assert "Все за день" in rendered_all
    assert "https://" not in visible_all
    assert "новых находок пока нет" in rendered_alpha
    assert "Итоги недели" in rendered_weekly
    assert rendered_daily.count("OpenAI launches GPT-5") == 1
    assert "Это помогает понять, куда сейчас двигается AI-рынок" not in rendered_daily
    assert preview.suppressed
    assert preview.suppressed[0].reason == "duplicate_in_daily_main"


async def test_daily_main_preview_suppresses_cross_section_duplicates(session_factory):
    await seed_daily_event_data(session_factory)
    service = DigestBuilderService(session_factory)
    result = await service.build_daily_issue(date(2026, 3, 25))

    preview = await service.get_daily_main_preview(result.issue_id)

    assert preview is not None
    assert len(preview.visible_by_section[DigestSection.IMPORTANT]) == 1
    assert len(preview.visible_by_section[DigestSection.CODING]) == 1
    assert len(preview.visible_by_section[DigestSection.INVESTMENTS]) == 1
    assert not preview.visible_by_section[DigestSection.AI_NEWS]
    assert any(item.source_section == DigestSection.AI_NEWS for item in preview.suppressed)


async def test_historical_english_event_gets_russian_editorial_lead(session_factory):
    await seed_daily_event_data(session_factory)
    service = DigestBuilderService(session_factory)
    result = await service.build_daily_issue(date(2026, 3, 25))

    coding_items = await service.get_section_items(result.issue_id, DigestSection.CODING)

    assert coding_items
    assert "GitHub added a new Copilot CLI flow" not in coding_items[0].card_text
    assert re.search(r"[А-Яа-яЁё]", coding_items[0].card_text)


async def test_send_daily_and_weekly_and_log_deliveries(session_factory):
    await seed_daily_event_data(session_factory)
    builder = DigestBuilderService(session_factory)
    daily = await builder.build_daily_issue(date(2026, 3, 25))
    weekly = await builder.build_weekly_issue(date(2026, 3, 25))
    bot = FakeBot()
    delivery_service = IssueDeliveryService(session_factory)

    daily_sent = await delivery_service.send_daily_issue_to_daily_users(bot)
    weekly_sent = await delivery_service.send_weekly_issue_to_weekly_users(bot)

    async with session_factory() as session:
        deliveries = list((await session.scalars(select(Delivery).order_by(Delivery.id.asc()))).all())

    assert daily_sent == 1
    assert weekly_sent == 1
    assert len(bot.messages) == 2
    assert all(message["link_preview_options"].is_disabled is True for message in bot.messages)
    assert any(delivery.delivery_type == DeliveryType.DAILY_MAIN and delivery.issue_id == daily.issue_id for delivery in deliveries)
    assert any(delivery.delivery_type == DeliveryType.WEEKLY_MAIN and delivery.issue_id == weekly.issue_id for delivery in deliveries)


async def test_callback_handler_sends_new_section_message_and_logs_delivery(session_factory, monkeypatch):
    await seed_daily_event_data(session_factory)
    builder = DigestBuilderService(session_factory)
    daily = await builder.build_daily_issue(date(2026, 3, 25))
    bot = FakeBot()
    callback = FakeCallback(user_id=1, chat_id=101, data=f"issue:{daily.issue_id}:coding", bot=bot)
    monkeypatch.setattr(navigation_module, "AsyncSessionLocal", session_factory)

    await issue_section_callback_handler(callback)

    async with session_factory() as session:
        delivery = await session.scalar(select(Delivery).where(Delivery.delivery_type == DeliveryType.SECTION_OPEN))

    assert callback.answered is True
    assert len(bot.messages) == 1
    assert "Кодинг" in bot.messages[0]["text"]
    assert bot.messages[0]["link_preview_options"].is_disabled is True
    assert delivery is not None
    assert delivery.section == "coding"


async def test_repeated_section_open_remains_valid(session_factory, monkeypatch):
    await seed_daily_event_data(session_factory)
    builder = DigestBuilderService(session_factory)
    daily = await builder.build_daily_issue(date(2026, 3, 25))
    bot = FakeBot()
    monkeypatch.setattr(navigation_module, "AsyncSessionLocal", session_factory)

    callback_one = FakeCallback(user_id=1, chat_id=101, data=f"issue:{daily.issue_id}:coding", bot=bot)
    callback_two = FakeCallback(user_id=1, chat_id=101, data=f"issue:{daily.issue_id}:coding", bot=bot)
    await issue_section_callback_handler(callback_one)
    await issue_section_callback_handler(callback_two)

    async with session_factory() as session:
        deliveries = list((await session.scalars(select(Delivery).where(Delivery.delivery_type == DeliveryType.SECTION_OPEN))).all())

    assert len(bot.messages) == 2
    assert len(deliveries) == 2


async def test_duplicate_mass_send_basic_protection(session_factory):
    await seed_daily_event_data(session_factory)
    builder = DigestBuilderService(session_factory)
    await builder.build_daily_issue(date(2026, 3, 25))
    bot = FakeBot()
    delivery_service = IssueDeliveryService(session_factory)

    first_sent = await delivery_service.send_daily_issue_to_daily_users(bot)
    second_sent = await delivery_service.send_daily_issue_to_daily_users(bot)

    async with session_factory() as session:
        delivery_count = await session.scalar(select(func.count()).select_from(Delivery).where(Delivery.delivery_type == DeliveryType.DAILY_MAIN))

    assert first_sent == 1
    assert second_sent == 0
    assert delivery_count == 1


def test_long_message_chunking_and_safe_rendering():
    rendering = TelegramRenderingService()
    long_block = "<b>" + ("very long text " * 500) + "</b>"
    chunks = rendering.chunk_blocks("Header", [rendering.escape_text(long_block)], max_length=500)

    assert len(chunks) > 1
    assert all(len(chunk) <= 500 for chunk in chunks)
    assert "&lt;b&gt;" in chunks[0]
