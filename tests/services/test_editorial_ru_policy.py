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


def test_article_builder_creates_connected_d2_text_without_ui_labels():
    policy = get_ru_editorial_policy()

    article = policy.build_article(
        title="OpenAI launches GPT-5 for developers",
        short_summary="OpenAI launches GPT-5 for developers. It matters for enterprise competition.",
        long_summary="OpenAI launches GPT-5 for developers with new API tools and enterprise rollout.",
        section="ai_news",
        primary_source_title="OpenAI News",
        categories=["ai_news", "important"],
        tags=["OpenAI", "GPT-5"],
        supporting_source_count=1,
        source_documents=[
            {
                "role": "primary",
                "source_title": "OpenAI News",
                "title": "OpenAI launches GPT-5 for developers",
                "text": (
                    "OpenAI launches GPT-5 for developers with a new API and enterprise controls. "
                    "The company said the rollout covers coding workflows and larger corporate deployments. "
                    "For the market this raises pressure on competing platforms."
                ),
                "entities": {"companies": ["OpenAI"], "models": ["GPT-5"], "products": ["API"]},
            },
            {
                "role": "supporting",
                "source_title": "Industry Media",
                "title": "Analysts react to GPT-5 launch",
                "text": (
                    "Analysts say the launch resets expectations for developer tooling. "
                    "Competitors now have to answer on price, capability, and enterprise support."
                ),
                "entities": {"companies": ["OpenAI"], "products": ["developer tooling"]},
            },
        ],
    )

    assert article.depth == "D2"
    assert len(article.paragraphs) >= 3
    text = " ".join(article.paragraphs).lower()
    assert "почему это важно" not in text
    assert "что это меняет" not in text
    assert "кто выигрывает" not in text
    assert "это может" not in text
    assert "в ai" not in text
    assert "openai запускает gpt-5 openai запускает gpt-5" not in text
    assert "это важно для" not in text
    assert "история важна не только" not in text
    assert "смысл события шире" not in text
    assert "сделала ход, после которого" not in text
    assert sum(paragraph.count(".") for paragraph in article.paragraphs) >= 5
    assert len(article.paragraphs) == 3
    assert article.mode in {"straight_news", "product_deepening", "market_move"}


def test_article_builder_uses_source_pack_to_raise_depth():
    policy = get_ru_editorial_policy()

    article = policy.build_article(
        title="Anthropic launches new enterprise controls",
        short_summary="Anthropic launches new enterprise controls for Claude.",
        long_summary="The company expands its enterprise product and signs new cloud partnerships.",
        section="important",
        primary_source_title="Anthropic",
        categories=["important"],
        tags=["Anthropic", "Claude"],
        supporting_source_count=2,
        source_documents=[
            {
                "role": "primary",
                "source_title": "Anthropic",
                "title": "Anthropic expands Claude enterprise stack",
                "text": (
                    "Anthropic introduced new enterprise controls for Claude and expanded admin tooling. "
                    "The release adds security controls, procurement features, and deployment options for 250 enterprise teams. "
                    "The company said the update is aimed at regulated customers and faster procurement cycles."
                ),
                "entities": {"companies": ["Anthropic"], "products": ["Claude"]},
            },
            {
                "role": "supporting",
                "source_title": "Cloud Partner",
                "title": "Partner backs rollout",
                "text": (
                    "A cloud partner said the rollout will accelerate migrations from smaller model vendors. "
                    "The partnership also changes pricing pressure for enterprise AI contracts and sets a 30 day migration target."
                ),
                "entities": {"companies": ["Anthropic"]},
            },
            {
                "role": "reaction",
                "source_title": "Market Analysis",
                "title": "Analysts react",
                "text": (
                    "Analysts said the move broadens Anthropic's position in enterprise procurement. "
                    "One note framed it this way: \"buyers now compare Claude not only on model quality but on compliance and control\". "
                    "In the market, buyers now compare Claude not only on model quality but on compliance and control."
                ),
                "entities": {"companies": ["Anthropic"], "products": ["Claude"]},
            },
        ],
    )

    assert article.depth in {"D3", "D4"}
    assert len(article.paragraphs) >= 5
    assert article.source_pack.richness_score >= 7.8
    assert "multi_source" in article.source_pack.signals
    assert article.source_pack.quotes
    assert article.source_pack.numbers
    assert article.mode in {"quote_led", "market_move", "product_deepening", "regulation_impact"}
    assert article.source_pack.details
    assert any(unit.kind in {"number", "competitive_signal", "infrastructure_signal", "regulation_signal"} for unit in article.source_pack.evidence_units)


