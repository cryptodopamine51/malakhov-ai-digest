from __future__ import annotations

from datetime import UTC, datetime, timedelta

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.db.models import RawItem, RawItemStatus, Source, SourceStatus, SourceType
from app.services.shortlist import RawItemShortlistService


async def _persist_source(session_factory: async_sessionmaker[AsyncSession], **overrides: object) -> Source:
    async with session_factory() as session:
        source = Source(
            source_type=SourceType.WEBSITE,
            title="TechCrunch AI",
            handle_or_url="https://techcrunch.com/category/artificial-intelligence/",
            priority_weight=90,
            is_active=True,
            language="en",
            country_scope="global",
            section_bias="ai_news|investments",
            **overrides,
        )
        session.add(source)
        await session.commit()
        await session.refresh(source)
        return source


async def _persist_raw_item(
    session_factory: async_sessionmaker[AsyncSession],
    *,
    source_id: int,
    title: str,
    text: str,
    url: str,
    published_at: datetime,
    status: RawItemStatus = RawItemStatus.FETCHED,
    external_id: str = "raw-item",
) -> RawItem:
    async with session_factory() as session:
        raw_item = RawItem(
            source_id=source_id,
            external_id=external_id,
            source_type=SourceType.WEBSITE,
            author_name="Author",
            published_at=published_at,
            fetched_at=published_at,
            canonical_url=url,
            raw_title=title,
            raw_text=text,
            raw_payload_json={"url": url, "title": title},
            language="en",
            status=status,
        )
        session.add(raw_item)
        await session.commit()
        await session.refresh(raw_item)
        return raw_item


async def test_raw_item_shortlist_accepts_strong_item(session_factory):
    source = await _persist_source(session_factory)
    raw_item = await _persist_raw_item(
        session_factory,
        source_id=source.id,
        title="OpenAI launches secure agent workflow tooling",
        text="OpenAI launched secure agent workflow tooling with evals, guardrails, and developer controls for production teams.",
        url="https://example.com/openai-secure-agents?utm_source=test",
        published_at=datetime.now(UTC) - timedelta(hours=2),
    )

    async with session_factory() as session:
        hydrated = await session.get(RawItem, raw_item.id, populate_existing=True)
        assert hydrated is not None
        await session.refresh(hydrated, ["source"])
        result = await RawItemShortlistService().evaluate_batch(session=session, raw_items=[hydrated])

    assert result.accepted_count == 1
    assert result.rejected_count == 0
    decision = result.decisions[0]
    assert decision.accepted is True
    assert "passed_source_check" in decision.reasons
    assert "passed_recency_check" in decision.reasons
    assert "passed_quality_gate" in decision.reasons
    assert decision.signals["normalized_url"] == "https://example.com/openai-secure-agents"


async def test_raw_item_shortlist_rejects_stale_item(session_factory):
    source = await _persist_source(session_factory)
    raw_item = await _persist_raw_item(
        session_factory,
        source_id=source.id,
        title="Anthropic updates Claude pricing guidance",
        text="Anthropic updated pricing guidance and API positioning for enterprise buyers.",
        url="https://example.com/anthropic-pricing",
        published_at=datetime(2026, 3, 1, 12, 0, tzinfo=UTC),
    )

    async with session_factory() as session:
        hydrated = await session.get(RawItem, raw_item.id, populate_existing=True)
        assert hydrated is not None
        await session.refresh(hydrated, ["source"])
        result = await RawItemShortlistService().evaluate_batch(session=session, raw_items=[hydrated])

    assert result.rejected_count == 1
    assert result.reject_breakdown["stale_item"] == 1
    assert "stale_item" in result.decisions[0].reasons


async def test_raw_item_shortlist_rejects_duplicate_url(session_factory):
    source = await _persist_source(session_factory)
    published_at = datetime.now(UTC) - timedelta(hours=4)
    existing = await _persist_raw_item(
        session_factory,
        source_id=source.id,
        title="Existing item",
        text="Existing normalized item with enough body text to remain relevant.",
        url="https://example.com/item?id=1&utm_source=rss",
        published_at=published_at,
        status=RawItemStatus.NORMALIZED,
        external_id="existing-item",
    )
    candidate = await _persist_raw_item(
        session_factory,
        source_id=source.id,
        title="Fresh duplicate of existing item",
        text="Fresh duplicate body text with enough detail to be considered if not already seen.",
        url="https://example.com/item?id=1&utm_medium=email",
        published_at=published_at + timedelta(minutes=10),
        external_id="candidate-item",
    )

    async with session_factory() as session:
        raw_item = await session.get(RawItem, candidate.id, populate_existing=True)
        assert raw_item is not None
        await session.refresh(raw_item, ["source"])
        result = await RawItemShortlistService().evaluate_batch(session=session, raw_items=[raw_item])

    assert existing.id != candidate.id
    assert result.rejected_count == 1
    assert result.reject_breakdown["duplicate_url"] == 1
    assert "duplicate_url" in result.decisions[0].reasons


async def test_raw_item_shortlist_rejects_weak_or_empty_title(session_factory):
    source = await _persist_source(session_factory)
    raw_item = await _persist_raw_item(
        session_factory,
        source_id=source.id,
        title="Update",
        text="Useful body text exists here but the headline is too weak to justify spending LLM budget on it.",
        url="https://example.com/weak-title",
        published_at=datetime.now(UTC) - timedelta(hours=3),
    )

    async with session_factory() as session:
        hydrated = await session.get(RawItem, raw_item.id, populate_existing=True)
        assert hydrated is not None
        await session.refresh(hydrated, ["source"])
        result = await RawItemShortlistService().evaluate_batch(session=session, raw_items=[hydrated])

    assert result.rejected_count == 1
    assert result.reject_breakdown["weak_title"] == 1
    assert "weak_title" in result.decisions[0].reasons


async def test_raw_item_shortlist_rejects_insufficient_text(session_factory):
    source = await _persist_source(session_factory)
    raw_item = await _persist_raw_item(
        session_factory,
        source_id=source.id,
        title="NVIDIA expands inference stack for production AI teams",
        text="Tiny blurb.",
        url="https://example.com/short-text",
        published_at=datetime.now(UTC) - timedelta(hours=1),
    )

    async with session_factory() as session:
        hydrated = await session.get(RawItem, raw_item.id, populate_existing=True)
        assert hydrated is not None
        await session.refresh(hydrated, ["source"])
        result = await RawItemShortlistService().evaluate_batch(session=session, raw_items=[hydrated])

    assert result.rejected_count == 1
    assert result.reject_breakdown["insufficient_text"] == 1
    assert "insufficient_text" in result.decisions[0].reasons


async def test_raw_item_shortlist_rejects_non_effectively_active_source(session_factory):
    source = await _persist_source(session_factory, status=SourceStatus.QUARANTINE)
    raw_item = await _persist_raw_item(
        session_factory,
        source_id=source.id,
        title="Meta ships a new multimodal API stack",
        text="Meta shipped a multimodal API stack with enough detail for a strong item, but the source is quarantined.",
        url="https://example.com/meta-api-stack",
        published_at=datetime.now(UTC) - timedelta(hours=2),
    )

    async with session_factory() as session:
        hydrated = await session.get(RawItem, raw_item.id, populate_existing=True)
        assert hydrated is not None
        await session.refresh(hydrated, ["source"])
        result = await RawItemShortlistService().evaluate_batch(session=session, raw_items=[hydrated])

    assert result.rejected_count == 1
    assert result.reject_breakdown["source_not_effectively_active"] == 1
    assert "source_not_effectively_active" in result.decisions[0].reasons
