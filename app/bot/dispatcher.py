import logging

from aiogram import Bot, Dispatcher
from aiogram.client.default import DefaultBotProperties
from aiogram.enums import ParseMode
from aiogram.types import BotCommand

from app.bot.handlers import navigation_router, start_router
from app.core.config import get_settings

logger = logging.getLogger(__name__)


def create_dispatcher() -> Dispatcher:
    dp = Dispatcher()
    dp.include_router(start_router)
    dp.include_router(navigation_router)
    return dp


def create_bot() -> Bot:
    settings = get_settings()
    return Bot(
        token=settings.bot_token,
        default=DefaultBotProperties(parse_mode=ParseMode.HTML),
    )


async def set_bot_commands(bot: Bot) -> None:
    await bot.set_my_commands(
        [
            BotCommand(command="start", description="Запустить бота"),
        ]
    )


async def start_polling() -> None:
    bot = create_bot()
    dp = create_dispatcher()
    await set_bot_commands(bot)
    logger.info("Starting bot in polling mode")
    await dp.start_polling(bot)
