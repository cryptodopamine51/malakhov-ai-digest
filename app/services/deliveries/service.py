from __future__ import annotations

from datetime import date
import logging

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker
from aiogram.types import LinkPreviewOptions

from app.bot.renderers import render_daily_main, render_section, render_weekly_main
from app.bot.texts import ABOUT_TEXT
from app.core.logging import log_structured
from app.db.models import (
    Delivery,
    DeliveryType,
    DigestIssueType,
    DigestSection,
    SubscriptionMode,
    User,
)
from app.services.delivery_service import DeliveryService
from app.services.digest import DigestBuilderService
from app.services.rendering import TelegramRenderingService

logger = logging.getLogger(__name__)


class IssueDeliveryService:
    def __init__(self, session_factory: async_sessionmaker[AsyncSession]) -> None:
        self.session_factory = session_factory
        self.digest_builder = DigestBuilderService(session_factory)
        self.rendering = TelegramRenderingService()

    async def send_daily_issue_to_daily_users(self, bot, *, issue_date: date | None = None) -> int:
        issue = (
            await self.digest_builder.get_issue_by_type_and_date(DigestIssueType.DAILY, issue_date)
            if issue_date is not None
            else await self.digest_builder.get_latest_issue(DigestIssueType.DAILY)
        )
        if issue is None:
            return 0
        sent_count = await self._broadcast_issue(bot=bot, issue_type=DigestIssueType.DAILY, issue_id=issue.id)
        if sent_count > 0:
            await self.digest_builder.mark_issue_sent(issue.id)
        return sent_count

    async def send_weekly_issue_to_weekly_users(self, bot, *, issue_date: date | None = None) -> int:
        issue = (
            await self.digest_builder.get_issue_by_type_and_date(DigestIssueType.WEEKLY, issue_date)
            if issue_date is not None
            else await self.digest_builder.get_latest_issue(DigestIssueType.WEEKLY)
        )
        if issue is None:
            return 0
        sent_count = await self._broadcast_issue(bot=bot, issue_type=DigestIssueType.WEEKLY, issue_id=issue.id)
        if sent_count > 0:
            await self.digest_builder.mark_issue_sent(issue.id)
        return sent_count

    async def send_issue_to_user(self, *, bot, issue_id: int, telegram_user_id: int, telegram_chat_id: int) -> int | None:
        issue = await self.digest_builder.get_issue(issue_id)
        if issue is None:
            return None
        if issue.issue_type is DigestIssueType.DAILY:
            from app.bot.keyboards.inline import daily_sections_keyboard

            preview = await self.digest_builder.get_daily_main_preview(issue.id)
            if preview is None:
                return None
            messages = await self._send_chunks(
                bot=bot,
                chat_id=telegram_chat_id,
                chunks=render_daily_main(issue, preview.visible_by_section),
                first_reply_markup=daily_sections_keyboard(issue.id),
            )
            delivery_type = DeliveryType.DAILY_MAIN
        else:
            items = await self.digest_builder.get_section_items(issue_id=issue_id, section=DigestSection.ALL)
            messages = await self._send_chunks(
                bot=bot,
                chat_id=telegram_chat_id,
                chunks=render_weekly_main(issue, items),
            )
            delivery_type = DeliveryType.WEEKLY_MAIN

        async with self.session_factory() as session:
            user = await session.scalar(select(User).where(User.telegram_user_id == telegram_user_id))
            if user is None:
                return messages[0].message_id if messages else None
            await DeliveryService(session).log_delivery(
                user_id=user.id,
                issue_id=issue.id,
                delivery_type=delivery_type,
                telegram_message_id=messages[0].message_id if messages else None,
            )
            await session.commit()
        log_structured(
            logger,
            "issue_delivery",
            issue_id=issue.id,
            telegram_user_id=telegram_user_id,
            delivery_type=delivery_type.value,
            section=None,
            telegram_message_id=messages[0].message_id if messages else None,
            status="sent",
            resend=False,
        )
        return messages[0].message_id if messages else None

    async def send_section_message(
        self,
        *,
        bot,
        issue_id: int,
        section: DigestSection,
        telegram_user_id: int,
        telegram_chat_id: int,
    ) -> int | None:
        issue = await self.digest_builder.get_issue(issue_id)
        if issue is None:
            return None
        items = await self.digest_builder.get_section_items(issue_id=issue_id, section=section)
        messages = await self._send_chunks(bot=bot, chat_id=telegram_chat_id, chunks=render_section(issue, section, items))

        async with self.session_factory() as session:
            user = await session.scalar(select(User).where(User.telegram_user_id == telegram_user_id))
            if user is not None:
                await DeliveryService(session).log_delivery(
                    user_id=user.id,
                    issue_id=issue.id,
                    delivery_type=DeliveryType.SECTION_OPEN,
                    telegram_message_id=messages[0].message_id if messages else None,
                    section=section.value,
                )
                await session.commit()
        log_structured(
            logger,
            "issue_delivery",
            issue_id=issue.id,
            telegram_user_id=telegram_user_id,
            delivery_type=DeliveryType.SECTION_OPEN.value,
            section=section.value,
            telegram_message_id=messages[0].message_id if messages else None,
            status="sent",
            resend=False,
        )
        return messages[0].message_id if messages else None

    async def send_about_message(self, *, bot, telegram_user_id: int, telegram_chat_id: int) -> int:
        messages = await self._send_chunks(
            bot=bot,
            chat_id=telegram_chat_id,
            chunks=self.rendering.chunk_blocks(self.rendering.escape_text(ABOUT_TEXT), []),
        )
        async with self.session_factory() as session:
            user = await session.scalar(select(User).where(User.telegram_user_id == telegram_user_id))
            if user is not None:
                await DeliveryService(session).log_delivery(
                    user_id=user.id,
                    delivery_type=DeliveryType.ABOUT,
                    telegram_message_id=messages[0].message_id if messages else None,
                )
                await session.commit()
        log_structured(
            logger,
            "issue_delivery",
            issue_id=None,
            telegram_user_id=telegram_user_id,
            delivery_type=DeliveryType.ABOUT.value,
            section=None,
            telegram_message_id=messages[0].message_id if messages else None,
            status="sent",
            resend=False,
        )
        return messages[0].message_id if messages else 0

    async def _broadcast_issue(self, *, bot, issue_type: DigestIssueType, issue_id: int) -> int:
        mode = SubscriptionMode.DAILY if issue_type is DigestIssueType.DAILY else SubscriptionMode.WEEKLY
        async with self.session_factory() as session:
            users = list(
                (
                    await session.scalars(
                        select(User).where(User.subscription_mode == mode, User.is_active.is_(True))
                    )
                ).all()
            )

        sent_count = 0
        for user in users:
            if await self._has_existing_delivery(user_id=user.id, issue_id=issue_id, issue_type=issue_type):
                log_structured(
                    logger,
                    "issue_delivery_skip",
                    issue_id=issue_id,
                    user_id=user.id,
                    telegram_user_id=user.telegram_user_id,
                    delivery_type=(
                        DeliveryType.DAILY_MAIN.value
                        if issue_type is DigestIssueType.DAILY
                        else DeliveryType.WEEKLY_MAIN.value
                    ),
                    reason="duplicate_delivery",
                )
                continue
            message_id = await self.send_issue_to_user(
                bot=bot,
                issue_id=issue_id,
                telegram_user_id=user.telegram_user_id,
                telegram_chat_id=user.telegram_chat_id,
            )
            if message_id is not None:
                sent_count += 1
        return sent_count

    async def resend_issue(
        self,
        *,
        bot,
        issue_id: int,
        telegram_user_id: int,
        telegram_chat_id: int,
    ) -> int | None:
        message_id = await self.send_issue_to_user(
            bot=bot,
            issue_id=issue_id,
            telegram_user_id=telegram_user_id,
            telegram_chat_id=telegram_chat_id,
        )
        log_structured(
            logger,
            "issue_resend",
            issue_id=issue_id,
            telegram_user_id=telegram_user_id,
            telegram_message_id=message_id,
            status="sent" if message_id is not None else "missing_issue",
            resend=True,
        )
        return message_id

    async def _has_existing_delivery(self, *, user_id: int, issue_id: int, issue_type: DigestIssueType) -> bool:
        delivery_type = DeliveryType.DAILY_MAIN if issue_type is DigestIssueType.DAILY else DeliveryType.WEEKLY_MAIN
        async with self.session_factory() as session:
            delivery = await session.scalar(
                select(Delivery).where(
                    Delivery.user_id == user_id,
                    Delivery.issue_id == issue_id,
                    Delivery.delivery_type == delivery_type,
                )
            )
            return delivery is not None

    async def _send_chunks(self, *, bot, chat_id: int, chunks: list[str], first_reply_markup=None) -> list:
        messages = []
        for index, chunk in enumerate(chunks):
            kwargs = {
                "link_preview_options": LinkPreviewOptions(is_disabled=True),
            }
            if index == 0 and first_reply_markup is not None:
                kwargs["reply_markup"] = first_reply_markup
            messages.append(await bot.send_message(chat_id=chat_id, text=chunk, **kwargs))
        return messages
