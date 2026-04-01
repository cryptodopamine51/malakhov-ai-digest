import asyncio

from app.bot.dispatcher import start_polling
from app.core.logging import log_structured
from app.core.logging import configure_logging
import logging

logger = logging.getLogger(__name__)


async def main() -> None:
    configure_logging()
    log_structured(logger, "bot_runner_startup")
    await start_polling()


if __name__ == "__main__":
    asyncio.run(main())
