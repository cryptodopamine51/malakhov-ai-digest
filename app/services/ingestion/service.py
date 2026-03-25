from __future__ import annotations

import logging
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.db.models import RawItem, RawItemStatus, Source, SourceRun, SourceRunStatus
from app.services.ingestion.schemas import BatchIngestionResult, SourceIngestionResult
from app.services.sources import SourceRegistry, SourceService
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

            started_at = datetime.now(UTC)
            source_run = SourceRun(
                source_id=resolved_source_id,
                started_at=started_at,
                status=SourceRunStatus.FAILED,
                fetched_count=0,
                inserted_count=0,
            )
            session.add(source_run)
            await session.flush()
            await session.commit()
            fetched_count = 0

            try:
                adapter = self.source_registry.get_adapter(source.source_type)
                fetch_result = await adapter.fetch(source)
                fetched_count = len(fetch_result.items)
                inserted_count = await self._store_items(session=session, source=source, items=fetch_result.items)
                status = SourceRunStatus.PARTIAL if fetch_result.warnings else SourceRunStatus.SUCCESS
                source_run.finished_at = datetime.now(UTC)
                source_run.status = status
                source_run.fetched_count = fetched_count
                source_run.inserted_count = inserted_count
                source_run.error_message = "\n".join(fetch_result.warnings) if fetch_result.warnings else None
                await session.commit()
                logger.info(
                    "ingestion completed source_id=%s status=%s fetched=%s inserted=%s",
                    resolved_source_id,
                    status.value,
                    fetched_count,
                    inserted_count,
                )
                return SourceIngestionResult(
                    source_id=resolved_source_id,
                    status=status,
                    fetched_count=fetched_count,
                    inserted_count=inserted_count,
                    warnings=fetch_result.warnings,
                )
            except Exception as exc:
                await session.rollback()
                source_run.finished_at = datetime.now(UTC)
                source_run.status = SourceRunStatus.FAILED
                source_run.fetched_count = fetched_count
                source_run.inserted_count = 0
                source_run.error_message = str(exc)
                session.add(source_run)
                await session.commit()
                logger.exception("ingestion failed for source_id=%s", resolved_source_id)
                return SourceIngestionResult(
                    source_id=resolved_source_id,
                    status=SourceRunStatus.FAILED,
                    fetched_count=fetched_count,
                    inserted_count=0,
                    error_message=str(exc),
                )

    async def _store_items(self, session: AsyncSession, source: Source, items: list[FetchedItem]) -> int:
        if not items:
            return 0

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
        seen_external_ids = set(existing_ids)
        for item in items:
            if item.external_id in seen_external_ids:
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
        return inserted_count
