from __future__ import annotations

from datetime import date

from httpx import ASGITransport, AsyncClient

from app.api.main import create_app
from app.db.models import AlphaEntry, AlphaEntryStatus
from app.services.digest import DigestBuilderService
from app.web import build_event_slug, build_issue_editorial_sections, filter_publishable_site_items
from tests.digest.test_digest_builder_and_delivery import seed_daily_event_data


async def test_site_shell_routes_render_real_media_pages(session_factory):
    await seed_daily_event_data(session_factory)
    async with session_factory() as session:
        session.add(
            AlphaEntry(
                title="Альфа по локальному рынку",
                body_short="Короткий сигнал по локальному AI-рынку.",
                body_long="Развернутый альфа-сигнал о движении на локальном AI-рынке.",
                source_links_json=["https://example.com/alpha-russia"],
                event_id=None,
                priority_rank=3,
                publish_date=date(2026, 3, 25),
                status=AlphaEntryStatus.PUBLISHED,
                created_by="editor",
            )
        )
        await session.commit()

    builder = DigestBuilderService(session_factory)
    issue_result = await builder.build_daily_issue(date(2026, 3, 25))
    issue = await builder.get_issue(issue_result.issue_id)
    assert issue is not None
    first_event_id = next(item.event_id for item in issue.items if item.event_id is not None)
    async with session_factory() as session:
        from sqlalchemy import select
        from app.db.models import Event
        event = await session.scalar(select(Event).where(Event.id == first_event_id))
        assert event is not None
        event_slug = build_event_slug({"id": event.id, "title": event.title})

    app = create_app(session_factory=session_factory, enable_scheduler=False)

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        homepage = await client.get("/")
        events_feed = await client.get("/events")
        event_detail = await client.get(f"/events/{event_slug}")
        issues_list = await client.get("/issues")
        issue_detail = await client.get(f"/issues/{issue_result.issue_id}")
        issue_section = await client.get(f"/issues/{issue_result.issue_id}/sections/all")
        russia_page = await client.get("/russia")
        alpha_page = await client.get("/alpha", params={"date": "2026-03-25"})
        sitemap = await client.get("/sitemap.xml")

    assert homepage.status_code == 200
    assert "Malakhov AI Digest" in homepage.text
    assert "Главная" in homepage.text
    assert "Лента" in homepage.text
    assert "Выпуски" in homepage.text
    assert "ИИ в России" in homepage.text
    assert "Альфа" in homepage.text
    assert "Самое важное сегодня" in homepage.text
    assert "Новые материалы" in homepage.text
    assert "Последний выпуск" in homepage.text
    assert "OpenAI запускает GPT-5" in homepage.text
    assert "ключевых событий сейчас</span></div>" in homepage.text
    assert "AI-стартап обновил продуктовую линейку" not in homepage.text
    assert "VK рассказал на форуме про AI-направление" not in homepage.text
    assert "Internal Web Preview" not in homepage.text
    assert "Публичная web-версия готовится" not in homepage.text
    assert "Инфоповод подтвержден" not in homepage.text
    assert "Инфоповод подтверждает" not in homepage.text
    assert "Событие собрано по" not in homepage.text
    assert "основной источник" not in homepage.text
    assert "это может" not in homepage.text.lower()
    assert "это позволяет" not in homepage.text.lower()
    assert "данное " not in homepage.text.lower()
    assert 'meta name="description"' in homepage.text
    assert 'property="og:title"' in homepage.text

    assert events_feed.status_code == 200
    assert "Лента" in events_feed.text
    assert "Свежие материалы" in events_feed.text
    assert "GitHub Copilot добавляет" in events_feed.text
    assert "Инструменты" in events_feed.text
    assert "Инвестиции" in events_feed.text

    assert event_detail.status_code == 200
    assert "Событие" in event_detail.text
    assert "OpenAI запускает GPT-5" in event_detail.text
    assert "Продолжить чтение" in event_detail.text
    assert "Связанные материалы" in event_detail.text
    assert "Из этого же выпуска" in event_detail.text
    assert "По той же теме" in event_detail.text
    assert "Навигация по выпуску" in event_detail.text
    assert "Источник" in event_detail.text
    assert "Почему это важно" not in event_detail.text
    assert "Что это меняет" not in event_detail.text
    assert "Кто выигрывает / проигрывает" not in event_detail.text
    assert "Сигналы" not in event_detail.text
    assert "Инфоповод подтвержден" not in event_detail.text
    assert "Инфоповод подтверждает" not in event_detail.text
    assert "Событие собрано по" not in event_detail.text
    assert "это помогает понять" not in event_detail.text.lower()
    assert "это может повлиять" not in event_detail.text.lower()
    assert "это позволяет" not in event_detail.text.lower()
    assert "данное " not in event_detail.text.lower()
    assert "в ai" not in event_detail.text.lower()
    assert "конкурент" in event_detail.text.lower() or "рын" in event_detail.text.lower() or "бизнес" in event_detail.text.lower()
    assert event_detail.text.count("<div class=\"detail-prose\"><p>") == 1
    assert "</p><p>" in event_detail.text
    assert f'/events/{event_slug}' in event_detail.text

    assert issues_list.status_code == 200
    assert "Архив выпусков" in issues_list.text
    assert issue.title in issues_list.text

    assert issue_detail.status_code == 200
    assert issue.title in issue_detail.text
    assert "Разделы выпуска" in issue_detail.text
    assert "Сегодня в центре внимания" in issue_detail.text
    assert "Новости ИИ</a></h3>" not in issue_detail.text
    assert "Событие в AI" not in issue_detail.text
    assert "собирает материалы" not in issue_detail.text.lower()
    assert "повестк" not in issue_detail.text.lower()
    assert "Новости ИИ" in issue_detail.text
    assert "Инструменты" in issue_detail.text
    assert "Инвестиции" in issue_detail.text
    assert "ИИ в России" in issue_detail.text
    assert "issue-main-card" in issue_detail.text
    assert "Почему это важно:" not in issue_detail.text
    assert "Что дальше:" not in issue_detail.text
    assert 'class="issue-article-line"' in issue_detail.text

    assert issue_section.status_code == 200
    assert "Раздел выпуска" in issue_section.text
    assert "Все материалы" in issue_section.text

    assert russia_page.status_code == 200
    assert "ИИ в России" in russia_page.text
    assert "Яндекс Cloud представил новый стек для ИИ-сервисов" in russia_page.text
    assert "VK рассказал на форуме про AI-направление" not in russia_page.text

    assert alpha_page.status_code == 200
    assert "Альфа-сигналы" in alpha_page.text
    assert "Альфа по локальному рынку" in alpha_page.text

    assert sitemap.status_code == 200
    assert "/events/" in sitemap.text
    assert "/issues/" in sitemap.text


