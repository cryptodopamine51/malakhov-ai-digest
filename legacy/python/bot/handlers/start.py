import logging

from aiogram import Router
from aiogram.filters import CommandStart
from aiogram.types import Message

from app.bot.keyboards.reply import onboarding_keyboard
from app.bot.renderers import render_start_welcome
from app.db.session import AsyncSessionLocal
from app.services.bot_interaction_service import BotInteractionService

router = Router(name="start")
logger = logging.getLogger(__name__)


@router.message(CommandStart())
async def start_handler(message: Message) -> None:
    if not message.from_user:
        return

    async with AsyncSessionLocal() as session:
        service = BotInteractionService(session)
        result = await service.ensure_user(
            telegram_user_id=message.from_user.id,
            telegram_chat_id=message.chat.id,
        )

    logger.info("/start from user_id=%s created=%s", message.from_user.id, result.is_new_user)
    chunks = render_start_welcome(result.user.subscription_mode if not result.is_new_user else None)
    for index, chunk in enumerate(chunks):
        kwargs = {"reply_markup": onboarding_keyboard()} if index == 0 else {}
        await message.answer(chunk, **kwargs)
