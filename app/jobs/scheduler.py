from apscheduler.schedulers.asyncio import AsyncIOScheduler

from app.core.config import get_settings


def create_scheduler() -> AsyncIOScheduler:
    settings = get_settings()
    return AsyncIOScheduler(
        timezone=settings.default_timezone,
        job_defaults={
            "coalesce": True,
            "max_instances": 1,
            "misfire_grace_time": settings.scheduler_misfire_grace_seconds,
        },
    )