def test_issue_editorial_sections_ignore_pseudo_items():
    items = [
        {
            "id": 11,
            "event_id": 11,
            "title": "Mistral выпускает OCR API",
            "short_summary": "Mistral запускает OCR API и выходит в более конкурентный сегмент обработки документов.",
            "long_summary": "Mistral запускает OCR API и усиливает позиции в корпоративных сценариях обработки документов.",
            "primary_section": "ai_news",
            "section": "ai_news",
            "event_date": "2026-04-06",
            "primary_source": {"title": "Mistral", "region": "global"},
            "categories": [{"section": "ai_news"}],
            "tags": [],
            "source_documents": [],
        },
        {
            "id": 99,
            "event_id": None,
            "card_title": "Новости ИИ",
            "card_text": "Сегодня день спокойный: сильных событий немного.",
            "title": "Новости ИИ",
            "section": "all",
            "event_date": "2026-04-06",
            "primary_source": {},
            "categories": [],
            "tags": [],
            "source_documents": [],
        },
    ]

    filtered = filter_publishable_site_items(items, require_event=True)
    sections = build_issue_editorial_sections(items=items)

    assert len(filtered) == 1
    assert filtered[0]["event_id"] == 11
    assert len(sections) == 1
    assert sections[0]["main_item"]["event_id"] == 11
