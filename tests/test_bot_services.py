from sqlalchemy import func, select

from app.bot.texts import ABOUT_TEXT
from app.db.models import Delivery, DeliveryType, SubscriptionMode, User
from app.services.bot_interaction_service import BotInteractionService


async def test_create_user_on_start(db_session):
    service = BotInteractionService(db_session)

    result = await service.ensure_user(telegram_user_id=1001, telegram_chat_id=2001)

    assert result.is_new_user is True
    assert result.user.telegram_user_id == 1001

    user_count = await db_session.scalar(select(func.count()).select_from(User))
    assert user_count == 1


async def test_save_daily_subscription_mode(db_session):
    service = BotInteractionService(db_session)

    user = await service.set_onboarding_mode(
        telegram_user_id=1002,
        telegram_chat_id=2002,
        mode=SubscriptionMode.DAILY,
        telegram_message_id=3002,
    )

    assert user.subscription_mode == SubscriptionMode.DAILY
    delivery = await db_session.scalar(select(Delivery).where(Delivery.user_id == user.id))
    assert delivery is not None
    assert delivery.delivery_type == DeliveryType.ONBOARDING


async def test_save_weekly_subscription_mode(db_session):
    service = BotInteractionService(db_session)

    user = await service.set_onboarding_mode(
        telegram_user_id=1003,
        telegram_chat_id=2003,
        mode=SubscriptionMode.WEEKLY,
        telegram_message_id=3003,
    )

    assert user.subscription_mode == SubscriptionMode.WEEKLY


async def test_repeat_start_for_existing_user(db_session):
    service = BotInteractionService(db_session)

    first = await service.ensure_user(telegram_user_id=1004, telegram_chat_id=2004)
    second = await service.ensure_user(telegram_user_id=1004, telegram_chat_id=2005)

    assert first.user.id == second.user.id
    assert second.is_new_user is False
    assert second.user.telegram_chat_id == 2005

    user_count = await db_session.scalar(select(func.count()).select_from(User))
    assert user_count == 1


async def test_change_mode_in_settings(db_session):
    service = BotInteractionService(db_session)

    await service.set_onboarding_mode(
        telegram_user_id=1005,
        telegram_chat_id=2005,
        mode=SubscriptionMode.DAILY,
        telegram_message_id=3005,
    )
    user = await service.set_settings_mode(
        telegram_user_id=1005,
        telegram_chat_id=2005,
        mode=SubscriptionMode.WEEKLY,
        telegram_message_id=3006,
    )

    assert user.subscription_mode == SubscriptionMode.WEEKLY
    deliveries = (await db_session.scalars(select(Delivery).where(Delivery.user_id == user.id))).all()
    assert len(deliveries) == 2
    assert deliveries[-1].delivery_type == DeliveryType.SETTINGS_CHANGE


def test_about_text_render_contains_required_sections():
    required = [
        "Что это",
        "Важное",
        "Новости ИИ",
        "Кодинг",
        "Инвестиции",
        "Альфа",
        "Для кого бот",
        "Как пользоваться",
    ]

    for item in required:
        assert item in ABOUT_TEXT
