from __future__ import annotations

import asyncio
from dataclasses import dataclass
from datetime import date, datetime, time, timezone
from typing import Final

from sqlalchemy import delete, select

from app.db.models import (
    AlphaEntry,
    AlphaEntryStatus,
    DigestIssue,
    DigestIssueType,
    Event,
    EventCategory,
    EventSection,
    EventSource,
    EventSourceRole,
    EventTag,
    EventTagType,
    RawItem,
    RawItemStatus,
    Source,
    SourceRegion,
    SourceRole,
    SourceType,
)
from app.db.session import AsyncSessionLocal
from app.services.digest import DigestBuilderService

DEMO_BASE_URL: Final[str] = "https://demo-content.news.malakhovai.ru/"
TARGET_DATES: Final[tuple[date, ...]] = (
    date(2026, 4, 3),
    date(2026, 4, 4),
    date(2026, 4, 5),
    date(2026, 4, 6),
)


@dataclass(frozen=True)
class SourceSeed:
    key: str
    title: str
    handle_or_url: str
    source_type: SourceType
    priority_weight: int
    language: str
    country_scope: str
    section_bias: str
    role: SourceRole = SourceRole.SIGNAL_FEEDER
    region: SourceRegion = SourceRegion.GLOBAL
    editorial_priority: int = 100
    noise_score: float = 0.0


@dataclass(frozen=True)
class DocumentSeed:
    source_key: str
    role: EventSourceRole
    slug: str
    title: str
    text: str
    hour: int
    entities: dict[str, object] | None = None


@dataclass(frozen=True)
class EventSeed:
    slug: str
    event_date: date
    title: str
    short_summary: str
    long_summary: str
    primary_source_key: str
    primary_source_slug: str
    importance_score: float
    market_impact_score: float
    ai_news_score: float
    coding_score: float
    investment_score: float
    confidence_score: float
    ranking_score: float
    is_highlight: bool
    categories: tuple[tuple[EventSection, float, bool], ...]
    tags: tuple[tuple[str, EventTagType], ...]
    documents: tuple[DocumentSeed, ...]
    score_components_json: dict[str, object] | None = None


SOURCE_SEEDS: Final[tuple[SourceSeed, ...]] = (
    SourceSeed(
        key="openai",
        title="OpenAI Blog",
        handle_or_url=f"{DEMO_BASE_URL}sources/openai",
        source_type=SourceType.OFFICIAL_BLOG,
        priority_weight=100,
        language="en",
        country_scope="global",
        section_bias="important|ai_news",
    ),
    SourceSeed(
        key="mistral",
        title="Mistral Blog",
        handle_or_url=f"{DEMO_BASE_URL}sources/mistral",
        source_type=SourceType.OFFICIAL_BLOG,
        priority_weight=92,
        language="en",
        country_scope="global",
        section_bias="ai_news",
    ),
    SourceSeed(
        key="mincifry",
        title="Минцифры России",
        handle_or_url=f"{DEMO_BASE_URL}sources/mincifry",
        source_type=SourceType.WEBSITE,
        priority_weight=96,
        language="ru",
        country_scope="russia",
        section_bias="important|ai_news",
        role=SourceRole.RUSSIA,
        region=SourceRegion.RUSSIA,
    ),
    SourceSeed(
        key="perplexity",
        title="Perplexity Blog",
        handle_or_url=f"{DEMO_BASE_URL}sources/perplexity",
        source_type=SourceType.OFFICIAL_BLOG,
        priority_weight=91,
        language="en",
        country_scope="global",
        section_bias="investments|ai_news",
        role=SourceRole.INVESTMENTS,
    ),
    SourceSeed(
        key="yandex",
        title="Yandex Cloud Blog",
        handle_or_url=f"{DEMO_BASE_URL}sources/yandex-cloud",
        source_type=SourceType.OFFICIAL_BLOG,
        priority_weight=90,
        language="ru",
        country_scope="russia",
        section_bias="coding|ai_news",
        role=SourceRole.RUSSIA,
        region=SourceRegion.RUSSIA,
    ),
    SourceSeed(
        key="anthropic",
        title="Anthropic Newsroom",
        handle_or_url=f"{DEMO_BASE_URL}sources/anthropic",
        source_type=SourceType.OFFICIAL_BLOG,
        priority_weight=89,
        language="en",
        country_scope="global",
        section_bias="ai_news|important",
    ),
    SourceSeed(
        key="eu",
        title="Европейская комиссия",
        handle_or_url=f"{DEMO_BASE_URL}sources/eu-commission",
        source_type=SourceType.WEBSITE,
        priority_weight=95,
        language="en",
        country_scope="global",
        section_bias="important|ai_news",
        role=SourceRole.VERIFICATION,
    ),
    SourceSeed(
        key="github",
        title="GitHub Changelog",
        handle_or_url=f"{DEMO_BASE_URL}sources/github",
        source_type=SourceType.WEBSITE,
        priority_weight=88,
        language="en",
        country_scope="global",
        section_bias="coding|ai_news",
        role=SourceRole.CODING,
    ),
    SourceSeed(
        key="nvidia",
        title="NVIDIA Blog",
        handle_or_url=f"{DEMO_BASE_URL}sources/nvidia",
        source_type=SourceType.OFFICIAL_BLOG,
        priority_weight=93,
        language="en",
        country_scope="global",
        section_bias="important|ai_news",
    ),
    SourceSeed(
        key="tbank",
        title="Т-Банк Технологии",
        handle_or_url=f"{DEMO_BASE_URL}sources/tbank",
        source_type=SourceType.OFFICIAL_BLOG,
        priority_weight=86,
        language="ru",
        country_scope="russia",
        section_bias="ai_news",
        role=SourceRole.RUSSIA,
        region=SourceRegion.RUSSIA,
    ),
)


