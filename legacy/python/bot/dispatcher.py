import logging

from aiogram import Bot, Dispatcher
from aiogram.client.default import DefaultBotProperties
from aiogram.enums import ParseMode
from aiogram.types import BotCommand

from app.bot.handlers import navigation_router, start_router
from app.core.config import get_settings
from app.core.logging import log_structured

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


async def start_polling(bot: Bot | None = None, *, handle_signals: bool = True) -> None:
    bot = bot or create_bot()
    dp = create_dispatcher()
    log_structured(logger, "bot_startup", handle_signals=handle_signals)
    await bot.delete_webhook(drop_pending_updates=False)
    log_structured(logger, "bot_webhook_cleared")
    await set_bot_commands(bot)
    log_structured(logger, "bot_polling_prepare")
    logger.info("Starting bot in polling mode")
    try:
        await dp.start_polling(bot, handle_signals=handle_signals)
    except Exception as exc:
        log_structured(logger, "bot_polling_stopped", status="error", error_message=str(exc))
        raise
    else:
        log_structured(logger, "bot_polling_stopped", status="stopped")
