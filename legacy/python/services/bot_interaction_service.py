from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import DeliveryType, SubscriptionMode, User
from app.services.delivery_service import DeliveryService
from app.services.user_service import UserService


@dataclass(slots=True)
class InteractionResult:
    user: User
    is_new_user: bool = False


class BotInteractionService:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session
        self.users = UserService(session)
        self.deliveries = DeliveryService(session)

    async def ensure_user(self, telegram_user_id: int, telegram_chat_id: int) -> InteractionResult:
        user, created = await self.users.get_or_create(telegram_user_id, telegram_chat_id)
        await self.session.commit()
        return InteractionResult(user=user, is_new_user=created)

    async def set_onboarding_mode(
        self,
        *,
        telegram_user_id: int,
        telegram_chat_id: int,
        mode: SubscriptionMode,
        telegram_message_id: int | None,
    ) -> User:
        user, _ = await self.users.get_or_create(telegram_user_id, telegram_chat_id)
        await self.users.set_subscription_mode(user, mode)
        await self.deliveries.log_delivery(
            user_id=user.id,
            delivery_type=DeliveryType.ONBOARDING,
            telegram_message_id=telegram_message_id,
        )
        await self.session.commit()
        return user

    async def set_settings_mode(
        self,
        *,
        telegram_user_id: int,
        telegram_chat_id: int,
        mode: SubscriptionMode,
        telegram_message_id: int | None,
    ) -> User:
        user, _ = await self.users.get_or_create(telegram_user_id, telegram_chat_id)
        await self.users.set_subscription_mode(user, mode)
        await self.deliveries.log_delivery(
            user_id=user.id,
            delivery_type=DeliveryType.SETTINGS_CHANGE,
            telegram_message_id=telegram_message_id,
        )
        await self.session.commit()
        return user

    async def log_about(self, *, telegram_user_id: int, telegram_chat_id: int, telegram_message_id: int | None) -> None:
        user, _ = await self.users.get_or_create(telegram_user_id, telegram_chat_id)
        await self.deliveries.log_delivery(
            user_id=user.id,
            delivery_type=DeliveryType.ABOUT,
            telegram_message_id=telegram_message_id,
        )
        await self.session.commit()

    async def log_daily_main(
        self,
        *,
        telegram_user_id: int,
        telegram_chat_id: int,
        telegram_message_id: int | None,
        issue_id: int | None,
    ) -> None:
        user, _ = await self.users.get_or_create(telegram_user_id, telegram_chat_id)
        await self.deliveries.log_delivery(
            user_id=user.id,
            issue_id=issue_id,
            delivery_type=DeliveryType.DAILY_MAIN,
            telegram_message_id=telegram_message_id,
        )
        await self.session.commit()

    async def log_weekly_main(
        self,
        *,
        telegram_user_id: int,
        telegram_chat_id: int,
        telegram_message_id: int | None,
        issue_id: int | None,
    ) -> None:
        user, _ = await self.users.get_or_create(telegram_user_id, telegram_chat_id)
        await self.deliveries.log_delivery(
            user_id=user.id,
            issue_id=issue_id,
            delivery_type=DeliveryType.WEEKLY_MAIN,
            telegram_message_id=telegram_message_id,
        )
        await self.session.commit()