def test_article_builder_uses_d4_only_for_clearly_rich_source_pack():
    policy = get_ru_editorial_policy()

    article = policy.build_article(
        title="NVIDIA expands sovereign AI program",
        short_summary="NVIDIA expands sovereign AI work with new regional partners.",
        long_summary="The company adds infrastructure, partnerships and procurement support across multiple regions.",
        section="important",
        primary_source_title="NVIDIA Newsroom",
        categories=["important"],
        tags=["NVIDIA"],
        supporting_source_count=3,
        source_documents=[
            {
                "role": "primary",
                "source_title": "NVIDIA Newsroom",
                "title": "NVIDIA expands sovereign AI program",
                "text": (
                    "NVIDIA expanded its sovereign AI program with new regional infrastructure and procurement support. "
                    "The company said the package covers 12 countries, 3 new cloud partners and a broader services layer. "
                    "Executives said demand is now shifting from pilots to national-scale compute planning."
                ),
                "entities": {"companies": ["NVIDIA"]},
            },
            {
                "role": "supporting",
                "source_title": "Partner Statement",
                "title": "Regional partner backs expansion",
                "text": (
                    "A regional partner said the new framework shortens procurement cycles and lowers infrastructure risk. "
                    "The statement described the move as \"a transition from experimentation to capacity planning\"."
                ),
                "entities": {"companies": ["NVIDIA"]},
            },
            {
                "role": "reaction",
                "source_title": "Market Analysis",
                "title": "Why this matters now",
                "text": (
                    "Analysts said the shift matters because infrastructure winners can now lock in budgets before model demand fully matures. "
                    "One market note said: \"the real contest is moving from model demos to control of the compute base\"."
                ),
                "entities": {"companies": ["NVIDIA"]},
            },
            {
                "role": "supporting",
                "source_title": "Industry Coverage",
                "title": "Regional AI stacks get funding",
                "text": (
                    "Industry coverage noted that budgets above 1.5 billion are now being discussed across several regions. "
                    "That changes the conversation from experimentation to long-cycle infrastructure investment."
                ),
                "entities": {"companies": ["NVIDIA"]},
            },
        ],
    )

    assert article.depth == "D4"
    assert len(article.paragraphs) >= 6
    assert article.mode in {"quote_led", "market_move"}
    assert article.source_pack.disagreements


def test_clean_generated_article_removes_title_repeat_and_english_tail():
    policy = get_ru_editorial_policy()

    cleaned = policy.clean_generated_article(
        "Почему это важно: OpenAI запускает GPT-5 для разработчиков. OpenAI запускает GPT-5 для разработчиков. Это может повлиять на рынок в AI.",
        title="OpenAI запускает GPT-5 для разработчиков",
    )

    assert cleaned.count("OpenAI запускает GPT-5 для разработчиков") <= 1
    assert "это может" not in cleaned.lower()
    assert "в ai" not in cleaned.lower()
    assert "почему это важно" not in cleaned.lower()
    assert "это важно для" not in cleaned.lower()
    assert "смысл события шире" not in cleaned.lower()


