from __future__ import annotations

import logging
from collections.abc import Sequence

from apscheduler.schedulers.asyncio import AsyncIOScheduler

from app.core.config import Settings
from app.core.logging import log_structured
from app.jobs.daily_digest_job import build_daily_issue, send_daily_issue
from app.jobs.weekly_digest_job import build_weekly_issue, send_weekly_issue

logger = logging.getLogger(__name__)


def register_digest_jobs(
    *,
    scheduler: AsyncIOScheduler,
    session_factory,
    bot,
    settings: Settings,
) -> None:
    scheduler.add_job(
        build_daily_issue,
        "cron",
        hour=settings.daily_digest_hour,
        minute=settings.daily_digest_minute,
        args=[session_factory],
        id="build-daily-issue",
        replace_existing=True,
        max_instances=1,
        coalesce=True,
        misfire_grace_time=settings.scheduler_misfire_grace_seconds,
    )
    scheduler.add_job(
        send_daily_issue,
        "cron",
        hour=settings.daily_digest_hour,
        minute=(settings.daily_digest_minute + settings.digest_send_delay_minutes) % 60,
        args=[session_factory, bot],
        id="send-daily-issue",
        replace_existing=True,
        max_instances=1,
        coalesce=True,
        misfire_grace_time=settings.scheduler_misfire_grace_seconds,
    )
    scheduler.add_job(
        build_weekly_issue,
        "cron",
        day_of_week=settings.weekly_digest_weekday,
        hour=settings.weekly_digest_hour,
        minute=settings.weekly_digest_minute,
        args=[session_factory],
        id="build-weekly-issue",
        replace_existing=True,
        max_instances=1,
        coalesce=True,
        misfire_grace_time=settings.scheduler_misfire_grace_seconds,
    )
    scheduler.add_job(
        send_weekly_issue,
        "cron",
        day_of_week=settings.weekly_digest_weekday,
        hour=settings.weekly_digest_hour,
        minute=(settings.weekly_digest_minute + settings.digest_send_delay_minutes) % 60,
        args=[session_factory, bot],
        id="send-weekly-issue",
        replace_existing=True,
        max_instances=1,
        coalesce=True,
        misfire_grace_time=settings.scheduler_misfire_grace_seconds,
    )


def log_registered_jobs(*, scheduler: AsyncIOScheduler, service_name: str) -> None:
    log_structured(
        logger,
        "scheduler_jobs_registered",
        service_name=service_name,
        jobs=serialize_scheduler_jobs(scheduler.get_jobs()),
    )


def serialize_scheduler_jobs(jobs: Sequence) -> list[dict[str, object]]:
    return [
        {
            "id": job.id,
            "name": job.name,
            "trigger": str(job.trigger),
            "next_run_time": (
                getattr(job, "next_run_time", None).isoformat()
                if getattr(job, "next_run_time", None) is not None
                else None
            ),
            "max_instances": getattr(job, "max_instances", None),
            "coalesce": getattr(job, "coalesce", None),
            "misfire_grace_time": getattr(job, "misfire_grace_time", None),
        }
        for job in jobs
    ]
