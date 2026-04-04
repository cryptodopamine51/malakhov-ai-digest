from __future__ import annotations

from datetime import UTC, datetime

from app.db.models import Event, EventCategory, EventSection, RawItem, RawItemStatus, Source, SourceType
from app.services.editorial import get_ru_editorial_policy
from app.services.events.summary import SummaryBuilder


def _build_source() -> Source:
    return Source(
        title="OpenAI News",
        handle_or_url="https://openai.com/news/",
        source_type=SourceType.OFFICIAL_BLOG,
        priority_weight=100,
        is_active=True,
        language="en",
        country_scope="global",
        section_bias="ai_news|important",
    )


def _build_event(source: Source) -> Event:
    event = Event(
        event_date=datetime(2026, 3, 25, 9, 0, tzinfo=UTC).date(),
        title="OpenAI launches GPT-5 for developers",
        primary_source_id=1,
        primary_source_url="https://openai.com/news/gpt-5-launch",
        importance_score=78,
        market_impact_score=70,
        ai_news_score=88,
        coding_score=60,
        investment_score=5,
        confidence_score=84,
        ranking_score=82,
        supporting_source_count=0,
        verification_source_count=1,
        has_verification_source=True,
        is_highlight=True,
    )
    event.primary_source = source
    event.categories = [
        EventCategory(section=EventSection.AI_NEWS, score=0.92, is_primary_section=True),
    ]
    return event


def _build_raw_item(source: Source) -> RawItem:
    item = RawItem(
        source_id=1,
        external_id="gpt5-openai",
        source_type=source.source_type,
        author_name="Author",
        published_at=datetime(2026, 3, 25, 9, 0, tzinfo=UTC),
        canonical_url="https://openai.com/news/gpt-5-launch",
        raw_title="OpenAI launches GPT-5 for developers",
        raw_text="OpenAI launches GPT-5 with a new API, coding tools, and enterprise rollout for developers.",
        raw_payload_json={"title": "OpenAI launches GPT-5 for developers"},
        language="en",
        status=RawItemStatus.CLUSTERED,
        entities_json={"companies": ["OpenAI"], "models": ["GPT-5"], "products": ["API"]},
    )
    item.source = source
    return item


async def test_rule_based_summary_defaults_to_russian_and_preserves_terms():
    source = _build_source()
    event = _build_event(source)
    raw_item = _build_raw_item(source)

    result = await SummaryBuilder().build(event, [raw_item], use_llm=False)

    assert "OpenAI" in result.payload.title
    assert "GPT-5" in result.payload.title
    assert any("\u0400" <= ch <= "\u04FF" for ch in result.payload.short_summary)
    assert result.payload.short_summary.count(".") >= 2


def test_editorial_policy_reduces_obvious_english_leakage():
    policy = get_ru_editorial_policy()
    source = _build_source()
    event = _build_event(source)
    raw_item = _build_raw_item(source)

    editorialized = policy.editorialize_payload(
        event=event,
        raw_items=[raw_item],
        title="OpenAI launches GPT-5 for developers",
        short_summary="OpenAI launches GPT-5 with new API tools. It matters for developer workflows.",
        long_summary="OpenAI launches GPT-5 with an enterprise rollout and benchmark improvements.",
    )

    assert "OpenAI" in editorialized.title
    assert "GPT-5" in editorialized.title
    assert "It matters" not in editorialized.short_summary
    assert "developer workflows" not in editorialized.short_summary
    assert "это позволяет" not in editorialized.short_summary.lower()
    assert "это может" not in editorialized.short_summary.lower()
    assert "данное" not in editorialized.short_summary.lower()
    assert any("\u0400" <= ch <= "\u04FF" for ch in editorialized.short_summary)
    assert editorialized.short_summary.count(".") >= 2


def test_editorial_policy_removes_ai_like_patterns_and_adds_concrete_implication():
    policy = get_ru_editorial_policy()
    source = _build_source()
    event = _build_event(source)
    raw_item = _build_raw_item(source)

    editorialized = policy.editorialize_payload(
        event=event,
        raw_items=[raw_item],
        title="OpenAI launches GPT-5 for developers",
        short_summary="Данное обновление позволяет ускорить разработку. Это может повлиять на рынок.",
        long_summary="OpenAI launches GPT-5. It matters for enterprise competition.",
    )

    text = f"{editorialized.short_summary} {editorialized.long_summary}".lower()
    assert "данное" not in text
    assert "это может" not in text
    assert "это позволяет" not in text
    assert "рын" in text or "конкур" in text or "бизнес" in text


def test_editorial_policy_inspection_exposes_ru_bias():
    policy = get_ru_editorial_policy()
    analysis = policy.inspect_text("OpenAI представила GPT-5 для разработчиков.")

    assert analysis.language_default == "ru"
    assert analysis.has_cyrillic is True
    assert "OpenAI" in analysis.preserved_terms


def test_editorial_policy_adds_hook_to_first_sentence_for_product_article():
    policy = get_ru_editorial_policy()

    summary = policy.public_summary(
        "OpenAI launches GPT-5 for developers. It matters for enterprise competition.",
        title="OpenAI launches GPT-5 for developers",
        section="ai_news",
    )

    first_sentence = summary.split(".")[0]
    assert "OpenAI запускает GPT-5" in first_sentence
    assert any(
        marker in first_sentence
        for marker in (
            "Гонка за рынок",
            "Конкуренция за клиентов",
            "Рынок быстрее",
            "Рынок быстро",
            "Расстановка сил",
        )
    )


def test_editorial_policy_uses_pressure_hook_for_regulation_like_opening():
    policy = get_ru_editorial_policy()

    summary = policy.public_summary(
        "Минцифры вводит новые требования к AI-сервисам. Это влияет на корпоративные бюджеты.",
        title="Минцифры вводит новые требования к AI-сервисам",
        section="russia",
    )

    first_sentence = summary.split(".")[0]
    assert "Минцифры вводит новые требования" in first_sentence
    assert any(
        marker in first_sentence
        for marker in (
            "Давление на компании усиливается",
            "Правила для рынка становятся жестче",
            "Игроки получают новый источник давления",
        )
    )


def test_editorial_policy_uses_acceleration_hook_for_tools_opening():
    policy = get_ru_editorial_policy()

    summary = policy.public_summary(
        "GitHub Copilot adds CLI workflow for developers. It matters for developer workflows.",
        title="GitHub Copilot adds CLI workflow for developers",
        section="coding",
    )

    first_sentence = summary.split(".")[0]
    assert "GitHub Copilot добавляет CLI" in first_sentence
    assert any(
        marker in first_sentence
        for marker in (
            "Темп внедрения растет",
            "Команды ускоряют переход в прод",
            "Рынок быстрее меняет рабочий стек",
        )
    )