def test_article_modes_vary_across_story_types():
    policy = get_ru_editorial_policy()

    straight = policy.build_article(
        title="Mistral ships new OCR API",
        short_summary="Mistral shipped a new OCR API for document processing.",
        long_summary="The company added OCR to its product line for developers and enterprise teams.",
        section="ai_news",
        primary_source_title="Mistral",
        categories=["ai_news"],
        tags=["Mistral", "API"],
        supporting_source_count=0,
        source_documents=[
            {
                "role": "primary",
                "source_title": "Mistral",
                "title": "Mistral ships new OCR API",
                "text": "Mistral shipped a new OCR API for document processing and enterprise workflows. The release adds a direct document parsing layer for product teams.",
                "entities": {"companies": ["Mistral"], "products": ["API"]},
            }
        ],
    )
    regulation = policy.build_article(
        title="EU sets new AI transparency rules",
        short_summary="The EU set new transparency rules for AI systems.",
        long_summary="The package introduces reporting and compliance obligations for providers.",
        section="important",
        primary_source_title="EU Commission",
        categories=["important"],
        tags=["EU"],
        supporting_source_count=1,
        source_documents=[
            {
                "role": "primary",
                "source_title": "EU Commission",
                "title": "EU sets new AI transparency rules",
                "text": "The EU introduced new transparency obligations for AI providers and deployment teams. The package adds reporting, documentation, and enforcement timelines.",
                "entities": {"organizations": ["EU"]},
            },
            {
                "role": "supporting",
                "source_title": "Policy Note",
                "title": "Compliance pressure rises",
                "text": "Policy analysts said providers now face a shorter adaptation window and higher compliance costs.",
                "entities": {"organizations": ["EU"]},
            },
        ],
    )
    quote_led = policy.build_article(
        title="Databricks expands lakehouse AI controls",
        short_summary="Databricks expanded AI controls in its enterprise stack.",
        long_summary="The company added governance and deployment controls across its platform.",
        section="important",
        primary_source_title="Databricks",
        categories=["important"],
        tags=["Databricks"],
        supporting_source_count=2,
        source_documents=[
            {
                "role": "primary",
                "source_title": "Databricks",
                "title": "Databricks expands lakehouse AI controls",
                "text": "Databricks expanded governance and deployment controls across its AI stack. Executives described the shift this way: \"customers want fewer demos and more operating discipline\".",
                "entities": {"companies": ["Databricks"]},
            },
            {
                "role": "reaction",
                "source_title": "Analyst Note",
                "title": "Enterprise buyers change priorities",
                "text": "Analysts said enterprise buyers now compare platforms on control, governance, and rollout discipline.",
                "entities": {"companies": ["Databricks"]},
            },
        ],
    )

    assert len({straight.mode, regulation.mode, quote_led.mode}) >= 3


def test_article_opening_can_be_fact_led_without_synthetic_hook():
    policy = get_ru_editorial_policy()

    article = policy.build_article(
        title="OpenAI launches GPT-5 for developers",
        short_summary="OpenAI launches GPT-5 for developers.",
        long_summary="The company expands its API and deployment controls.",
        section="ai_news",
        primary_source_title="OpenAI News",
        categories=["ai_news"],
        tags=["OpenAI", "GPT-5"],
        supporting_source_count=0,
        source_documents=[
            {
                "role": "primary",
                "source_title": "OpenAI News",
                "title": "OpenAI launches GPT-5 for developers",
                "text": "OpenAI launched GPT-5 for developers with new API and deployment controls. The update focuses on developer workflows and larger enterprise rollouts.",
                "entities": {"companies": ["OpenAI"], "models": ["GPT-5"]},
            }
        ],
    )

    opening = article.paragraphs[0].lower()
    assert opening.startswith("openai ") or opening.startswith("openai")
    assert "гонка за рынок" not in opening
    assert "рынок быстрее меняет" not in opening
    assert "сделала ход, после которого" not in opening
    assert "на рынке появился заметный новый сдвиг" not in opening
    assert "фокус быстро смещается" not in opening


def test_english_heavy_source_is_rewritten_more_naturally_in_russian():
    policy = get_ru_editorial_policy()

    article = policy.build_article(
        title="GitHub Copilot adds CLI workflow",
        short_summary="GitHub added a Copilot CLI flow for builders.",
        long_summary="GitHub added a Copilot CLI flow for developer automation.",
        section="coding",
        primary_source_title="GitHub Changelog Copilot",
        categories=["coding", "ai_news"],
        tags=["GitHub Copilot", "CLI"],
        supporting_source_count=1,
        source_documents=[
            {
                "role": "primary",
                "source_title": "GitHub Changelog Copilot",
                "title": "GitHub Copilot adds CLI workflow",
                "text": "GitHub added a Copilot CLI workflow that brings assistant actions into terminal tasks. The release is aimed at teams that want faster scripting and execution loops.",
                "entities": {"companies": ["GitHub"], "products": ["GitHub Copilot", "CLI"]},
            }
        ],
    )

    text = " ".join(article.paragraphs).lower()
    assert "в ai" not in text
    assert "это помогает понять" not in text
    assert "это позволяет" not in text