EVENT_SEEDS: Final[tuple[EventSeed, ...]] = (
    EventSeed(
        slug="github-copilot-review-cli",
        event_date=date(2026, 4, 3),
        title="GitHub Copilot получил режим ревью в CLI",
        short_summary="GitHub добавил в Copilot CLI режим проверки изменений до отправки pull request.",
        long_summary="Новый сценарий сводит в одну цепочку подготовку диффа, запуск ревью и комментарии по коду, поэтому команды могут быстрее закрывать рутинную часть перед релизом.",
        primary_source_key="github",
        primary_source_slug="copilot-review-cli",
        importance_score=71,
        market_impact_score=54,
        ai_news_score=58,
        coding_score=94,
        investment_score=6,
        confidence_score=82,
        ranking_score=84,
        is_highlight=False,
        categories=((EventSection.CODING, 0.96, True), (EventSection.AI_NEWS, 0.62, False)),
        tags=(("GitHub", EventTagType.ENTITY), ("Copilot", EventTagType.TECH), ("разработка", EventTagType.THEME)),
        documents=(
            DocumentSeed(
                source_key="github",
                role=EventSourceRole.PRIMARY,
                slug="copilot-review-cli-primary",
                title="GitHub запускает review mode для Copilot CLI",
                text="GitHub открыл для Copilot CLI новый режим review. Инструмент проходит по диффу до публикации pull request, выделяет спорные фрагменты и предлагает правки в том же терминальном цикле. Компания отдельно подчеркивает, что команда может подключить режим как обязательный шаг перед merge. В пилоте участвовали 230 команд, а среднее время на первичную проверку сократилось на 18%.",
                hour=9,
                entities={"companies": ["GitHub"], "products": ["Copilot CLI"]},
            ),
            DocumentSeed(
                source_key="github",
                role=EventSourceRole.SUPPORTING,
                slug="copilot-review-cli-context",
                title="GitHub описал ограничения и сценарии подключения review mode",
                text="В сопроводительном материале GitHub объясняет, что review mode не заменяет ревьюера, а снимает типовые замечания по стилю, безопасности и структуре тестов. Для enterprise-аккаунтов режим можно включать на уровне организации и хранить историю замечаний 90 дней.",
                hour=11,
            ),
        ),
    ),
    EventSeed(
        slug="nvidia-sovereign-bundle-telecom",
        event_date=date(2026, 4, 3),
        title="NVIDIA расширила sovereign AI-пакет для телеком-операторов",
        short_summary="NVIDIA добавила в sovereign AI-пакет готовые конфигурации для операторов связи и региональных дата-центров.",
        long_summary="Компания продает не только ускорители, но и полный контур развертывания: модельный слой, сетевую архитектуру и шаблоны закупки, поэтому переговоры смещаются в сторону больших инфраструктурных контрактов.",
        primary_source_key="nvidia",
        primary_source_slug="sovereign-ai-telecom",
        importance_score=88,
        market_impact_score=86,
        ai_news_score=90,
        coding_score=18,
        investment_score=24,
        confidence_score=87,
        ranking_score=91,
        is_highlight=True,
        categories=((EventSection.IMPORTANT, 0.95, True), (EventSection.AI_NEWS, 0.89, False)),
        tags=(("NVIDIA", EventTagType.ENTITY), ("инфраструктура", EventTagType.THEME), ("telecom", EventTagType.MARKET)),
        documents=(
            DocumentSeed(
                source_key="nvidia",
                role=EventSourceRole.PRIMARY,
                slug="sovereign-ai-telecom-primary",
                title="NVIDIA добавляет telecom-пакет в sovereign AI",
                text="NVIDIA расширила программу sovereign AI и вывела отдельный пакет для телеком-операторов. В него входят reference-архитектура на 256 GPU, сетевой стек для локальных дата-центров и шаблонный каталог сервисов для государственных и корпоративных заказчиков. Компания говорит, что типичный проект рассчитан на запуск в течение второго квартала 2026 года.",
                hour=10,
                entities={"companies": ["NVIDIA"], "markets": ["telecom"]},
            ),
            DocumentSeed(
                source_key="nvidia",
                role=EventSourceRole.SUPPORTING,
                slug="sovereign-ai-telecom-budget",
                title="NVIDIA описала экономику пакета",
                text="Во втором материале NVIDIA прямо указывает бюджетный ориентир: пилотный контур для регионального оператора начинается примерно от $180 млн. Партнерские integrator-команды смогут брать на себя часть внедрения, а итоговый стек поставляется как набор готовых модулей для обучения, инференса и мониторинга.",
                hour=12,
            ),
        ),
    ),
    EventSeed(
        slug="tbank-assistant-client-surface",
        event_date=date(2026, 4, 3),
        title="Т-Банк вывел внутреннего ИИ-ассистента в клиентский контур",
        short_summary="Т-Банк начал использовать внутреннего ИИ-ассистента в клиентских сценариях после пилота на операционных командах.",
        long_summary="Банк переводит ассистента из внутреннего инструмента в видимую часть продукта и одновременно ужесточает требования к контролю качества, журналированию ответов и юридической валидации.",
        primary_source_key="tbank",
        primary_source_slug="assistant-client-surface",
        importance_score=64,
        market_impact_score=62,
        ai_news_score=70,
        coding_score=22,
        investment_score=4,
        confidence_score=78,
        ranking_score=73,
        is_highlight=False,
        categories=((EventSection.AI_NEWS, 0.76, True),),
        tags=(("Т-Банк", EventTagType.ENTITY), ("ассистенты", EventTagType.TECH), ("банки", EventTagType.MARKET)),
        score_components_json={
            "russia_relevance_score": 0.76,
            "russia_reason_codes": ["russia_source_region", "russia_major_company_signal", "russia_adoption_signal"],
            "russia_source_region_count": 1,
            "russia_source_role_count": 1,
            "russia_policy_signal": False,
            "russia_state_signal": False,
            "russia_major_company_signal": True,
            "russia_market_infra_signal": False,
            "russia_adoption_signal": True,
            "russia_restriction_signal": False,
            "russia_weak_pr_penalty": False,
        },
        documents=(
            DocumentSeed(
                source_key="tbank",
                role=EventSourceRole.PRIMARY,
                slug="assistant-client-surface-primary",
                title="Т-Банк расширил применение ИИ-ассистента",
                text="Т-Банк сообщил, что переводит внутреннего ИИ-ассистента из операционного контура в клиентские сценарии. Сначала продукт использовали сотрудники контактных центров и команд сопровождения, а теперь его запускают в приложении для ограниченной группы пользователей. В банке говорят, что для публичного этапа пришлось собрать отдельный юридический и продуктовый контроль.",
                hour=9,
            ),
            DocumentSeed(
                source_key="tbank",
                role=EventSourceRole.REACTION,
                slug="assistant-client-surface-risk",
                title="Банк раскрыл требования к запуску",
                text="Во втором материале команда подчеркивает, что каждая подсказка проходит через журналирование и ручную проверку спорных ответов. Для розничного контура банк установил лимит на автоматические действия и хранит историю обращений 180 дней.",
                hour=13,
            ),
        ),
    ),
    EventSeed(
        slug="anthropic-governance-dashboard",
        event_date=date(2026, 4, 4),
        title="Anthropic добавила governance dashboard для Claude Enterprise",
        short_summary="Anthropic усилила корпоративный пакет Claude инструментами контроля доступа и журналирования внедрений.",
        long_summary="Новый dashboard закрывает требования крупных покупателей к контролю политик, журналам действий и срокам удержания данных, поэтому продажа Claude все больше идет как корпоративная платформа, а не как отдельная модель.",
        primary_source_key="anthropic",
        primary_source_slug="governance-dashboard",
        importance_score=79,
        market_impact_score=77,
        ai_news_score=88,
        coding_score=20,
        investment_score=8,
        confidence_score=86,
        ranking_score=86,
        is_highlight=False,
        categories=((EventSection.AI_NEWS, 0.91, True), (EventSection.IMPORTANT, 0.72, False)),
        tags=(("Anthropic", EventTagType.ENTITY), ("Claude", EventTagType.TECH), ("enterprise", EventTagType.MARKET)),
        documents=(
            DocumentSeed(
                source_key="anthropic",
                role=EventSourceRole.PRIMARY,
                slug="governance-dashboard-primary",
                title="Anthropic перестраивает корпоративный пакет Claude",
                text="Anthropic выпустила governance dashboard для Claude Enterprise. Панель объединяет роли доступа, журналирование действий, хранение политик и экспорт инцидентов в корпоративные системы контроля. Компания говорит, что в пилоте участвовали 140 организаций, а у части клиентов цикл согласования внедрения сократился с восьми недель до пяти.",
                hour=10,
                entities={"companies": ["Anthropic"], "products": ["Claude Enterprise"]},
            ),
            DocumentSeed(
                source_key="anthropic",
                role=EventSourceRole.SUPPORTING,
                slug="governance-dashboard-quote",
                title="Anthropic объяснила, что продает не только модель",
                text="В сопроводительной заметке Anthropic формулирует позицию прямо: «покупатели больше не хотят покупать просто доступ к модели, они покупают управляемый контур». Это объясняет, почему компания так агрессивно расширяет административный слой вокруг Claude.",
                hour=12,
            ),
        ),
    ),
    EventSeed(
        slug="eu-transparency-guidance",
        event_date=date(2026, 4, 4),
        title="Еврокомиссия выпустила разъяснения по прозрачности foundation-моделей",
        short_summary="Еврокомиссия опубликовала практические разъяснения по тому, какие документы и уведомления нужны поставщикам foundation-моделей.",
        long_summary="Документ не меняет сам закон, но делает более конкретными требования к карточкам модели, описанию источников данных и процессу уведомления покупателей, поэтому продуктовым и юридическим командам придется пересобрать документы заранее.",
        primary_source_key="eu",
        primary_source_slug="transparency-guidance",
        importance_score=90,
        market_impact_score=85,
        ai_news_score=87,
        coding_score=12,
        investment_score=10,
        confidence_score=90,
        ranking_score=93,
        is_highlight=True,
        categories=((EventSection.IMPORTANT, 0.97, True), (EventSection.AI_NEWS, 0.84, False)),
        tags=(("ЕС", EventTagType.ENTITY), ("регулирование", EventTagType.THEME), ("foundation models", EventTagType.TECH)),
        documents=(
            DocumentSeed(
                source_key="eu",
                role=EventSourceRole.PRIMARY,
                slug="transparency-guidance-primary",
                title="Еврокомиссия конкретизировала требования к прозрачности foundation-моделей",
                text="Еврокомиссия выпустила комплект разъяснений по прозрачности foundation-моделей. Поставщики должны раскрывать назначение модели, ограничения по использованию, ключевые данные об обучении и процесс уведомления покупателей. Документ вводит переходный период до второго квартала 2026 года и требует обновлять карточку модели при заметных изменениях в архитектуре или источниках данных.",
                hour=8,
            ),
            DocumentSeed(
                source_key="eu",
                role=EventSourceRole.SUPPORTING,
                slug="transparency-guidance-consequence",
                title="Юридические команды получили более жесткий перечень обязанностей",
                text="Во втором документе Еврокомиссия отдельно пишет о практических последствиях для поставщиков: хранение журналов должно покрывать не меньше 12 месяцев, а ответы покупателям на запросы по данным не должны превышать 30 дней. Для компаний это означает дополнительные расходы на комплаенс и документирование.",
                hour=11,
            ),
        ),
    ),
    EventSeed(
        slug="perplexity-funding-round",
        event_date=date(2026, 4, 5),
        title="Perplexity привлекла $500 млн на расширение поиска и агентных продуктов",
        short_summary="Perplexity закрыла раунд на $500 млн и направит капитал на инфраструктуру поиска, корпоративные сценарии и агентные продукты.",
        long_summary="Сумма раунда меняет переговорную позицию компании на рынке поиска и корпоративных помощников, потому что теперь ей легче закупать вычисления, нанимать команды и ускорять сделки с партнерами.",
        primary_source_key="perplexity",
        primary_source_slug="funding-round-500m",
        importance_score=83,
        market_impact_score=86,
        ai_news_score=68,
        coding_score=8,
        investment_score=96,
        confidence_score=88,
        ranking_score=90,
        is_highlight=False,
        categories=((EventSection.INVESTMENTS, 0.98, True), (EventSection.AI_NEWS, 0.66, False)),
        tags=(("Perplexity", EventTagType.ENTITY), ("финансирование", EventTagType.THEME), ("поиск", EventTagType.MARKET)),
        documents=(
            DocumentSeed(
                source_key="perplexity",
                role=EventSourceRole.PRIMARY,
                slug="funding-round-primary",
                title="Perplexity закрыла крупный раунд",
                text="Perplexity привлекла $500 млн в новом раунде финансирования. Компания сообщает, что деньги пойдут на вычислительную инфраструктуру, корпоративную подписку и отдельный набор агентных продуктов для поиска и аналитики. В документах для инвесторов говорится, что Perplexity хочет удвоить enterprise-выручку до конца 2026 года.",
                hour=9,
                entities={"companies": ["Perplexity"], "money": ["$500 млн"]},
            ),
            DocumentSeed(
                source_key="perplexity",
                role=EventSourceRole.SUPPORTING,
                slug="funding-round-context",
                title="Perplexity объяснила, зачем ей нужен этот капитал",
                text="Компания отдельно подчеркивает, что раунд нужен не для имиджа, а для более дорогой инфраструктуры поиска и сделки с корпоративными заказчиками. Внутренний ориентир по времени ответа для нового продуктового слоя составляет 1,3 секунды, а целевой горизонт запуска новых enterprise-функций — второй квартал 2026 года.",
                hour=11,
            ),
        ),
    ),
    EventSeed(
        slug="yandex-h100-inference-moscow",
        event_date=date(2026, 4, 5),
        title="Yandex Cloud открыл inference-кластеры на H100 в Москве",
        short_summary="Yandex Cloud запустил новый слой инференс-кластеров на H100 для корпоративных заказчиков в Москве.",
        long_summary="Провайдер продает не отдельные GPU, а готовый контур развертывания с квотами, мониторингом и SLA, поэтому локальные команды получают более понятную альтернативу самостоятельной сборке инфраструктуры.",
        primary_source_key="yandex",
        primary_source_slug="h100-inference-moscow",
        importance_score=78,
        market_impact_score=74,
        ai_news_score=82,
        coding_score=71,
        investment_score=4,
        confidence_score=84,
        ranking_score=85,
        is_highlight=False,
        categories=((EventSection.CODING, 0.81, True), (EventSection.AI_NEWS, 0.74, False)),
        tags=(("Yandex Cloud", EventTagType.ENTITY), ("инфраструктура", EventTagType.THEME), ("GPU", EventTagType.TECH)),
        score_components_json={
            "russia_relevance_score": 0.88,
            "russia_reason_codes": ["russia_source_region", "russia_major_company_signal", "russia_market_infra_signal"],
            "russia_source_region_count": 1,
            "russia_source_role_count": 1,
            "russia_policy_signal": False,
            "russia_state_signal": False,
            "russia_major_company_signal": True,
            "russia_market_infra_signal": True,
            "russia_adoption_signal": False,
            "russia_restriction_signal": False,
            "russia_weak_pr_penalty": False,
        },
        documents=(
            DocumentSeed(
                source_key="yandex",
                role=EventSourceRole.PRIMARY,
                slug="h100-inference-primary",
                title="Yandex Cloud запускает inference-кластеры на H100",
                text="Yandex Cloud объявил о запуске inference-кластеров на H100 в московском регионе. Новый слой доступен для корпоративных заказчиков по модели зарезервированной мощности и включает мониторинг, квоты, изоляцию проектов и SLA 99,95%. В компании говорят, что первый пул рассчитан на 320 GPU.",
                hour=10,
                entities={"companies": ["Yandex Cloud"], "infrastructure": ["H100", "320 GPU"]},
            ),
            DocumentSeed(
                source_key="yandex",
                role=EventSourceRole.SUPPORTING,
                slug="h100-inference-economics",
                title="Yandex Cloud раскрыл условия использования",
                text="В сопроводительном тексте компания отмечает, что заказчики смогут резервировать кластеры на срок от трех месяцев, а время ввода в эксплуатацию сократили до пяти рабочих дней. Для локального рынка это важный сигнал, потому что многие команды до сих пор собирали похожую инфраструктуру вручную.",
                hour=12,
            ),
        ),
    ),
    EventSeed(
        slug="openai-memory-controls-enterprise",
        event_date=date(2026, 4, 6),
        title="OpenAI открыла для администраторов ChatGPT Enterprise управление памятью",
        short_summary="OpenAI дала администраторам ChatGPT Enterprise отдельные настройки памяти, хранения и отключения персональных контекстов.",
        long_summary="Компания выводит память из пользовательской функции в корпоративный контур управления, поэтому закупщики получают больше контроля над рисками, а продуктовый разговор смещается к политике хранения, срокам и управлению доступом.",
        primary_source_key="openai",
        primary_source_slug="memory-controls-enterprise",
        importance_score=91,
        market_impact_score=89,
        ai_news_score=95,
        coding_score=22,
        investment_score=5,
        confidence_score=91,
        ranking_score=95,
        is_highlight=True,
        categories=((EventSection.IMPORTANT, 0.98, True), (EventSection.AI_NEWS, 0.93, False)),
        tags=(("OpenAI", EventTagType.ENTITY), ("ChatGPT Enterprise", EventTagType.TECH), ("enterprise", EventTagType.MARKET)),
        documents=(
            DocumentSeed(
                source_key="openai",
                role=EventSourceRole.PRIMARY,
                slug="memory-controls-primary",
                title="OpenAI переносит память в административный контур",
                text="OpenAI открыла для администраторов ChatGPT Enterprise отдельный блок управления памятью. Компании могут задавать сроки хранения, отключать персональную память по группам и включать обязательное журналирование обращений. В документации указан ориентир хранения до 90 дней для расследования инцидентов и аудита.",
                hour=9,
                entities={"companies": ["OpenAI"], "products": ["ChatGPT Enterprise"]},
            ),
            DocumentSeed(
                source_key="openai",
                role=EventSourceRole.SUPPORTING,
                slug="memory-controls-quote",
                title="OpenAI объяснила, на какой запрос отвечает обновление",
                text="В сопроводительной заметке компания пишет, что корпоративные клиенты просили не просто память, а понятные правила отключения и хранения. По сути, OpenAI признает: без административного контура память не проходит у крупных покупателей, особенно в регулируемых сегментах.",
                hour=11,
            ),
            DocumentSeed(
                source_key="openai",
                role=EventSourceRole.REACTION,
                slug="memory-controls-context",
                title="Партнеры считают обновление обязательным для крупных контрактов",
                text="Партнерский комментарий к релизу сводится к простому выводу: без централизованного контроля память оставалась интересной функцией, но не проходила в закупке. Теперь продукт можно продавать как управляемый корпоративный модуль, а не как экспериментальную возможность для отдельных команд.",
                hour=13,
            ),
        ),
    ),
    EventSeed(
        slug="mistral-ocr-api",
        event_date=date(2026, 4, 6),
        title="Mistral выпустила OCR API для корпоративной обработки документов",
        short_summary="Mistral открыла OCR API и нацелилась на сегмент документного распознавания для корпоративных сценариев.",
        long_summary="Компания выходит в более прикладной слой рынка: не в генерацию текста как таковую, а в обработку документов, где у покупателей есть понятные бюджеты, интеграции и требования к качеству извлечения данных.",
        primary_source_key="mistral",
        primary_source_slug="ocr-api",
        importance_score=76,
        market_impact_score=73,
        ai_news_score=86,
        coding_score=34,
        investment_score=4,
        confidence_score=83,
        ranking_score=82,
        is_highlight=False,
        categories=((EventSection.AI_NEWS, 0.9, True),),
        tags=(("Mistral", EventTagType.ENTITY), ("OCR API", EventTagType.TECH), ("документы", EventTagType.MARKET)),
        documents=(
            DocumentSeed(
                source_key="mistral",
                role=EventSourceRole.PRIMARY,
                slug="ocr-api-primary",
                title="Mistral запускает OCR API",
                text="Mistral выпустила OCR API для корпоративной обработки документов. Сервис рассчитан на извлечение текста, таблиц и полей из больших архивов, а заявленная скорость достигает 120 страниц в минуту на типовом контуре. Компания сразу предлагает пакет для интеграторов и поставщиков документооборота.",
                hour=10,
            ),
            DocumentSeed(
                source_key="mistral",
                role=EventSourceRole.SUPPORTING,
                slug="ocr-api-consequence",
                title="Mistral делает ставку на понятную прикладную экономику",
                text="Во втором материале Mistral объясняет, что выходит в сегмент, где решение покупают под конкретный процесс: оцифровку архива, страховой поток или банковский бэк-офис. Это важнее абстрактного анонса модели, потому что у такого продукта легче измерять цену документа, скорость внедрения и возврат инвестиций.",
                hour=12,
            ),
        ),
    ),
    EventSeed(
        slug="mincifry-registry-ai-services",
        event_date=date(2026, 4, 6),
        title="Минцифры опубликовало проект требований к реестру ИИ-сервисов",
        short_summary="Минцифры вынесло на обсуждение проект требований к реестру ИИ-сервисов для корпоративных и государственных закупок.",
        long_summary="Документ задает более формальный контур допуска: описание модели, данные о хранении, журналирование и контакт для инцидентов. Для поставщиков это означает более тяжелый вход в закупку и раннюю подготовку документов.",
        primary_source_key="mincifry",
        primary_source_slug="registry-ai-services",
        importance_score=89,
        market_impact_score=87,
        ai_news_score=84,
        coding_score=10,
        investment_score=2,
        confidence_score=90,
        ranking_score=92,
        is_highlight=True,
        categories=((EventSection.IMPORTANT, 0.95, True), (EventSection.AI_NEWS, 0.81, False)),
        tags=(("Минцифры", EventTagType.ENTITY), ("регулирование", EventTagType.THEME), ("госзакупки", EventTagType.MARKET)),
        score_components_json={
            "russia_relevance_score": 0.93,
            "russia_reason_codes": ["russia_source_region", "russia_policy_signal", "russia_restriction_signal"],
            "russia_source_region_count": 1,
            "russia_source_role_count": 1,
            "russia_policy_signal": True,
            "russia_state_signal": True,
            "russia_major_company_signal": False,
            "russia_market_infra_signal": False,
            "russia_adoption_signal": False,
            "russia_restriction_signal": True,
            "russia_weak_pr_penalty": False,
        },
        documents=(
            DocumentSeed(
                source_key="mincifry",
                role=EventSourceRole.PRIMARY,
                slug="registry-ai-services-primary",
                title="Минцифры предложило правила для реестра ИИ-сервисов",
                text="Минцифры опубликовало проект требований к реестру ИИ-сервисов. Для включения в перечень поставщик должен раскрыть назначение сервиса, сроки хранения данных, контур журналирования, контакт для инцидентов и правила отключения автоматических функций. Проект обсуждают до 30 апреля 2026 года.",
                hour=8,
            ),
            DocumentSeed(
                source_key="mincifry",
                role=EventSourceRole.SUPPORTING,
                slug="registry-ai-services-practical",
                title="Поставщикам придется пересобирать пакет документов",
                text="В пояснительной записке ведомство отдельно указывает, что крупные заказчики хотят сравнимые карточки сервисов и единый набор обязательных сведений для закупки. Для компаний это означает раннюю юридическую подготовку, продуктовые ограничения и более строгий контроль над тем, как ИИ-функции работают в проде.",
                hour=11,
            ),
        ),
    ),
)


