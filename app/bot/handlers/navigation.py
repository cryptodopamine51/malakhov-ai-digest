import logging
from datetime import date

from aiogram import F, Router
from aiogram.types import CallbackQuery, LinkPreviewOptions, Message

from app.bot.keyboards.inline import daily_sections_keyboard
from app.bot.keyboards.buttons import (
    MENU_ABOUT_BUTTON,
    MENU_SETTINGS_BUTTON,
    MENU_TODAY_BUTTON,
    MENU_WEEKLY_BUTTON,
    ONBOARDING_DAILY_BUTTON,
    ONBOARDING_WEEKLY_BUTTON,
    SETTINGS_BACK_BUTTON,
    SETTINGS_DAILY_BUTTON,
    SETTINGS_WEEKLY_BUTTON,
)
from app.bot.keyboards.reply import main_menu_keyboard, settings_keyboard
from app.bot.renderers import render_daily_main, render_weekly_main
from app.bot.texts import (
    ABOUT_TEXT,
    ONBOARDING_DAILY_TEXT,
    ONBOARDING_WEEKLY_TEXT,
    SETTINGS_DAILY_TEXT,
    SETTINGS_TEXT,
    SETTINGS_WEEKLY_TEXT,
)
from app.db.models import DigestIssueType, DigestSection, SubscriptionMode
from app.db.session import AsyncSessionLocal
from app.services.deliveries import IssueDeliveryService
from app.services.digest import DigestBuilderService
from app.services.issues import IssueSnapshotService
from app.services.rendering import TelegramRenderingService
from app.services.bot_interaction_service import BotInteractionService

router = Router(name="navigation")
logger = logging.getLogger(__name__)
rendering_service = TelegramRenderingService()
DAILY_MAIN_SECTIONS = (
    DigestSection.IMPORTANT,
    DigestSection.AI_NEWS,
    DigestSection.CODING,
    DigestSection.INVESTMENTS,
    DigestSection.ALPHA,
)


@router.message(F.text == ONBOARDING_DAILY_BUTTON)
async def onboarding_daily_handler(message: Message) -> None:
    await _set_mode_and_answer(
        message=message,
        mode=SubscriptionMode.DAILY,
        confirmation_text=ONBOARDING_DAILY_TEXT,
        is_settings=False,
    )


@router.message(F.text == ONBOARDING_WEEKLY_BUTTON)
async def onboarding_weekly_handler(message: Message) -> None:
    await _set_mode_and_answer(
        message=message,
        mode=SubscriptionMode.WEEKLY,
        confirmation_text=ONBOARDING_WEEKLY_TEXT,
        is_settings=False,
    )


@router.message(F.text == MENU_SETTINGS_BUTTON)
async def settings_handler(message: Message) -> None:
    await message.answer(SETTINGS_TEXT, reply_markup=settings_keyboard())


@router.message(F.text == SETTINGS_DAILY_BUTTON)
async def settings_daily_handler(message: Message) -> None:
    await _set_mode_and_answer(
        message=message,
        mode=SubscriptionMode.DAILY,
        confirmation_text=SETTINGS_DAILY_TEXT,
        is_settings=True,
    )


@router.message(F.text == SETTINGS_WEEKLY_BUTTON)
async def settings_weekly_handler(message: Message) -> None:
    await _set_mode_and_answer(
        message=message,
        mode=SubscriptionMode.WEEKLY,
        confirmation_text=SETTINGS_WEEKLY_TEXT,
        is_settings=True,
    )


@router.message(F.text == SETTINGS_BACK_BUTTON)
async def settings_back_handler(message: Message) -> None:
    await message.answer("Главное меню открыто.", reply_markup=main_menu_keyboard())


@router.message(F.text == MENU_ABOUT_BUTTON)
async def about_handler(message: Message) -> None:
    if not message.from_user:
        return

    about_chunks = rendering_service.chunk_blocks(rendering_service.escape_text(ABOUT_TEXT), [])
    sent = await _answer_chunks(
        message,
        about_chunks,
        first_reply_markup=main_menu_keyboard(),
    )
    async with AsyncSessionLocal() as session:
        service = BotInteractionService(session)
        await service.log_about(
            telegram_user_id=message.from_user.id,
            telegram_chat_id=message.chat.id,
            telegram_message_id=sent.message_id if sent else None,
        )
    logger.info("about shown user_id=%s", message.from_user.id)


