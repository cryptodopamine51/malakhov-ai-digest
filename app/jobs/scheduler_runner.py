from __future__ import annotations

import asyncio
import logging

from app.bot.dispatcher import create_bot
from app.core.config import get_settings
from app.core.logging import configure_logging
from app.db.session import AsyncSessionLocal
from app.jobs import (
    create_scheduler,
    log_registered_jobs,
    register_digest_jobs,
    register_ingestion_job,
    register_process_events_job,
)
from app.services.events import ProcessEventsJobRunner, ProcessEventsService
from app.services.ingestion import IngestionJobRunner, IngestionService
from app.services.sources import OfficialBlogAdapter, RssFeedAdapter, SourceHttpClient, SourceRegistry, WebsiteFeedAdapter
from app.db.models import SourceType

logger = logging.getLogger(__name__)


async def main() -> None:
    configure_logging()
    settings = get_settings()
    bot = create_bot()
    http_client = SourceHttpClient(timeout_seconds=settings.ingestion_http_timeout_seconds)
    registry = SourceRegistry(
        {
            SourceType.RSS_FEED: RssFeedAdapter(http_client),
            SourceType.OFFICIAL_BLOG: OfficialBlogAdapter(http_client),
            SourceType.WEBSITE: WebsiteFeedAdapter(http_client),
        }
    )
    ingestion_runner = IngestionJobRunner(IngestionService(session_factory=AsyncSessionLocal, source_registry=registry))
    process_runner = ProcessEventsJobRunner(ProcessEventsService(session_factory=AsyncSessionLocal))
    scheduler = create_scheduler()

    register_ingestion_job(
        scheduler=scheduler,
        runner=ingestion_runner,
        interval_minutes=settings.ingestion_interval_minutes,
    )
    if settings.process_events_scheduler_enabled:
        register_process_events_job(
            scheduler=scheduler,
            runner=process_runner,
            interval_minutes=settings.process_events_interval_minutes,
        )
    register_digest_jobs(
        scheduler=scheduler,
        session_factory=AsyncSessionLocal,
        bot=bot,
        settings=settings,
    )
    logger.info("Starting scheduler service")
    scheduler.start()
    log_registered_jobs(scheduler=scheduler, service_name="scheduler")
    try:
        await asyncio.Event().wait()
    finally:
        if scheduler.running:
            scheduler.shutdown(wait=False)
        await http_client.aclose()
        await bot.session.close()


if __name__ == "__main__":
    asyncio.run(main())
