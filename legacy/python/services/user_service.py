from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import SubscriptionMode, User


class UserService:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def get_by_telegram_user_id(self, telegram_user_id: int) -> User | None:
        result = await self.session.execute(select(User).where(User.telegram_user_id == telegram_user_id))
        return result.scalar_one_or_none()

    async def get_or_create(self, telegram_user_id: int, telegram_chat_id: int) -> tuple[User, bool]:
        user = await self.get_by_telegram_user_id(telegram_user_id)
        if user:
            user.telegram_chat_id = telegram_chat_id
            await self.session.flush()
            return user, False

        user = User(
            telegram_user_id=telegram_user_id,
            telegram_chat_id=telegram_chat_id,
            subscription_mode=SubscriptionMode.DAILY,
            is_active=True,
        )
        self.session.add(user)
        await self.session.flush()
        return user, True

    async def set_subscription_mode(self, user: User, mode: SubscriptionMode) -> User:
        user.subscription_mode = mode
        user.is_active = True
        await self.session.flush()
        return user
