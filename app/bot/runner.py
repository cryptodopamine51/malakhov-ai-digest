import asyncio

from app.bot.dispatcher import start_polling
from app.core.logging import configure_logging


async def main() -> None:
    configure_logging()
    await start_polling()


if __name__ == "__main__":
    asyncio.run(main())