def test_vague_openers_are_banned_and_en_numbers_are_normalized():
    policy = get_ru_editorial_policy()

    cleaned = policy.clean_generated_article(
        "На рынке появился заметный новый сдвиг. В центре обсуждения оказались 500 million и EU rules.",
        title="Perplexity привлекает новый раунд финансирования",
    )

    lowered = cleaned.lower()
    assert "на рынке появился заметный новый сдвиг" not in lowered
    assert "в центре обсуждения оказались" not in lowered
    assert "$500 млн" in cleaned or "$500 млн" in policy._de_aiify_text("500 million")
    assert "ЕС" in policy._de_aiify_text("EU rules")


def test_quote_led_mode_can_paraphrase_english_quote():
    policy = get_ru_editorial_policy()

    article = policy.build_article(
        title="Databricks expands enterprise controls",
        short_summary="Databricks expanded enterprise controls.",
        long_summary="The company updated deployment and governance layers across its platform.",
        section="important",
        primary_source_title="Databricks",
        categories=["important"],
        tags=["Databricks"],
        supporting_source_count=2,
        source_documents=[
            {
                "role": "primary",
                "source_title": "Databricks",
                "title": "Databricks expands enterprise controls",
                "text": (
                    "Databricks expanded governance and deployment controls across its platform. "
                    "Executives described the shift this way: \"customers want fewer demos and more operating discipline\"."
                ),
                "entities": {"companies": ["Databricks"]},
            },
            {
                "role": "reaction",
                "source_title": "Analyst Note",
                "title": "Enterprise buyers change priorities",
                "text": "Analysts said enterprise buyers now compare platforms on control, governance, and rollout discipline.",
                "entities": {"companies": ["Databricks"]},
            },
        ],
    )

    text = " ".join(article.paragraphs).lower()
    assert "customers want fewer demos" not in text
    assert "operating discipline" not in text
    assert "демонстрац" in text or "управлен" in text


def test_d3_article_has_more_evidence_density_than_d2():
    policy = get_ru_editorial_policy()

    d2 = policy.build_article(
        title="Mistral ships new OCR API",
        short_summary="Mistral shipped a new OCR API for document processing.",
        long_summary="The company added OCR to its product line.",
        section="ai_news",
        primary_source_title="Mistral",
        categories=["ai_news"],
        tags=["Mistral", "API"],
        supporting_source_count=0,
        source_documents=[
            {
                "role": "primary",
                "source_title": "Mistral",
                "title": "Mistral ships new OCR API",
                "text": "Mistral shipped a new OCR API for document processing. The release adds a direct document parsing layer for product teams.",
                "entities": {"companies": ["Mistral"], "products": ["API"]},
            }
        ],
    )
    d3 = policy.build_article(
        title="Anthropic launches new enterprise controls",
        short_summary="Anthropic launches new enterprise controls for Claude.",
        long_summary="The company expands its enterprise product and signs new cloud partnerships.",
        section="important",
        primary_source_title="Anthropic",
        categories=["important"],
        tags=["Anthropic", "Claude"],
        supporting_source_count=2,
        source_documents=[
            {
                "role": "primary",
                "source_title": "Anthropic",
                "title": "Anthropic expands Claude enterprise stack",
                "text": (
                    "Anthropic introduced new enterprise controls for Claude and expanded admin tooling. "
                    "The release adds security controls, procurement features, and deployment options for 250 enterprise teams. "
                    "The company said the update is aimed at regulated customers and faster procurement cycles."
                ),
                "entities": {"companies": ["Anthropic"], "products": ["Claude"]},
            },
            {
                "role": "supporting",
                "source_title": "Cloud Partner",
                "title": "Partner backs rollout",
                "text": (
                    "A cloud partner said the rollout will accelerate migrations from smaller model vendors. "
                    "The partnership also changes pricing pressure for enterprise AI contracts and sets a 30 day migration target."
                ),
                "entities": {"companies": ["Anthropic"]},
            },
            {
                "role": "reaction",
                "source_title": "Market Analysis",
                "title": "Analysts react",
                "text": (
                    "Analysts said the move broadens Anthropic's position in enterprise procurement. "
                    "One note framed it this way: \"buyers now compare Claude not only on model quality but on compliance and control\"."
                ),
                "entities": {"companies": ["Anthropic"], "products": ["Claude"]},
            },
        ],
    )

    assert d2.depth == "D2"
    assert d3.depth in {"D3", "D4"}
    assert len(d3.paragraphs) > len(d2.paragraphs)
    assert len(d3.source_pack.details) >= len(d2.source_pack.details)


