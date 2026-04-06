from __future__ import annotations

from datetime import UTC, datetime

from sqlalchemy import func, select
from sqlalchemy.orm import selectinload

from app.db.models import (
    Event,
    EventCategory,
    EventSection,
    EventSource,
    EventSourceRole,
    EventTag,
    LlmUsageLog,
    ProcessRun,
    RawItem,
    RawItemStatus,
    Source,
    SourceType,
)
from app.services.events.summary import SummaryBuildResult, SummaryBuilder
from app.services.events.service import ProcessEventsService
from app.services.normalization.service import NormalizationService


def build_source(
    *,
    title: str,
    url: str,
    source_type: SourceType,
    priority_weight: int,
    section_bias: str | None,
) -> Source:
    return Source(
        title=title,
        handle_or_url=url,
        source_type=source_type,
        priority_weight=priority_weight,
        is_active=True,
        language="en",
        country_scope="global",
        section_bias=section_bias,
    )


def build_raw_item(
    *,
    source_id: int,
    source_type: SourceType,
    title: str,
    text: str,
    url: str,
    external_id: str,
    published_at: datetime,
) -> RawItem:
    return RawItem(
        source_id=source_id,
        external_id=external_id,
        source_type=source_type,
        author_name="Author",
        published_at=published_at,
        canonical_url=url,
        raw_title=title,
        raw_text=text,
        raw_payload_json={"url": url, "title": title},
        language="en",
        status=RawItemStatus.FETCHED,
    )


async def test_normalization_extracts_entities_and_links(db_session):
    source = build_source(
        title="OpenAI News",
        url="https://openai.com/news/",
        source_type=SourceType.OFFICIAL_BLOG,
        priority_weight=100,
        section_bias="ai_news|important",
    )
    db_session.add(source)
    await db_session.flush()

    raw_item = build_raw_item(
        source_id=source.id,
        source_type=source.source_type,
        title="<b>OpenAI launches GPT-5</b>",
        text='Read more at https://openai.com/gpt-5 <p>New API for developers</p>',
        url="https://openai.com/news/gpt-5",
        external_id="openai-gpt5",
        published_at=datetime(2026, 3, 25, 9, 0, tzinfo=UTC),
    )

    result = NormalizationService().normalize(raw_item, source)

    assert result.normalized_title == "OpenAI launches GPT-5"
    assert "OpenAI" in result.entities["companies"]
    assert "GPT-5" in result.entities["models"]
    assert "https://openai.com/gpt-5" in result.outbound_links


async def test_process_events_clusters_similar_raw_items_and_selects_primary_source(session_factory):
    async with session_factory() as session:
        openai = build_source(
            title="OpenAI News",
            url="https://openai.com/news/",
            source_type=SourceType.OFFICIAL_BLOG,
            priority_weight=100,
            section_bias="ai_news|important",
        )
        techcrunch = build_source(
            title="TechCrunch AI",
            url="https://techcrunch.com/category/artificial-intelligence/",
            source_type=SourceType.WEBSITE,
            priority_weight=80,
            section_bias="ai_news|investments",
        )
        session.add_all([openai, techcrunch])
        await session.flush()
        session.add_all(
            [
                build_raw_item(
                    source_id=openai.id,
                    source_type=openai.source_type,
                    title="OpenAI launches GPT-5 for developers",
                    text="OpenAI launches GPT-5 with a new API, coding tools, and enterprise features.",
                    url="https://openai.com/news/gpt-5-launch",
                    external_id="gpt5-openai",
                    published_at=datetime(2026, 3, 25, 9, 0, tzinfo=UTC),
                ),
                build_raw_item(
                    source_id=techcrunch.id,
                    source_type=techcrunch.source_type,
                    title="GPT-5 launch gives developers new OpenAI coding tools",
                    text="TechCrunch reports that OpenAI launched GPT-5 and new developer tooling for the API.",
                    url="https://techcrunch.com/2026/03/25/openai-gpt-5-developers/",
                    external_id="gpt5-techcrunch",
                    published_at=datetime(2026, 3, 25, 12, 0, tzinfo=UTC),
                ),
            ]
        )
        await session.commit()

    service = ProcessEventsService(session_factory=session_factory)
    result = await service.process()

    async with session_factory() as session:
        event = await session.scalar(
            select(Event)
            .options(
                selectinload(Event.primary_source),
                selectinload(Event.event_sources).selectinload(EventSource.source),
                selectinload(Event.categories),
                selectinload(Event.tags),
            )
        )
        raw_items = list((await session.scalars(select(RawItem))).all())

    assert result.clustered_count == 2
    assert event is not None
    assert len(event.event_sources) == 2
    assert event.primary_source is None or event.primary_source_id is not None
    primary_links = [link for link in event.event_sources if link.role == EventSourceRole.PRIMARY]
    assert len(primary_links) == 1
    assert primary_links[0].source.title == "OpenAI News"
    assert all(item.status == RawItemStatus.CLUSTERED for item in raw_items)
    assert any(category.section == EventSection.AI_NEWS for category in event.categories)
    assert event.importance_score > 0