def _published_at(event_date: date, hour: int) -> datetime:
    return datetime.combine(event_date, time(hour=hour, minute=0), tzinfo=timezone.utc)


async def _ensure_sources(session) -> dict[str, Source]:
    sources_by_key: dict[str, Source] = {}
    for seed in SOURCE_SEEDS:
        existing = await session.scalar(select(Source).where(Source.handle_or_url == seed.handle_or_url))
        if existing is None:
            existing = Source(
                title=seed.title,
                handle_or_url=seed.handle_or_url,
                source_type=seed.source_type,
                priority_weight=seed.priority_weight,
                is_active=True,
                language=seed.language,
                country_scope=seed.country_scope,
                section_bias=seed.section_bias,
                role=seed.role,
                region=seed.region,
                editorial_priority=seed.editorial_priority,
                noise_score=seed.noise_score,
            )
            session.add(existing)
            await session.flush()
        else:
            existing.title = seed.title
            existing.source_type = seed.source_type
            existing.priority_weight = seed.priority_weight
            existing.is_active = True
            existing.language = seed.language
            existing.country_scope = seed.country_scope
            existing.section_bias = seed.section_bias
            existing.role = seed.role
            existing.region = seed.region
            existing.editorial_priority = seed.editorial_priority
            existing.noise_score = seed.noise_score
        sources_by_key[seed.key] = existing
    return sources_by_key


