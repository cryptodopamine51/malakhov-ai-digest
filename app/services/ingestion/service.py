from __future__ import annotations

import logging
from datetime import UTC, datetime

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.core.config import get_settings
from app.core.datetime import ensure_utc
from app.core.logging import log_structured
from app.db.models import RawItem, RawItemStatus, Source, SourceRun, SourceRunStatus
from app.services.ingestion.schemas import BatchIngestionResult, SourceIngestionResult
from app.services.sources import SourceRegistry, SourceService
from app.services.sources.reputation import classify_source_pool_role, score_source
from app.services.sources.schemas import FetchedItem

logger = logging.getLogger(__name__)


class IngestionService:
    def __init__(
        self,
        session_factory: async_sessionmaker[AsyncSession],
        source_registry: SourceRegistry,
    ) -> None:
        self.session_factory = session_factory
        self.source_registry = source_registry
        self.settings = get_settings()

    async def ingest_active_sources(self) -> BatchIngestionResult:
        async with self.session_factory() as session:
            sources = await SourceService(session).list_sources(active_only=True)

        results: list[SourceIngestionResult] = []
        for source in sources:
            results.append(await self.ingest_source(source.id))
        return BatchIngestionResult(results=results)

    async def ingest_source(self, source_id: int) -> SourceIngestionResult:
        async with self.session_factory() as session:
            source = await session.get(Source, source_id)
            if source is None:
                raise ValueError(f"source {source_id} does not exist")
            resolved_source_id = source.id
            source_title = source.title
            source_reputation = score_source(source)
            source_pool_role = classify_source_pool_role(source)

            started_at = datetime.now(UTC)
            source_run = SourceRun(
                source_id=resolved_source_id,
                started_at=started_at,
                status=SourceRunStatus.FAILED,
                fetched_count=0,
                inserted_count=0,
                duplicate_count=0,
                failed_count=0,
            )
            session.add(source_run)
            await session.flush()
            await session.commit()
            fetched_count = 0
            duplicate_count = 0

            last_successful_run = await session.scalar(
                select(SourceRun)
                .where(
                    SourceRun.source_id == resolved_source_id,
                    SourceRun.status.in_([SourceRunStatus.SUCCESS, SourceRunStatus.PARTIAL]),
                    SourceRun.finished_at.is_not(None),
                    SourceRun.id != source_run.id,
                )
                .order_by(SourceRun.finished_at.desc(), SourceRun.id.desc())
            )
            freshness_window = self._freshness_window_minutes(source)
            if self._is_within_freshness_window(last_successful_run, freshness_window):
                finished_at = datetime.now(UTC)
                source_run.finished_at = finished_at
                source_run.status = SourceRunStatus.SUCCESS
                source_run.duration_ms = self._duration_ms(started_at, finished_at)
                source_run.error_message = f"skipped_freshness_window:{freshness_window}m"
                await session.commit()
                log_structured(
                    logger,
                    "source_ingestion_skip",
                    source_id=resolved_source_id,
                    source_title=source_title,
                    source_quality_tier=source_reputation.tier,
                    source_pool_role=source_pool_role,
                    freshness_window_minutes=freshness_window,
                    started_at=started_at.isoformat(),
                    finished_at=finished_at.isoformat(),
                    duration_ms=source_run.duration_ms,
                )
                return SourceIngestionResult(
                    source_id=resolved_source_id,
                    status=SourceRunStatus.SUCCESS,
                    fetched_count=0,
                    inserted_count=0,
                    duplicate_count=0,
                    duration_ms=source_run.duration_ms,
                    skipped=True,
                    warnings=[f"skipped because source was checked within the last {freshness_window} minutes"],
                )

            try:
                adapter = self.source_registry.get_adapter(source.source_type)
                fetch_result = await adapter.fetch(source)
                fetched_count = len(fetch_result.items)
                inserted_count, duplicate_count = await self._store_items(session=session, source=source, items=fetch_result.items)
                status = SourceRunStatus.PARTIAL if fetch_result.warnings else SourceRunStatus.SUCCESS
                finished_at = datetime.now(UTC)
                source_run.finished_at = finished_at
                source_run.status = status
                source_run.fetched_count = fetched_count
                source_run.inserted_count = inserted_count
                source_run.duplicate_count = duplicate_count
                source_run.failed_count = 0
                source_run.duration_ms = self._duration_ms(started_at, finished_at)
                source_run.error_message = "\n".join(fetch_result.warnings) if fetch_result.warnings else None
                source.last_success_at = finished_at
                source.last_http_status = 200
                await session.commit()
                log_structured(
                    logger,
                    "source_ingestion_completed",
                    source_id=resolved_source_id,
                    source_title=source_title,
                    source_quality_tier=source_reputation.tier,
                    source_pool_role=source_pool_role,
                    status=status.value,
                    started_at=started_at.isoformat(),
                    finished_at=finished_at.isoformat(),
                    fetched_count=fetched_count,
                    inserted_count=inserted_count,
                    duplicate_count=duplicate_count,
                    failed_count=0,
                    duration_ms=source_run.duration_ms,
                    error_message=source_run.error_message,
                )
                return SourceIngestionResult(
                    source_id=resolved_source_id,
                    status=status,
                    fetched_count=fetched_count,
                    inserted_count=inserted_count,
                    duplicate_count=duplicate_count,
                    duration_ms=source_run.duration_ms,
                    warnings=fetch_result.warnings,
                )
            except Exception as exc:
                await session.rollback()
                finished_at = datetime.now(UTC)
                source_run.finished_at = finished_at
                source_run.status = SourceRunStatus.FAILED
                source_run.fetched_count = fetched_count
                source_run.inserted_count = 0
                source_run.duplicate_count = duplicate_count
                source_run.failed_count = 1
                source_run.duration_ms = self._duration_ms(started_at, finished_at)
                source_run.error_message = str(exc)
                source.last_http_status = self._extract_http_status(exc)
                session.add(source_run)
                await session.commit()
                log_structured(
                    logger,
                    "source_ingestion_failed",
                    source_id=resolved_source_id,
                    source_title=source_title,
                    source_quality_tier=source_reputation.tier,
                    source_pool_role=source_pool_role,
                    started_at=started_at.isoformat(),
                    finished_at=finished_at.isoformat(),
                    fetched_count=fetched_count,
                    inserted_count=0,
                    duplicate_count=duplicate_count,
                    failed_count=1,
                    duration_ms=source_run.duration_ms,
                    error_message=str(exc),
                )
                return SourceIngestionResult(
                    source_id=resolved_source_id,
                    status=SourceRunStatus.FAILED,
                    fetched_count=fetched_count,
                    inserted_count=0,
                    duplicate_count=duplicate_count,
                    failed_count=1,
                    duration_ms=source_run.duration_ms,
                    error_message=str(exc),
                )

    async def _store_items(self, session: AsyncSession, source: Source, items: list[FetchedItem]) -> tuple[int, int]:
        if not items:
            return 0, 0

        external_ids = [item.external_id for item in items]
        existing_ids = set(
            (
                await session.scalars(
                    select(RawItem.external_id).where(
                        RawItem.source_id == source.id,
                        RawItem.external_id.in_(external_ids),
                    )
                )
            ).all()
        )

        inserted_count = 0
        duplicate_count = 0
        seen_external_ids = set(existing_ids)
        for item in items:
            if item.external_id in seen_external_ids:
                duplicate_count += 1
                continue
            seen_external_ids.add(item.external_id)
            session.add(
                RawItem(
                    source_id=source.id,
                    external_id=item.external_id,
                    source_type=source.source_type,
                    author_name=item.author_name,
                    published_at=item.published_at,
                    canonical_url=item.canonical_url,
                    raw_title=item.title,
                    raw_text=item.text,
                    raw_payload_json=item.payload,
                    language=item.language or source.language,
                    status=RawItemStatus.FETCHED,
                )
            )
            inserted_count += 1

        await session.flush()
        return inserted_count, duplicate_count

    def _freshness_window_minutes(self, source: Source) -> int:
        if source.source_type.value == "official_blog":
            return self.settings.official_blog_freshness_window_minutes
        if source.source_type.value == "website":
            return self.settings.website_freshness_window_minutes
        return self.settings.rss_freshness_window_minutes

    def _is_within_freshness_window(self, last_run: SourceRun | None, freshness_window_minutes: int) -> bool:
        if last_run is None or last_run.finished_at is None:
            return False
        delta_seconds = (datetime.now(UTC) - ensure_utc(last_run.finished_at)).total_seconds()
        return delta_seconds < freshness_window_minutes * 60

    def _duration_ms(self, started_at: datetime, finished_at: datetime) -> int:
        return max(int((finished_at - started_at).total_seconds() * 1000), 0)

    def _extract_http_status(self, exc: Exception) -> int | None:
        if isinstance(exc, httpx.HTTPStatusError) and exc.response is not None:
            return exc.response.status_code
        return None
