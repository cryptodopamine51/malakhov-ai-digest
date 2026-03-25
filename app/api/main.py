from __future__ import annotations

from contextlib import asynccontextmanager
from datetime import date as date_cls, datetime

from fastapi import FastAPI, HTTPException
from sqlalchemy import desc, select, text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker
from sqlalchemy.orm import selectinload

from app.core.config import get_settings
from app.core.logging import configure_logging
from app.db.models import (
    DigestIssue,
    DigestIssueItem,
    DigestIssueType,
    DigestSection,
    Event,
    EventCategory,
    EventSection,
    EventSource,
    EventTag,
    RawItem,
    Source,
    SourceRun,
    SourceType,
)
from app.db.session import AsyncSessionLocal
from app.jobs import (
    build_daily_issue,
    build_weekly_issue,
    create_scheduler,
    register_ingestion_job,
    register_process_events_job,
    send_daily_issue,
    send_weekly_issue,
)
from app.bot.dispatcher import create_bot
from app.api.routes.internal_alpha import register_internal_alpha_routes
from app.services.alpha import AlphaService
from app.services.events import ProcessEventsJobRunner, ProcessEventsService
from app.services.ingestion import IngestionJobRunner, IngestionService
from app.services.digest import DigestBuilderService
from app.services.deliveries import IssueDeliveryService
from app.services.sources import OfficialBlogAdapter, RssFeedAdapter, SourceHttpClient, SourceRegistry


def _serialize_datetime(value: datetime | None) -> str | None:
    return value.isoformat() if value else None


def _serialize_source(source: Source) -> dict[str, object]:
    return {
        "id": source.id,
        "source_type": source.source_type.value,
        "title": source.title,
        "handle_or_url": source.handle_or_url,
        "priority_weight": source.priority_weight,
        "is_active": source.is_active,
        "language": source.language,
        "country_scope": source.country_scope,
        "section_bias": source.section_bias,
        "created_at": _serialize_datetime(source.created_at),
        "updated_at": _serialize_datetime(source.updated_at),
    }


def _serialize_raw_item(item: RawItem) -> dict[str, object]:
    return {
        "id": item.id,
        "source_id": item.source_id,
        "external_id": item.external_id,
        "source_type": item.source_type.value,
        "author_name": item.author_name,
        "published_at": _serialize_datetime(item.published_at),
        "fetched_at": _serialize_datetime(item.fetched_at),
        "canonical_url": item.canonical_url,
        "raw_title": item.raw_title,
        "raw_text": item.raw_text,
        "language": item.language,
        "status": item.status.value,
    }


def _serialize_event(event: Event) -> dict[str, object]:
    primary_section = next((category.section.value for category in event.categories if category.is_primary_section), None)
    return {
        "id": event.id,
        "event_date": event.event_date.isoformat(),
        "title": event.title,
        "short_summary": event.short_summary,
        "long_summary": event.long_summary,
        "primary_source_id": event.primary_source_id,
        "primary_source_url": event.primary_source_url,
        "importance_score": event.importance_score,
        "market_impact_score": event.market_impact_score,
        "ai_news_score": event.ai_news_score,
        "coding_score": event.coding_score,
        "investment_score": event.investment_score,
        "confidence_score": event.confidence_score,
        "is_highlight": event.is_highlight,
        "primary_section": primary_section,
        "created_at": _serialize_datetime(event.created_at),
        "updated_at": _serialize_datetime(event.updated_at),
    }


def _serialize_event_source(event_source: EventSource) -> dict[str, object]:
    return {
        "id": event_source.id,
        "source_id": event_source.source_id,
        "raw_item_id": event_source.raw_item_id,
        "role": event_source.role.value,
        "citation_url": event_source.citation_url,
        "source_title": event_source.source.title if event_source.source else None,
        "raw_title": event_source.raw_item.normalized_title if event_source.raw_item else None,
    }


def _serialize_event_category(category: EventCategory) -> dict[str, object]:
    return {
        "section": category.section.value,
        "score": category.score,
        "is_primary_section": category.is_primary_section,
    }


def _serialize_event_tag(tag: EventTag) -> dict[str, object]:
    return {
        "tag": tag.tag,
        "tag_type": tag.tag_type.value,
    }


def _serialize_source_run(run: SourceRun) -> dict[str, object]:
    return {
        "id": run.id,
        "source_id": run.source_id,
        "started_at": _serialize_datetime(run.started_at),
        "finished_at": _serialize_datetime(run.finished_at),
        "status": run.status.value,
        "fetched_count": run.fetched_count,
        "inserted_count": run.inserted_count,
        "error_message": run.error_message,
    }