async def test_process_events_separates_different_infopovody(session_factory):
    async with session_factory() as session:
        source = build_source(
            title="OpenAI News",
            url="https://openai.com/news/",
            source_type=SourceType.OFFICIAL_BLOG,
            priority_weight=100,
            section_bias="ai_news|important",
        )
        source_two = build_source(
            title="Anthropic News",
            url="https://www.anthropic.com/news",
            source_type=SourceType.OFFICIAL_BLOG,
            priority_weight=100,
            section_bias="ai_news|important",
        )
        session.add_all([source, source_two])
        await session.flush()
        session.add_all(
            [
                build_raw_item(
                    source_id=source.id,
                    source_type=source.source_type,
                    title="OpenAI launches GPT-5 for developers",
                    text="OpenAI launches GPT-5 with API updates and coding tools.",
                    url="https://openai.com/news/gpt-5-launch",
                    external_id="gpt5-openai",
                    published_at=datetime(2026, 3, 25, 9, 0, tzinfo=UTC),
                ),
                build_raw_item(
                    source_id=source_two.id,
                    source_type=source_two.source_type,
                    title="Anthropic raises new strategic funding",
                    text="Anthropic announces a new funding round and strategic partnership.",
                    url="https://www.anthropic.com/news/funding-round",
                    external_id="anthropic-funding",
                    published_at=datetime(2026, 3, 25, 15, 0, tzinfo=UTC),
                ),
            ]
        )
        await session.commit()

    result = await ProcessEventsService(session_factory=session_factory).process()

    async with session_factory() as session:
        event_count = await session.scalar(select(func.count()).select_from(Event))

    assert result.created_events == 2
    assert event_count == 2


async def test_category_assignment_supports_ai_news_coding_and_investments(session_factory):
    async with session_factory() as session:
        sources = [
            build_source(
                title="OpenAI Research",
                url="https://openai.com/news/research/",
                source_type=SourceType.OFFICIAL_BLOG,
                priority_weight=100,
                section_bias="ai_news",
            ),
            build_source(
                title="GitHub Changelog Copilot",
                url="https://github.blog/changelog/label/copilot/",
                source_type=SourceType.WEBSITE,
                priority_weight=95,
                section_bias="coding|ai_news",
            ),
            build_source(
                title="TechCrunch AI",
                url="https://techcrunch.com/category/artificial-intelligence/",
                source_type=SourceType.WEBSITE,
                priority_weight=80,
                section_bias="ai_news|investments",
            ),
        ]
        session.add_all(sources)
        await session.flush()
        session.add_all(
            [
                build_raw_item(
                    source_id=sources[0].id,
                    source_type=sources[0].source_type,
                    title="OpenAI research releases new multimodal model",
                    text="OpenAI research shares a new multimodal model and inference results.",
                    url="https://openai.com/news/research/multimodal-model",
                    external_id="research-model",
                    published_at=datetime(2026, 3, 25, 8, 0, tzinfo=UTC),
                ),
                build_raw_item(
                    source_id=sources[1].id,
                    source_type=sources[1].source_type,
                    title="GitHub Copilot adds CLI agent workflow",
                    text="GitHub adds a new Copilot CLI workflow for coding and developer automation.",
                    url="https://github.blog/changelog/copilot-cli-agent/",
                    external_id="copilot-cli",
                    published_at=datetime(2026, 3, 25, 11, 0, tzinfo=UTC),
                ),
                build_raw_item(
                    source_id=sources[2].id,
                    source_type=sources[2].source_type,
                    title="AI startup raises Series B funding",
                    text="The startup raises Series B funding in a strategic AI investment round.",
                    url="https://techcrunch.com/2026/03/25/ai-series-b/",
                    external_id="ai-series-b",
                    published_at=datetime(2026, 3, 25, 13, 0, tzinfo=UTC),
                ),
            ]
        )
        await session.commit()

    await ProcessEventsService(session_factory=session_factory).process()

    async with session_factory() as session:
        events = list(
            (
                await session.scalars(
                    select(Event)
                    .options(selectinload(Event.categories))
                    .order_by(Event.id.asc())
                )
            ).all()
        )

    sections_per_event = [{category.section for category in event.categories} for event in events]
    assert any(EventSection.AI_NEWS in sections for sections in sections_per_event)
    assert any(EventSection.CODING in sections for sections in sections_per_event)
    assert any(EventSection.INVESTMENTS in sections for sections in sections_per_event)


