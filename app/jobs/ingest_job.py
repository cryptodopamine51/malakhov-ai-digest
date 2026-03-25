from __future__ import annotations

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.interval import IntervalTrigger

from app.services.ingestion import IngestionJobRunner


def register_ingestion_job(
    scheduler: AsyncIOScheduler,
    runner: IngestionJobRunner,
    interval_minutes: int,
) -> None:
    scheduler.add_job(
        runner.run,
        trigger=IntervalTrigger(minutes=interval_minutes),
        id="ingestion-job",
        replace_existing=True,
        max_instances=1,
        coalesce=True,
    )
