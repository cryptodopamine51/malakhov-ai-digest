from __future__ import annotations

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.interval import IntervalTrigger

from app.services.events import ProcessEventsJobRunner


def register_process_events_job(
    scheduler: AsyncIOScheduler,
    runner: ProcessEventsJobRunner,
    interval_minutes: int,
) -> None:
    scheduler.add_job(
        runner.run,
        trigger=IntervalTrigger(minutes=interval_minutes),
        id="process-events-job",
        replace_existing=True,
        max_instances=1,
        coalesce=True,
    )