async def _clear_existing_demo_content(session) -> None:
    demo_source_handles = [seed.handle_or_url for seed in SOURCE_SEEDS]
    demo_sources = list((await session.scalars(select(Source).where(Source.handle_or_url.in_(demo_source_handles)))).all())
    demo_source_ids = [source.id for source in demo_sources]

    await session.execute(
        delete(DigestIssue).where(
            DigestIssue.issue_date.in_(TARGET_DATES),
            DigestIssue.issue_type.in_((DigestIssueType.DAILY, DigestIssueType.WEEKLY)),
        )
    )
    await session.execute(
        delete(AlphaEntry).where(
            AlphaEntry.publish_date.in_(TARGET_DATES),
            AlphaEntry.created_by == "demo_seed",
        )
    )
    if demo_source_ids:
        await session.execute(delete(Event).where(Event.event_date.in_(TARGET_DATES), Event.primary_source_id.in_(demo_source_ids)))
        await session.execute(delete(RawItem).where(RawItem.source_id.in_(demo_source_ids), RawItem.canonical_url.like(f"{DEMO_BASE_URL}%")))
    await session.flush()


async def _seed_events(session, *, sources_by_key: dict[str, Source]) -> list[Event]:
    created_events: list[Event] = []
    for seed in EVENT_SEEDS:
        primary_source = sources_by_key[seed.primary_source_key]
        event = Event(
            event_date=seed.event_date,
            title=seed.title,
            short_summary=seed.short_summary,
            long_summary=seed.long_summary,
            primary_source_id=primary_source.id,
            primary_source_url=f"{DEMO_BASE_URL}{seed.event_date.isoformat()}/{seed.primary_source_slug}",
            importance_score=seed.importance_score,
            market_impact_score=seed.market_impact_score,
            ai_news_score=seed.ai_news_score,
            coding_score=seed.coding_score,
            investment_score=seed.investment_score,
            confidence_score=seed.confidence_score,
            ranking_score=seed.ranking_score,
            supporting_source_count=sum(1 for document in seed.documents if document.role is not EventSourceRole.PRIMARY),
            verification_source_count=max(0, len(seed.documents) - 1),
            has_verification_source=len(seed.documents) > 1,
            score_components_json=seed.score_components_json,
            is_highlight=seed.is_highlight,
        )
        session.add(event)
        await session.flush()

        for section, score, is_primary in seed.categories:
            session.add(EventCategory(event_id=event.id, section=section, score=score, is_primary_section=is_primary))
        for tag, tag_type in seed.tags:
            session.add(EventTag(event_id=event.id, tag=tag, tag_type=tag_type))
        for document in seed.documents:
            source = sources_by_key[document.source_key]
            canonical_url = f"{DEMO_BASE_URL}{seed.event_date.isoformat()}/{document.slug}"
            raw_item = RawItem(
                source_id=source.id,
                external_id=document.slug,
                source_type=source.source_type,
                author_name="demo newsroom",
                published_at=_published_at(seed.event_date, document.hour),
                canonical_url=canonical_url,
                raw_title=document.title,
                raw_text=document.text,
                raw_payload_json={"demo": True, "event_slug": seed.slug},
                language=source.language,
                status=RawItemStatus.NORMALIZED,
                normalized_title=document.title,
                normalized_text=document.text,
                entities_json=document.entities or {},
                outbound_links_json=[],
            )
            session.add(raw_item)
            await session.flush()
            session.add(
                EventSource(
                    event_id=event.id,
                    raw_item_id=raw_item.id,
                    source_id=source.id,
                    role=document.role,
                    citation_url=canonical_url,
                )
            )
        created_events.append(event)

    return created_events