def _serialize_issue(issue: DigestIssue) -> dict[str, object]:
    return {
        "id": issue.id,
        "issue_type": issue.issue_type.value,
        "issue_date": issue.issue_date.isoformat(),
        "period_start": issue.period_start.isoformat(),
        "period_end": issue.period_end.isoformat(),
        "title": issue.title,
        "status": issue.status.value,
        "created_at": _serialize_datetime(issue.created_at),
        "updated_at": _serialize_datetime(issue.updated_at),
    }


def _serialize_issue_item(item: DigestIssueItem) -> dict[str, object]:
    return {
        "id": item.id,
        "issue_id": item.issue_id,
        "section": item.section.value,
        "event_id": item.event_id,
        "alpha_entry_id": item.alpha_entry_id,
        "rank_order": item.rank_order,
        "card_title": item.card_title,
        "card_text": item.card_text,
        "card_links_json": item.card_links_json,
        "is_primary_block": item.is_primary_block,
    }


def create_app(
    session_factory: async_sessionmaker[AsyncSession] | None = None,
    ingestion_job_runner: IngestionJobRunner | None = None,
    process_events_job_runner: ProcessEventsJobRunner | None = None,
    http_client: SourceHttpClient | None = None,
    telegram_bot=None,
    enable_scheduler: bool | None = None,
) -> FastAPI:
    configure_logging()
    settings = get_settings()
    db_session_factory = session_factory or AsyncSessionLocal
    source_http_client = http_client or SourceHttpClient(timeout_seconds=settings.ingestion_http_timeout_seconds)
    registry = SourceRegistry(
        {
            SourceType.RSS_FEED: RssFeedAdapter(source_http_client),
            SourceType.OFFICIAL_BLOG: OfficialBlogAdapter(source_http_client),
        }
    )
    job_runner = ingestion_job_runner or IngestionJobRunner(
        IngestionService(session_factory=db_session_factory, source_registry=registry)
    )
    process_runner = process_events_job_runner or ProcessEventsJobRunner(
        ProcessEventsService(session_factory=db_session_factory)
    )
    digest_builder = DigestBuilderService(db_session_factory)
    alpha_service = AlphaService(db_session_factory)
    issue_delivery_service = IssueDeliveryService(db_session_factory)
    bot = telegram_bot
    scheduler_enabled = settings.ingestion_scheduler_enabled if enable_scheduler is None else enable_scheduler

    @asynccontextmanager
    async def lifespan(_: FastAPI):
        scheduler = None
        runtime_bot = bot
        if scheduler_enabled:
            if runtime_bot is None:
                runtime_bot = create_bot()
            scheduler = create_scheduler()
            register_ingestion_job(
                scheduler=scheduler,
                runner=job_runner,
                interval_minutes=settings.ingestion_interval_minutes,
            )
            if settings.process_events_scheduler_enabled:
                register_process_events_job(
                    scheduler=scheduler,
                    runner=process_runner,
                    interval_minutes=settings.process_events_interval_minutes,
                )
            scheduler.add_job(build_daily_issue, "cron", hour=settings.daily_digest_hour, args=[db_session_factory], id="build-daily-issue", replace_existing=True)
            scheduler.add_job(send_daily_issue, "cron", hour=settings.daily_digest_hour, minute=5, args=[db_session_factory, runtime_bot], id="send-daily-issue", replace_existing=True)
            scheduler.add_job(build_weekly_issue, "cron", day_of_week=settings.weekly_digest_weekday, hour=settings.weekly_digest_hour, args=[db_session_factory], id="build-weekly-issue", replace_existing=True)
            scheduler.add_job(send_weekly_issue, "cron", day_of_week=settings.weekly_digest_weekday, hour=settings.weekly_digest_hour, minute=5, args=[db_session_factory, runtime_bot], id="send-weekly-issue", replace_existing=True)
            scheduler.start()
        try:
            yield
        finally:
            if scheduler is not None and scheduler.running:
                scheduler.shutdown(wait=False)
            if runtime_bot is not None and telegram_bot is None:
                await runtime_bot.session.close()
            if http_client is None:
                await source_http_client.aclose()

    app = FastAPI(title="Malakhov AI Digest API", version="0.2.0", lifespan=lifespan)
    app.state.ingestion_job_runner = job_runner
    app.state.process_events_job_runner = process_runner
    app.state.digest_builder = digest_builder
    app.state.alpha_service = alpha_service
    app.state.bot = telegram_bot

    register_internal_alpha_routes(app, alpha_service)

    @app.get("/health")
    async def health() -> dict[str, str]:
        return {
            "status": "ok",
            "service": "malakhov-ai-digest",
            "environment": settings.app_env,
        }

    @app.get("/health/db")
    async def health_db() -> dict[str, str]:
        try:
            async with db_session_factory() as session:
                await session.execute(text("SELECT 1"))
            return {"status": "ok", "database": "connected"}
        except SQLAlchemyError as exc:
            raise HTTPException(status_code=503, detail="database unavailable") from exc

    @app.get("/internal/sources")
    async def list_sources() -> dict[str, list[dict[str, object]]]:
        async with db_session_factory() as session:
            sources = list((await session.scalars(select(Source).order_by(Source.priority_weight.asc(), Source.id.asc()))).all())
        return {"items": [_serialize_source(source) for source in sources]}

    @app.get("/internal/raw-items")
    async def list_raw_items(source_id: int | None = None, limit: int = 20) -> dict[str, list[dict[str, object]]]:
        safe_limit = max(1, min(limit, 100))
        stmt = select(RawItem).order_by(desc(RawItem.published_at), desc(RawItem.id)).limit(safe_limit)
        if source_id is not None:
            stmt = stmt.where(RawItem.source_id == source_id)
        async with db_session_factory() as session:
            items = list((await session.scalars(stmt)).all())
        return {"items": [_serialize_raw_item(item) for item in items]}

    @app.get("/internal/source-runs")
    async def list_source_runs(limit: int = 20) -> dict[str, list[dict[str, object]]]:
        safe_limit = max(1, min(limit, 100))
        stmt = select(SourceRun).order_by(desc(SourceRun.started_at), desc(SourceRun.id)).limit(safe_limit)
        async with db_session_factory() as session:
            runs = list((await session.scalars(stmt)).all())
        return {"items": [_serialize_source_run(run) for run in runs]}

    @app.post("/internal/jobs/ingest")
    async def run_ingestion_job() -> dict[str, object]:
        result = await job_runner.run()
        if result is None:
            raise HTTPException(status_code=409, detail="ingestion already running")
        return {
            "status": "ok",
            "sources_processed": len(result.results),
            "fetched_count": result.total_fetched,
            "inserted_count": result.total_inserted,
            "results": [
                {
                    "source_id": item.source_id,
                    "status": item.status.value,
                    "fetched_count": item.fetched_count,
                    "inserted_count": item.inserted_count,
                    "error_message": item.error_message,
                    "warnings": item.warnings,
                }
                for item in result.results
            ],
        }

    @app.get("/internal/events")
    async def list_events(
        section: str | None = None,
        date: str | None = None,
        limit: int = 20,
    ) -> dict[str, list[dict[str, object]]]:
        safe_limit = max(1, min(limit, 100))
        stmt = (
            select(Event)
            .options(selectinload(Event.categories), selectinload(Event.tags), selectinload(Event.event_sources))
            .order_by(Event.event_date.desc(), Event.importance_score.desc(), Event.id.desc())
            .limit(safe_limit)
        )
        if date is not None:
            try:
                target_date = date_cls.fromisoformat(date)
            except ValueError as exc:
                raise HTTPException(status_code=400, detail="invalid date") from exc
            stmt = stmt.where(Event.event_date == target_date)
        if section is not None:
            try:
                target_section = EventSection(section)
            except ValueError as exc:
                raise HTTPException(status_code=400, detail="invalid section") from exc
            stmt = stmt.join(Event.categories).where(EventCategory.section == target_section)
        async with db_session_factory() as session:
            events = list((await session.scalars(stmt)).unique().all())
        return {"items": [_serialize_event(event) for event in events]}

    @app.get("/internal/events/{event_id}")
    async def get_event(event_id: int) -> dict[str, object]:
        stmt = (
            select(Event)
            .where(Event.id == event_id)
            .options(
                selectinload(Event.categories),
                selectinload(Event.tags),
                selectinload(Event.primary_source),
                selectinload(Event.event_sources).selectinload(EventSource.source),
                selectinload(Event.event_sources).selectinload(EventSource.raw_item),
            )
        )
        async with db_session_factory() as session:
            event = await session.scalar(stmt)
        if event is None:
            raise HTTPException(status_code=404, detail="event not found")
        return {
            "event": _serialize_event(event),
            "categories": [_serialize_event_category(category) for category in event.categories],
            "tags": [_serialize_event_tag(tag) for tag in event.tags],
            "primary_source": _serialize_source(event.primary_source) if event.primary_source else None,
            "sources": [_serialize_event_source(event_source) for event_source in event.event_sources],
        }

    @app.get("/internal/events/preview/day/{day}")
    async def preview_events_by_day(day: str) -> dict[str, object]:
        try:
            target_date = date_cls.fromisoformat(day)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail="invalid date") from exc

        stmt = (
            select(Event)
            .where(Event.event_date == target_date)
            .options(selectinload(Event.categories))
            .order_by(Event.importance_score.desc(), Event.id.desc())
        )
        async with db_session_factory() as session:
            events = list((await session.scalars(stmt)).unique().all())

        grouped: dict[str, list[dict[str, object]]] = {section.value: [] for section in EventSection}
        for event in events:
            primary_section = next((category.section for category in event.categories if category.is_primary_section), None)
            bucket = primary_section.value if primary_section else EventSection.AI_NEWS.value
            grouped[bucket].append(_serialize_event(event))

        return {"date": target_date.isoformat(), "sections": grouped}

    @app.post("/internal/jobs/process-events")
    async def run_process_events_job() -> dict[str, object]:
        result = await process_runner.run()
        if result is None:
            raise HTTPException(status_code=409, detail="process-events already running")
        return {
            "status": "ok",
            "normalized_count": result.normalized_count,
            "clustered_count": result.clustered_count,
            "discarded_count": result.discarded_count,
            "created_events": result.created_events,
            "updated_events": result.updated_events,
        }

    @app.get("/internal/issues")
    async def list_issues(
        issue_type: str | None = None,
        date: str | None = None,
        limit: int = 20,
    ) -> dict[str, list[dict[str, object]]]:
        parsed_issue_type = DigestIssueType(issue_type) if issue_type is not None else None
        parsed_date = date_cls.fromisoformat(date) if date is not None else None
        issues = await digest_builder.list_issues(issue_type=parsed_issue_type, issue_date=parsed_date, limit=max(1, min(limit, 100)))
        return {"items": [_serialize_issue(issue) for issue in issues]}

    @app.get("/internal/issues/{issue_id}")
    async def get_issue(issue_id: int) -> dict[str, object]:
        issue = await digest_builder.get_issue(issue_id)
        if issue is None:
            raise HTTPException(status_code=404, detail="issue not found")
        return {
            "issue": _serialize_issue(issue),
            "items": [_serialize_issue_item(item) for item in sorted(issue.items, key=lambda item: (item.section.value, item.rank_order, item.id))],
        }

    @app.get("/internal/issues/{issue_id}/section/{section}")
    async def get_issue_section(issue_id: int, section: str) -> dict[str, object]:
        try:
            parsed_section = DigestSection(section)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail="invalid section") from exc
        issue = await digest_builder.get_issue(issue_id)
        if issue is None:
            raise HTTPException(status_code=404, detail="issue not found")
        items = await digest_builder.get_section_items(issue_id, parsed_section)
        return {
            "issue": _serialize_issue(issue),
            "section": parsed_section.value,
            "items": [_serialize_issue_item(item) for item in items],
        }

    @app.post("/internal/jobs/build-daily")
    async def build_daily(date: str | None = None) -> dict[str, object]:
        target_date = date_cls.fromisoformat(date) if date else date_cls.today()
        result = await digest_builder.build_daily_issue(target_date)
        return {
            "status": "ok",
            "issue_id": result.issue_id,
            "issue_type": result.issue_type.value,
            "issue_date": result.issue_date.isoformat(),
            "reused_snapshot": result.reused_snapshot,
        }

    @app.post("/internal/jobs/build-weekly")
    async def build_weekly(date: str | None = None) -> dict[str, object]:
        target_date = date_cls.fromisoformat(date) if date else date_cls.today()
        result = await digest_builder.build_weekly_issue(target_date)
        return {
            "status": "ok",
            "issue_id": result.issue_id,
            "issue_type": result.issue_type.value,
            "issue_date": result.issue_date.isoformat(),
            "reused_snapshot": result.reused_snapshot,
        }

    @app.post("/internal/jobs/send-daily")
    async def send_daily() -> dict[str, object]:
        runtime_bot = telegram_bot or create_bot()
        try:
            sent_count = await send_daily_issue(db_session_factory, runtime_bot)
        finally:
            if telegram_bot is None:
                await runtime_bot.session.close()
        return {"status": "ok", "sent_count": sent_count}

    @app.post("/internal/jobs/send-weekly")
    async def send_weekly() -> dict[str, object]:
        runtime_bot = telegram_bot or create_bot()
        try:
            sent_count = await send_weekly_issue(db_session_factory, runtime_bot)
        finally:
            if telegram_bot is None:
                await runtime_bot.session.close()
        return {"status": "ok", "sent_count": sent_count}

    @app.post("/internal/issues/{issue_id}/resend")
    async def resend_issue(
        issue_id: int,
        telegram_user_id: int,
        telegram_chat_id: int,
    ) -> dict[str, object]:
        runtime_bot = telegram_bot or create_bot()
        try:
            message_id = await issue_delivery_service.resend_issue(
                bot=runtime_bot,
                issue_id=issue_id,
                telegram_user_id=telegram_user_id,
                telegram_chat_id=telegram_chat_id,
            )
        finally:
            if telegram_bot is None:
                await runtime_bot.session.close()
        if message_id is None:
            raise HTTPException(status_code=404, detail="issue not found")
        return {"status": "ok", "message_id": message_id}

    return app


app = create_app()