async def test_process_events_is_idempotent_on_repeated_run(session_factory):
    async with session_factory() as session:
        source = build_source(
            title="OpenAI News",
            url="https://openai.com/news/",
            source_type=SourceType.OFFICIAL_BLOG,
            priority_weight=100,
            section_bias="ai_news|important",
        )
        session.add(source)
        await session.flush()
        session.add(
            build_raw_item(
                source_id=source.id,
                source_type=source.source_type,
                title="OpenAI launches GPT-5 for developers",
                text="OpenAI launches GPT-5 with enterprise and coding support.",
                url="https://openai.com/news/gpt-5-launch",
                external_id="gpt5-openai",
                published_at=datetime(2026, 3, 25, 9, 0, tzinfo=UTC),
            )
        )
        await session.commit()

    service = ProcessEventsService(session_factory=session_factory)
    first = await service.process()
    second = await service.process()

    async with session_factory() as session:
        event_count = await session.scalar(select(func.count()).select_from(Event))
        event_source_count = await session.scalar(select(func.count()).select_from(EventSource))

    assert first.created_events == 1
    assert second.created_events == 0
    assert second.clustered_count == 0
    assert event_count == 1
    assert event_source_count == 1


async def test_process_events_updates_existing_event_without_duplicate_categories(session_factory):
    async with session_factory() as session:
        source = build_source(
            title="OpenAI News",
            url="https://openai.com/news/",
            source_type=SourceType.OFFICIAL_BLOG,
            priority_weight=100,
            section_bias="ai_news|important",
        )
        session.add(source)
        await session.flush()
        session.add(
            build_raw_item(
                source_id=source.id,
                source_type=source.source_type,
                title="OpenAI launches GPT-5 for developers",
                text="OpenAI launches GPT-5 with enterprise and coding support.",
                url="https://openai.com/news/gpt-5-launch",
                external_id="gpt5-openai",
                published_at=datetime(2026, 3, 25, 9, 0, tzinfo=UTC),
            )
        )
        await session.commit()

    service = ProcessEventsService(session_factory=session_factory)
    first = await service.process()

    async with session_factory() as session:
        source = await session.scalar(select(Source).where(Source.title == "OpenAI News"))
        assert source is not None
        session.add(
            build_raw_item(
                source_id=source.id,
                source_type=source.source_type,
                title="OpenAI unveils GPT-5 developer platform",
                text="OpenAI unveils GPT-5 with enterprise and coding tooling for developers.",
                url="https://openai.com/news/gpt-5-launch-followup",
                external_id="gpt5-openai-followup",
                published_at=datetime(2026, 3, 25, 9, 30, tzinfo=UTC),
            )
        )
        await session.commit()

    second = await service.process()

    async with session_factory() as session:
        event_count = await session.scalar(select(func.count()).select_from(Event))
        event_source_count = await session.scalar(select(func.count()).select_from(EventSource))
        category_rows = await session.scalar(select(func.count()).select_from(EventCategory))

    assert first.created_events == 1
    assert second.created_events == 0
    assert second.updated_events == 1
    assert event_count == 1
    assert event_source_count == 2
    assert category_rows >= 1