async def _seed_alpha_entries(session) -> None:
    entries = (
        AlphaEntry(
            title="Альфа: закупщики ускоряют требования к управляемому ИИ",
            body_short="Корпоративный спрос смещается от демонстраций к управляемому внедрению.",
            body_long="За последние дни почти во всех сильных историях повторяется один мотив: покупатели хотят не просто модель, а прозрачный контур управления, журналирования и контроля.",
            source_links_json=[f"{DEMO_BASE_URL}alpha/enterprise-governance"],
            event_id=None,
            priority_rank=1,
            publish_date=date(2026, 4, 6),
            status=AlphaEntryStatus.PUBLISHED,
            created_by="demo_seed",
        ),
        AlphaEntry(
            title="Альфа: локальный рынок уходит в инфраструктуру и требования",
            body_short="Российский слой сейчас движется через инфраструктуру и регуляторику, а не через шоу-кейсы.",
            body_long="Локальные события последних дней показывают, что рынок в России становится жестче: выигрывают инфраструктурные ходы, регуляторная готовность и сценарии с понятной экономикой внедрения.",
            source_links_json=[f"{DEMO_BASE_URL}alpha/russia-market"],
            event_id=None,
            priority_rank=2,
            publish_date=date(2026, 4, 6),
            status=AlphaEntryStatus.PUBLISHED,
            created_by="demo_seed",
        ),
    )
    session.add_all(entries)


async def main() -> None:
    async with AsyncSessionLocal() as session:
        await _clear_existing_demo_content(session)
        sources_by_key = await _ensure_sources(session)
        created_events = await _seed_events(session, sources_by_key=sources_by_key)
        await _seed_alpha_entries(session)
        await session.commit()

    builder = DigestBuilderService(AsyncSessionLocal)
    for target_date in TARGET_DATES:
        await builder.build_daily_issue(target_date)
    await builder.build_weekly_issue(TARGET_DATES[-1])

    print(
        "demo newsroom seed completed: "
        f"{len(created_events)} events, "
        f"{len(TARGET_DATES)} daily issues, 1 weekly issue"
    )


if __name__ == "__main__":
    asyncio.run(main())