@router.message(F.text == MENU_TODAY_BUTTON)
async def today_handler(message: Message) -> None:
    if not message.from_user:
        return

    issue = await _get_or_build_daily_issue()
    if issue is None:
        await message.answer("Сегодняшний выпуск пока не собран.", reply_markup=main_menu_keyboard())
        return
    items_by_section = await _load_daily_main_sections(issue.id)
    chunks = render_daily_main(issue, items_by_section)
    sent = await _answer_chunks(
        message,
        chunks,
        first_reply_markup=daily_sections_keyboard(issue.id),
    )
    async with AsyncSessionLocal() as session:
        service = BotInteractionService(session)
        await service.log_daily_main(
            telegram_user_id=message.from_user.id,
            telegram_chat_id=message.chat.id,
            telegram_message_id=sent.message_id,
            issue_id=issue.id,
        )
    logger.info("daily issue shown user_id=%s issue_id=%s", message.from_user.id, issue.id)


@router.message(F.text == MENU_WEEKLY_BUTTON)
async def weekly_handler(message: Message) -> None:
    if not message.from_user:
        return

    issue = await _get_or_build_weekly_issue()
    if issue is None:
        await message.answer("Еженедельный выпуск пока не собран.", reply_markup=main_menu_keyboard())
        return
    items = await DigestBuilderService(AsyncSessionLocal).get_section_items(issue.id, DigestSection.ALL)
    sent = await _answer_chunks(
        message,
        render_weekly_main(issue, items),
        first_reply_markup=main_menu_keyboard(),
    )
    async with AsyncSessionLocal() as session:
        service = BotInteractionService(session)
        await service.log_weekly_main(
            telegram_user_id=message.from_user.id,
            telegram_chat_id=message.chat.id,
            telegram_message_id=sent.message_id,
            issue_id=issue.id,
        )
    logger.info("weekly issue shown user_id=%s issue_id=%s", message.from_user.id, issue.id)


@router.callback_query(F.data.startswith("issue:"))
async def issue_section_callback_handler(callback: CallbackQuery) -> None:
    if not callback.from_user or callback.message is None or callback.data is None:
        return

    _, issue_id_raw, section_raw = callback.data.split(":", maxsplit=2)
    issue_id = int(issue_id_raw)
    section = DigestSection(section_raw)
    delivery_service = IssueDeliveryService(AsyncSessionLocal)
    await delivery_service.send_section_message(
        bot=callback.bot,
        issue_id=issue_id,
        section=section,
        telegram_user_id=callback.from_user.id,
        telegram_chat_id=callback.message.chat.id,
    )
    await callback.answer()


@router.callback_query(F.data.startswith("about:"))
async def about_callback_handler(callback: CallbackQuery) -> None:
    if not callback.from_user or callback.message is None:
        return
    await IssueDeliveryService(AsyncSessionLocal).send_about_message(
        bot=callback.bot,
        telegram_user_id=callback.from_user.id,
        telegram_chat_id=callback.message.chat.id,
    )
    await callback.answer()


async def _set_mode_and_answer(
    *,
    message: Message,
    mode: SubscriptionMode,
    confirmation_text: str,
    is_settings: bool,
) -> None:
    if not message.from_user:
        return

    sent = await message.answer(confirmation_text, reply_markup=main_menu_keyboard())
    async with AsyncSessionLocal() as session:
        service = BotInteractionService(session)
        if is_settings:
            await service.set_settings_mode(
                telegram_user_id=message.from_user.id,
                telegram_chat_id=message.chat.id,
                mode=mode,
                telegram_message_id=sent.message_id,
            )
            logger.info("settings mode changed user_id=%s mode=%s", message.from_user.id, mode.value)
        else:
            await service.set_onboarding_mode(
                telegram_user_id=message.from_user.id,
                telegram_chat_id=message.chat.id,
                mode=mode,
                telegram_message_id=sent.message_id,
            )
            logger.info("onboarding mode selected user_id=%s mode=%s", message.from_user.id, mode.value)


async def _get_or_build_daily_issue():
    builder = DigestBuilderService(AsyncSessionLocal)
    return await IssueSnapshotService(builder).get_or_build_daily_issue(date.today())


async def _get_or_build_weekly_issue():
    builder = DigestBuilderService(AsyncSessionLocal)
    issue = await builder.get_latest_issue(DigestIssueType.WEEKLY)
    if issue is None:
        result = await builder.build_weekly_issue(date.today())
        issue = await builder.get_issue(result.issue_id)
    return issue


async def _load_daily_main_sections(issue_id: int) -> dict[DigestSection, list[object]]:
    builder = DigestBuilderService(AsyncSessionLocal)
    items_by_section: dict[DigestSection, list[object]] = {}
    for section in DAILY_MAIN_SECTIONS:
        items_by_section[section] = await builder.get_section_items(issue_id, section)
    return items_by_section


async def _answer_chunks(message: Message, chunks: list[str], *, first_reply_markup=None):
    sent = None
    for index, chunk in enumerate(chunks):
        sent = await message.answer(
            chunk,
            reply_markup=first_reply_markup if index == 0 else None,
            link_preview_options=LinkPreviewOptions(is_disabled=True),
        )
    return sent
