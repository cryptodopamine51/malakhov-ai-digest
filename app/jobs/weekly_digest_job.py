from __future__ import annotations

from datetime import date

from aiogram import Bot

from app.core.digest_dates import default_weekly_issue_date
from app.services.deliveries import IssueDeliveryService
from app.services.digest import DigestBuilderService


async def build_weekly_issue(session_factory, issue_date: date | None = None) -> int:
    target_date = issue_date or default_weekly_issue_date(date.today())
    result = await DigestBuilderService(session_factory).build_weekly_issue(target_date)
    return result.issue_id


async def send_weekly_issue(session_factory, bot: Bot, issue_date: date | None = None) -> int:
    target_date = issue_date or default_weekly_issue_date(date.today())
    return await IssueDeliveryService(session_factory).send_weekly_issue_to_weekly_users(bot, issue_date=target_date)
