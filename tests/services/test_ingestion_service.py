from __future__ import annotations

from datetime import UTC, datetime

import httpx
from sqlalchemy import func, select

from app.db.models import RawItem, Source, SourceRun, SourceRunStatus, SourceType
from app.services.ingestion.service import IngestionService
from app.services.sources.base import SourceAdapter
from app.services.sources.registry import SourceRegistry
from app.services.sources.schemas import FetchResult, FetchedItem
from tests.helpers import OFFICIAL_BLOG_HTML, RSS_FEED_XML, build_http_client, build_registry


class DuplicateBatchAdapter(SourceAdapter):
    async def fetch(self, source: Source) -> FetchResult:
        item = FetchedItem(
            external_id="duplicate-item",
            published_at=datetime(2026, 3, 25, 10, 0, tzinfo=UTC),
            canonical_url="https://example.com/items/duplicate-item",
            title="Duplicate item",
            text="Duplicate body",
            author_name=None,
            language="en",
            payload={"id": "duplicate-item"},
        )
        return FetchResult(items=[item, item])


async def test_create_source_record(db_session):
    source = Source(
        source_type=SourceType.RSS_FEED,
        title="Test feed",
        handle_or_url="https://example.com/feed.xml",
        priority_weight=100,
        is_active=True,
        language="en",
        country_scope="global",
    )
    db_session.add(source)
    await db_session.commit()

    source_count = await db_session.scalar(select(func.count()).select_from(Source))
    assert source_count == 1


async def test_successful_rss_ingestion_and_dedup(session_factory):
    async with session_factory() as session:
        source = Source(
            source_type=SourceType.RSS_FEED,
            title="Example RSS",
            handle_or_url="https://example.com/feed.xml",
            priority_weight=100,
            is_active=True,
            language="en",
            country_scope="global",
        )
        session.add(source)
        await session.commit()
        source_id = source.id

    http_client = build_http_client(
        {
            "https://example.com/feed.xml": httpx.Response(200, text=RSS_FEED_XML),
        }
    )
    ingestion_service = IngestionService(session_factory=session_factory, source_registry=build_registry(http_client))

    first_result = await ingestion_service.ingest_source(source_id)
    second_result = await ingestion_service.ingest_source(source_id)

    async with session_factory() as session:
        raw_item_count = await session.scalar(select(func.count()).select_from(RawItem))
        runs = list((await session.scalars(select(SourceRun).order_by(SourceRun.id.asc()))).all())

    await http_client.aclose()

    assert first_result.status == SourceRunStatus.SUCCESS
    assert first_result.fetched_count == 2
    assert first_result.inserted_count == 2
    assert second_result.status == SourceRunStatus.SUCCESS
    assert second_result.fetched_count == 0
    assert second_result.inserted_count == 0
    assert second_result.skipped is True
    assert raw_item_count == 2
    assert len(runs) == 2
    assert all(run.status == SourceRunStatus.SUCCESS for run in runs)


async def test_failed_source_run_logging(session_factory):
    async with session_factory() as session:
        source = Source(
            source_type=SourceType.OFFICIAL_BLOG,
            title="Broken blog",
            handle_or_url="https://broken.example.com/blog",
            priority_weight=100,
            is_active=True,
            language="en",
            country_scope="global",
        )
        session.add(source)
        await session.commit()
        source_id = source.id

    http_client = build_http_client(
        {
            "https://broken.example.com/blog": httpx.Response(500, text="upstream error"),
        }
    )
    ingestion_service = IngestionService(session_factory=session_factory, source_registry=build_registry(http_client))

    result = await ingestion_service.ingest_source(source_id)

    async with session_factory() as session:
        source_run = await session.scalar(select(SourceRun).where(SourceRun.source_id == source_id))

    await http_client.aclose()

    assert result.status == SourceRunStatus.FAILED
    assert source_run is not None
    assert source_run.status == SourceRunStatus.FAILED
    assert source_run.error_message is not None


async def test_official_blog_ingestion_uses_feed_discovery(session_factory):
    async with session_factory() as session:
        source = Source(
            source_type=SourceType.OFFICIAL_BLOG,
            title="Official Blog",
            handle_or_url="https://example.com/blog",
            priority_weight=100,
            is_active=True,
            language="en",
            country_scope="global",
        )
        session.add(source)
        await session.commit()
        source_id = source.id

    http_client = build_http_client(
        {
            "https://example.com/blog": httpx.Response(200, text=OFFICIAL_BLOG_HTML),
            "https://example.com/blog/feed.xml": httpx.Response(200, text=RSS_FEED_XML),
            "https://example.com/blog/feed": httpx.Response(404, text="not found"),
        }
    )
    ingestion_service = IngestionService(session_factory=session_factory, source_registry=build_registry(http_client))

    result = await ingestion_service.ingest_source(source_id)

    async with session_factory() as session:
        raw_item_count = await session.scalar(select(func.count()).select_from(RawItem))
        source_run = await session.scalar(select(SourceRun).where(SourceRun.source_id == source_id))

    await http_client.aclose()

    assert result.inserted_count == 2
    assert raw_item_count == 2
    assert source_run is not None
    assert source_run.status == SourceRunStatus.PARTIAL
    assert "discovered feed" in (source_run.error_message or "")


async def test_website_ingestion_uses_known_feed_override(session_factory):
    async with session_factory() as session:
        source = Source(
            source_type=SourceType.WEBSITE,
            title="TechCrunch AI",
            handle_or_url="https://techcrunch.com/category/artificial-intelligence/",
            priority_weight=90,
            is_active=True,
            language="en",
            country_scope="global",
        )
        session.add(source)
        await session.commit()
        source_id = source.id

    http_client = build_http_client(
        {
            "https://techcrunch.com/category/artificial-intelligence/feed/": httpx.Response(200, text=RSS_FEED_XML),
        }
    )
    ingestion_service = IngestionService(session_factory=session_factory, source_registry=build_registry(http_client))

    result = await ingestion_service.ingest_source(source_id)

    async with session_factory() as session:
        raw_item_count = await session.scalar(select(func.count()).select_from(RawItem))
        source_run = await session.scalar(select(SourceRun).where(SourceRun.source_id == source_id))

    await http_client.aclose()

    assert result.status == SourceRunStatus.PARTIAL
    assert result.inserted_count == 2
    assert raw_item_count == 2
    assert source_run is not None
    assert "known feed override" in (source_run.error_message or "")


async def test_ingestion_deduplicates_duplicate_items_within_single_fetch(session_factory):
    async with session_factory() as session:
        source = Source(
            source_type=SourceType.RSS_FEED,
            title="Duplicate Batch Feed",
            handle_or_url="https://example.com/duplicate.xml",
            priority_weight=100,
            is_active=True,
            language="en",
            country_scope="global",
        )
        session.add(source)
        await session.commit()
        source_id = source.id

    ingestion_service = IngestionService(
        session_factory=session_factory,
        source_registry=SourceRegistry({SourceType.RSS_FEED: DuplicateBatchAdapter()}),
    )

    result = await ingestion_service.ingest_source(source_id)

    async with session_factory() as session:
        raw_item_count = await session.scalar(select(func.count()).select_from(RawItem))
        source_run = await session.scalar(select(SourceRun).where(SourceRun.source_id == source_id))

    assert result.status == SourceRunStatus.SUCCESS
    assert result.fetched_count == 2
    assert result.inserted_count == 1
    assert raw_item_count == 1
    assert source_run is not None
    assert source_run.status == SourceRunStatus.SUCCESS