def test_number_normalization_handles_money_percent_and_quarter():
    policy = get_ru_editorial_policy()

    assert policy._normalize_number_token("500 million") == "$500 млн"
    assert policy._normalize_number_token("30 percent") == "30%"
    assert policy._normalize_number_token("Q2 2026") == "второй квартал 2026 года"


def test_source_differences_enrich_article():
    policy = get_ru_editorial_policy()

    article = policy.build_article(
        title="Scale AI raises new round",
        short_summary="Scale AI raised a new funding round.",
        long_summary="The company secured new capital and drew analyst reaction.",
        section="investments",
        primary_source_title="Scale AI",
        categories=["investments"],
        tags=["Scale AI"],
        supporting_source_count=2,
        source_documents=[
            {
                "role": "primary",
                "source_title": "Scale AI",
                "title": "Scale AI raises new round",
                "text": "Scale AI raised 500 million in a new funding round. The company said the money will support enterprise sales and product hiring in Q2 2026.",
                "entities": {"companies": ["Scale AI"]},
            },
            {
                "role": "supporting",
                "source_title": "Market Coverage",
                "title": "Investors see pricing pressure",
                "text": "Coverage noted that the round changes pricing pressure for neighboring infrastructure vendors and puts new focus on procurement discipline.",
                "entities": {"companies": ["Scale AI"]},
            },
            {
                "role": "reaction",
                "source_title": "Analyst Note",
                "title": "Analysts disagree on impact",
                "text": "Analysts said the round strengthens distribution, while another note warned that margins will stay under pressure even after the raise.",
                "entities": {"companies": ["Scale AI"]},
            },
        ],
    )

    joined = " ".join(article.paragraphs).lower()
    assert article.source_pack.disagreements
    assert "$500 млн" in joined
    assert "давлен" in joined or "марж" in joined or "закуп" in joined


def test_article_paragraphs_carry_specific_content_and_specific_conclusion():
    policy = get_ru_editorial_policy()

    article = policy.build_article(
        title="Perplexity raises new funding round",
        short_summary="Perplexity raised a new funding round.",
        long_summary="The company secured new capital as investor interest in answer engines grows.",
        section="investments",
        primary_source_title="Perplexity",
        categories=["investments"],
        tags=["Perplexity"],
        supporting_source_count=1,
        source_documents=[
            {
                "role": "primary",
                "source_title": "Perplexity",
                "title": "Perplexity raises new funding round",
                "text": (
                    "Perplexity raised 500 million in a new funding round as investors backed its expansion in answer engines. "
                    "The round gives the company more room for distribution deals and product hiring."
                ),
                "entities": {"companies": ["Perplexity"]},
            },
            {
                "role": "supporting",
                "source_title": "Market Note",
                "title": "Funding pressures rivals",
                "text": "Analysts said the round raises pressure on rivals that still depend on smaller balance sheets.",
                "entities": {"companies": ["Perplexity"]},
            },
        ],
    )

    assert len(article.paragraphs) == 3
    for paragraph in article.paragraphs:
        lowered = paragraph.lower()
        assert any(token in lowered for token in ("perplexity", "$500", "инвест", "контракт", "цена", "закуп", "релиз", "платформ"))
    ending = article.paragraphs[-1].lower()
    assert "усилит конкуренцию" not in ending
    assert any(token in ending for token in ("цен", "релиз", "контур", "закуп", "платформ"))