async def test_summary_builder_fallback_returns_russian_text(session_factory):
    async with session_factory() as session:
        source = build_source(
            title="OpenAI News",
            url="https://openai.com/news/",
            source_type=SourceType.OFFICIAL_BLOG,
            priority_weight=100,
            section_bias="ai_news|important",
        )
        session.add(source)
        await session.flush()
        raw_item = build_raw_item(
            source_id=source.id,
            source_type=source.source_type,
            title="OpenAI launches GPT-5 for developers",
            text="OpenAI launches GPT-5 with enterprise and coding support.",
            url="https://openai.com/news/gpt-5-launch",
            external_id="gpt5-openai",
            published_at=datetime(2026, 3, 25, 9, 0, tzinfo=UTC),
        )
        raw_item.normalized_title = raw_item.raw_title
        raw_item.normalized_text = raw_item.raw_text
        raw_item.status = RawItemStatus.NORMALIZED
        session.add(raw_item)
        await session.commit()

    async with session_factory() as session:
        event = Event(
            event_date=datetime(2026, 3, 25, 9, 0, tzinfo=UTC).date(),
            title="OpenAI launches GPT-5 for developers",
            primary_source_id=source.id,
            primary_source_url="https://openai.com/news/gpt-5-launch",
            importance_score=0,
            market_impact_score=0,
            ai_news_score=0,
            coding_score=0,
            investment_score=0,
            confidence_score=0,
            is_highlight=False,
        )
        event.primary_source = source
        result = await SummaryBuilder().build(event, [raw_item], use_llm=False)

    assert "OpenAI" in result.payload.short_summary
    assert any("\u0400" <= ch <= "\u04FF" for ch in result.payload.short_summary)
    assert result.payload.short_summary.count(".") >= 2
    assert "Инфоповод подтверждает" in result.payload.long_summary


async def test_process_events_uses_async_summary_builder_output(session_factory):
    class StubSummaryBuilder:
        async def build(self, event: Event, raw_items: list[RawItem], *, use_llm: bool = True):
            return SummaryBuildResult(
                payload=type(
                    "StubPayload",
                    (),
                    {
                        "title": "OpenAI запустила GPT-5 для разработчиков",
                        "short_summary": "OpenAI представила GPT-5 и новые инструменты для разработчиков.",
                        "long_summary": "OpenAI представила GPT-5 и обновила набор инструментов для разработчиков и enterprise-клиентов.",
                    },
                )(),
                llm_used=use_llm,
            )

    async with session_factory() as session:
        source = build_source(
            title="OpenAI News",
            url="https://openai.com/news/",
            source_type=SourceType.OFFICIAL_BLOG,
            priority_weight=100,
            section_bias="ai_news|important",
        )
        session.add(source)
        await session.flush()
        session.add(
            build_raw_item(
                source_id=source.id,
                source_type=source.source_type,
                title="OpenAI launches GPT-5 for developers",
                text="OpenAI launches GPT-5 with enterprise and coding support.",
                url="https://openai.com/news/gpt-5-launch",
                external_id="gpt5-openai",
                published_at=datetime(2026, 3, 25, 9, 0, tzinfo=UTC),
            )
        )
        await session.commit()

    service = ProcessEventsService(
        session_factory=session_factory,
        summary_builder=StubSummaryBuilder(),
    )
    await service.process()

    async with session_factory() as session:
        event = await session.scalar(select(Event))

    assert event is not None
    assert event.title == "OpenAI запустила GPT-5 для разработчиков"
    assert event.short_summary == "OpenAI представила GPT-5 и новые инструменты для разработчиков."


