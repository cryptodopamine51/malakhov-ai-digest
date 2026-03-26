from __future__ import annotations

from datetime import date

from aiogram import Bot

from app.core.digest_dates import default_daily_issue_date
from app.services.deliveries import IssueDeliveryService
from app.services.digest import DigestBuilderService


async def build_daily_issue(session_factory, issue_date: date | None = None) -> int:
    target_date = issue_date or default_daily_issue_date(date.today())
    result = await DigestBuilderService(session_factory).build_daily_issue(target_date)
    return result.issue_id


async def send_daily_issue(session_factory, bot: Bot) -> int:
    return await IssueDeliveryService(session_factory).send_daily_issue_to_daily_users(bot)