async def test_process_events_uses_llm_only_for_shortlist(session_factory):
    llm_calls: list[bool] = []

    class StubSummaryBuilder:
        async def build(self, event: Event, raw_items: list[RawItem], *, use_llm: bool = True):
            llm_calls.append(use_llm)
            return SummaryBuildResult(
                payload=type(
                    "StubPayload",
                    (),
                    {
                        "title": event.title,
                        "short_summary": "Короткое summary.",
                        "long_summary": "Длинное summary.",
                    },
                )(),
                llm_used=use_llm,
            )

    async with session_factory() as session:
        official = build_source(
            title="OpenAI News",
            url="https://openai.com/news/",
            source_type=SourceType.OFFICIAL_BLOG,
            priority_weight=100,
            section_bias="ai_news|important",
        )
        weak = build_source(
            title="Small AI Blog",
            url="https://example.com/blog",
            source_type=SourceType.WEBSITE,
            priority_weight=40,
            section_bias="ai_news",
        )
        session.add_all([official, weak])
        await session.flush()
        session.add_all(
            [
                build_raw_item(
                    source_id=official.id,
                    source_type=official.source_type,
                    title="OpenAI launches GPT-5 for developers",
                    text="OpenAI launches GPT-5 with API updates and coding tools.",
                    url="https://openai.com/news/gpt-5-launch",
                    external_id="gpt5-openai",
                    published_at=datetime(2026, 3, 25, 9, 0, tzinfo=UTC),
                ),
                build_raw_item(
                    source_id=weak.id,
                    source_type=weak.source_type,
                    title="AI blog roundup",
                    text="A small blog roundup about generic AI trends.",
                    url="https://example.com/blog/roundup",
                    external_id="roundup-1",
                    published_at=datetime(2026, 3, 25, 10, 0, tzinfo=UTC),
                ),
            ]
        )
        await session.commit()

    result = await ProcessEventsService(session_factory=session_factory, summary_builder=StubSummaryBuilder()).process()

    async with session_factory() as session:
        process_runs = list((await session.scalars(select(ProcessRun).order_by(ProcessRun.id.asc()))).all())
        llm_logs = list((await session.scalars(select(LlmUsageLog))).all())

    assert result.shortlist_count == 1
    assert result.llm_event_count == 1
    assert llm_calls.count(True) == 1
    assert llm_calls.count(False) == 1
    assert process_runs[-1].shortlist_count == 1
    assert not llm_logs


async def test_process_events_applies_raw_item_shortlist_before_llm(session_factory):
    llm_calls: list[bool] = []

    class StubSummaryBuilder:
        async def build(self, event: Event, raw_items: list[RawItem], *, use_llm: bool = True):
            llm_calls.append(use_llm)
            return SummaryBuildResult(
                payload=type(
                    "StubPayload",
                    (),
                    {
                        "title": event.title,
                        "short_summary": "Короткое summary.",
                        "long_summary": "Длинное summary.",
                    },
                )(),
                llm_used=use_llm,
            )

    async with session_factory() as session:
        source = build_source(
            title="TechCrunch AI",
            url="https://techcrunch.com/category/artificial-intelligence/",
            source_type=SourceType.WEBSITE,
            priority_weight=90,
            section_bias="ai_news|investments",
        )
        session.add(source)
        await session.flush()
        session.add_all(
            [
                build_raw_item(
                    source_id=source.id,
                    source_type=source.source_type,
                    title="Anthropic expands Claude tools for enterprise builders",
                    text="Anthropic expanded Claude tools for enterprise builders with workflow controls, integrations, and rollout guidance.",
                    url="https://techcrunch.com/2026/03/25/anthropic-enterprise-builders/",
                    external_id="strong-item",
                    published_at=datetime(2026, 3, 25, 12, 0, tzinfo=UTC),
                ),
                build_raw_item(
                    source_id=source.id,
                    source_type=source.source_type,
                    title="Update",
                    text="Too weak to justify shortlist processing even though it is fresh.",
                    url="https://techcrunch.com/2026/03/25/weak-update/",
                    external_id="weak-item",
                    published_at=datetime(2026, 3, 25, 12, 30, tzinfo=UTC),
                ),
            ]
        )
        await session.commit()

    result = await ProcessEventsService(
        session_factory=session_factory,
        summary_builder=StubSummaryBuilder(),
    ).process()

    async with session_factory() as session:
        raw_items = list((await session.scalars(select(RawItem).order_by(RawItem.external_id.asc()))).all())
        process_run = await session.scalar(select(ProcessRun).order_by(ProcessRun.id.desc()))
        event_count = await session.scalar(select(func.count()).select_from(Event))

    assert result.raw_shortlist_evaluated_count == 2
    assert result.raw_shortlist_accepted_count == 1
    assert result.raw_shortlist_rejected_count == 1
    assert result.raw_shortlist_reject_breakdown == {"weak_title": 1}
    assert result.created_events == 1
    assert event_count == 1
    assert llm_calls == [True]
    assert raw_items[0].external_id == "strong-item"
    assert raw_items[0].status == RawItemStatus.CLUSTERED
    assert raw_items[1].external_id == "weak-item"
    assert raw_items[1].status == RawItemStatus.DISCARDED
    assert process_run is not None
    assert process_run.raw_shortlist_evaluated_count == 2
    assert process_run.raw_shortlist_accepted_count == 1
    assert process_run.raw_shortlist_rejected_count == 1
    assert process_run.raw_shortlist_reject_breakdown_json == {"weak_title": 1}
