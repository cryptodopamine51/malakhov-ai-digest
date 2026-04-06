from __future__ import annotations

from html import escape
import re
from urllib.parse import urlencode

from app.services.editorial import get_ru_editorial_policy
_POLICY = get_ru_editorial_policy()
_SENTENCE_RE = re.compile(r"(?<=[.!?])\s+")
_NON_SLUG_RE = re.compile(r"[^a-z0-9]+")
_MULTISPACE_RE = re.compile(r"\s+")
_CYRILLIC_TO_LATIN = str.maketrans(
    {
        "а": "a", "б": "b", "в": "v", "г": "g", "д": "d", "е": "e", "ё": "e",
        "ж": "zh", "з": "z", "и": "i", "й": "i", "к": "k", "л": "l", "м": "m",
        "н": "n", "о": "o", "п": "p", "р": "r", "с": "s", "т": "t", "у": "u",
        "ф": "f", "х": "h", "ц": "ts", "ч": "ch", "ш": "sh", "щ": "sch", "ъ": "",
        "ы": "y", "ь": "", "э": "e", "ю": "yu", "я": "ya",
    }
)
_SITE_BASE_URL = "https://news.malakhovai.ru"
_PLACEHOLDER_TITLE_RE = re.compile(
    r"\b(событие|новость|материал)\b.*\b(ai|ии)\b|\b(ai|ии)\b.*\b(событие|новость|материал)\b",
    re.IGNORECASE,
)
_BAD_PUBLIC_PATTERNS = (
    "событие собрано по",
    "инфоповод подтвержден",
    "инфоповод подтверждает",
    "базовое покрытие дает",
    "базовое покрытие даёт",
    "связанным материал",
    "день спокойный",
    "почему это важно",
    "что это меняет",
    "кто выигрывает / проигрывает",
    "это важно для",
    "история важна не только",
    "смысл события шире",
    "гонка за рынок ускоряется",
    "конкуренция за клиентов обостряется",
    "расстановка сил меняется",
    "давление на компании усиливается",
    "рынок быстро смещается",
    "рынок быстрее делит влияние",
    "в центре внимания уже не только",
)
_WEAK_PUBLIC_TOKENS = ("форум", "roadmap", "роадмап", "продуктовую линейку", "мероприяти")
_STRONG_PUBLIC_TOKENS = ("закон", "регулир", "инфраструкт", "кластер", "реестр", "контракт", "финанс", "enterprise")


def render_site_homepage(
    *,
    featured_events: list[dict[str, object]],
    latest_issue: dict[str, object] | None,
    russia_events: list[dict[str, object]],
    recent_events: list[dict[str, object]],
    issues: list[dict[str, object]],
    alpha_items: list[dict[str, object]],
) -> str:
    body = [
        _site_header("Главная"),
        '<section class="hero-block">',
        '<div class="hero-copy">',
        '<p class="kicker">Malakhov AI Digest</p>',
        '<h1>Плотный русскоязычный слой про ключевые события в AI.</h1>',
        '<p class="hero-lede">Сайт показывает более широкий медиаслой: важные релизы, инфраструктуру, рынок, корпоративные сдвиги и контур «ИИ в России». Telegram остается коротким best-of слоем.</p>',
        "</div>",
        '<div class="hero-meta">',
        f'<div class="metric"><span class="metric-value">{len(featured_events)}</span><span class="metric-label">ключевых событий сейчас</span></div>',
        f'<div class="metric"><span class="metric-value">{len(russia_events)}</span><span class="metric-label">материалов в «ИИ в России»</span></div>',
        "</div>",
        "</section>",
    ]

    if featured_events:
        lead_event = featured_events[0]
        body.extend(
            [
                '<section class="homepage-block feature-layout">',
                '<div class="feature-main">',
                '<p class="block-label">Самое важное сегодня</p>',
                _featured_event_card(lead_event),
                "</div>",
                '<div class="feature-side">',
                '<p class="block-label">Ещё важное</p>',
            ]
        )
        for item in featured_events[1:5]:
            body.append(_compact_event_card(item))
        body.extend(["</div>", "</section>"])

    body.append('<section class="homepage-grid">')
    body.append('<div class="primary-column">')

    if latest_issue is not None:
        body.extend(
            [
                '<section class="homepage-block">',
                '<div class="block-head"><h2>Последний выпуск</h2><a href="/issues">Все выпуски</a></div>',
                _issue_feature_card(latest_issue),
                "</section>",
            ]
        )

    if recent_events:
        body.extend(
            [
                '<section class="homepage-block">',
                '<div class="block-head"><h2>Новые материалы</h2><a href="/events">Вся лента</a></div>',
            ]
        )
        for item in recent_events[:8]:
            body.append(_standard_event_card(item))
        body.append("</section>")

    body.append("</div>")
    body.append('<aside class="secondary-column">')

    body.extend(
        [
            '<section class="homepage-block">',
            '<div class="block-head"><h2>ИИ в России</h2><a href="/russia">Открыть раздел</a></div>',
        ]
    )
    if russia_events:
        for item in russia_events[:6]:
            body.append(_compact_event_card(item))
    body.append("</section>")

    body.extend(
        [
            '<section class="homepage-block">',
            '<div class="block-head"><h2>Выпуски</h2><a href="/issues">Архив</a></div>',
        ]
    )
    for issue in issues[:6]:
        body.append(_issue_list_card(issue))
    body.append("</section>")

    body.extend(
        [
            '<section class="homepage-block">',
            '<div class="block-head"><h2>Альфа</h2><a href="/alpha">Все сигналы</a></div>',
        ]
    )
    if alpha_items:
        for item in alpha_items[:4]:
            body.append(_alpha_card(item))
    body.append("</section>")

    body.append("</aside>")
    body.append("</section>")
    return _layout(
        "Malakhov AI Digest",
        "".join(body),
        description="Русскоязычное AI-медиа: ключевые события рынка, продуктов, инфраструктуры, инвестиций и локального контура «ИИ в России».",
        path="/",
    )


def render_site_events_page(
    *,
    events: list[dict[str, object]],
    title: str = "Лента",
    subtitle: str = "Свежие материалы о рынке, продуктах, инфраструктуре и корпоративных сдвигах в AI.",
    page: int = 1,
    has_next: bool = False,
) -> str:
    body = [
        _site_header("Лента"),
        '<section class="page-header">',
        f"<p class=\"kicker\">Лента</p><h1>{escape(title)}</h1><p class=\"page-lede\">{escape(subtitle)}</p>",
        "</section>",
        '<section class="feed-grid">',
    ]
    for item in events:
        body.append(_standard_event_card(item))
    if not events:
        body.append('<p class="empty-state">Свежих событий пока нет.</p>')
    body.append("</section>")
    body.append(_pagination("/events", page=page, has_next=has_next))
    return _layout(
        title,
        "".join(body),
        description="Лента Malakhov AI Digest: новые события, релизы, инфраструктура, инвестиции и заметные рыночные изменения.",
        path=_path_with_query("/events", page=page),
    )


def render_site_event_detail_page(
    *,
    item: dict[str, object],
    related_events: list[dict[str, object]] | None = None,
    same_issue_events: list[dict[str, object]] | None = None,
    same_category_events: list[dict[str, object]] | None = None,
    issue_navigation: dict[str, object] | None = None,
) -> str:
    primary_source = item.get("primary_source") or {}
    categories = item.get("categories") or []
    tags = item.get("tags") or []
    title = _display_title(item)
    short_summary = _display_summary(item)
    article = _display_article(item)
    related_events = related_events or []
    same_issue_events = same_issue_events or []
    same_category_events = same_category_events or []
    body = [
        _site_header("Лента"),
        '<article class="detail-page">',
        '<div class="detail-main">',
        f"<p class=\"kicker\">Событие</p><h1>{escape(title)}</h1>",
    ]
    if short_summary:
        body.append(f"<p class=\"detail-lede\">{escape(short_summary)}</p>")
    if article:
        paragraphs = "".join(f"<p>{escape(paragraph)}</p>" for paragraph in article)
        body.append(f'<div class="detail-prose">{paragraphs}</div>')
    if issue_navigation is not None and (issue_navigation.get("previous") or issue_navigation.get("next")):
        body.append('<section class="content-block nav-flow-block"><h2>Навигация по выпуску</h2><div class="issue-flow-nav">')
        previous_item = issue_navigation.get("previous")
        next_item = issue_navigation.get("next")
        if previous_item is not None:
            body.append(f'<a class="flow-link" href="{escape(event_href(previous_item))}">← {escape(_display_title(previous_item))}</a>')
        if next_item is not None:
            body.append(f'<a class="flow-link" href="{escape(event_href(next_item))}">{escape(_display_title(next_item))} →</a>')
        body.append("</div></section>")
    if related_events or same_issue_events or same_category_events:
        body.extend(
            [
                '<section class="content-block related-block">',
                '<h2>Продолжить чтение</h2>',
            ]
        )
        if related_events:
            body.append('<div class="continue-reading-group"><h3>Связанные материалы</h3><div class="feed-grid related-grid">')
            for related in related_events[:5]:
                body.append(_compact_event_card(related))
            body.append("</div></div>")
        if same_issue_events:
            body.append('<div class="continue-reading-group"><h3>Из этого же выпуска</h3><div class="feed-grid related-grid">')
            for related in same_issue_events[:4]:
                body.append(_compact_event_card(related))
            body.append("</div></div>")
        if same_category_events:
            body.append('<div class="continue-reading-group"><h3>По той же теме</h3><div class="feed-grid related-grid">')
            for related in same_category_events[:4]:
                body.append(_compact_event_card(related))
            body.append("</div></div>")
        body.append("</section>")
    body.extend(["</div>", '<aside class="detail-side">'])
    if primary_source:
        source_url = primary_source.get("url")
        source_title = escape(str(primary_source.get("title") or "Источник"))
        source_link = f'<a href="{escape(str(source_url))}" target="_blank" rel="noreferrer">{source_title}</a>' if source_url else source_title
        body.append(
            "<section class=\"meta-panel\">"
            "<h2>Источник</h2>"
            f"<p>{source_link}</p>"
            f"<p class=\"muted\">{escape(str(item['event_date']))} · {escape(_region_label(primary_source.get('region')))}</p>"
            "</section>"
        )
    if categories:
        body.append("<section class=\"meta-panel\"><h2>Категории</h2><div class=\"tag-row\">" + "".join(f"<span>{escape(_section_label(cat['section']))}</span>" for cat in categories) + "</div></section>")
    if tags:
        body.append("<section class=\"meta-panel\"><h2>Теги</h2><div class=\"tag-row\">" + "".join(f"<span>{escape(str(tag['tag']))}</span>" for tag in tags[:12]) + "</div></section>")
    body.extend(["</aside>", "</article>"])
    return _layout(
        title,
        "".join(body),
        description=_meta_description(title, short_summary),
        path=event_href(item),
    )


def render_site_issues_page(*, issues: list[dict[str, object]], page: int = 1, has_next: bool = False) -> str:
    body = [
        _site_header("Выпуски"),
        '<section class="page-header">',
        '<p class="kicker">Выпуски</p><h1>Архив выпусков</h1><p class="page-lede">Дневные и недельные выпуски с ключевыми событиями дня и недели.</p>',
        "</section>",
        '<section class="feed-grid">',
    ]
    for issue in issues:
        body.append(_issue_archive_card(issue))
    if not issues:
        body.append('<p class="empty-state">Выпусков пока нет.</p>')
    body.append("</section>")
    body.append(_pagination("/issues", page=page, has_next=has_next))
    return _layout(
        "Выпуски",
        "".join(body),
        description="Архив дневных и недельных выпусков Malakhov AI Digest.",
        path=_path_with_query("/issues", page=page),
    )


def render_site_issue_detail_page(
    *,
    issue: dict[str, object],
    sections: list[dict[str, object]],
    items: list[dict[str, object]],
    editorial_sections: list[dict[str, object]],
    intro: str,
) -> str:
    body = [
        _site_header("Выпуски"),
        '<section class="page-header">',
        f"<p class=\"kicker\">Выпуск</p><h1>{escape(str(issue['title']))}</h1>",
        f"<p class=\"page-lede\">{escape(str(issue['issue_date']))} · {escape(str(issue['issue_type']))}</p>",
        "</section>",
    ]
    if intro:
        body.append(f'<section class="section-nav-block"><p class="issue-intro">{escape(intro)}</p></section>')
    body.append('<section class="section-nav-block"><div class="block-head"><h2>Разделы выпуска</h2></div><div class="tag-row">')
    section_nav_items = editorial_sections or [
        {
            "slug": section["section"],
            "title": _section_label(section["section"]),
            "count": section["event_count"],
            "source_section": section["section"],
        }
        for section in sections
        if int(section.get("event_count") or 0) > 0
    ]
    for section in section_nav_items:
        body.append(
            f'<a class="section-pill" href="#section-{escape(str(section["slug"]))}">'
            f'{escape(str(section["title"]))} · {escape(str(section["count"]))}</a>'
        )
    body.append("</div></section>")

    if editorial_sections:
        for section in editorial_sections:
            body.extend(
                [
                    f'<section class="homepage-block issue-section-block" id="section-{escape(str(section["slug"]))}">',
                    f'<div class="block-head"><h2>{escape(str(section["title"]))}</h2><a href="/issues/{issue["id"]}/sections/{section["source_section"]}">Открыть раздел</a></div>',
                ]
            )
            main_item = section.get("main_item")
            if main_item is not None:
                body.append(_issue_main_event_card(main_item))
            secondary_items = section.get("secondary_items") or []
            if secondary_items:
                body.append('<div class="issue-secondary-grid">')
                for item in secondary_items[:3]:
                    body.append(_issue_secondary_event_card(item))
                body.append("</div>")
            body.append("</section>")
    else:
        body.append('<section class="feed-grid">')
        for item in items:
            body.append(_issue_item_card(issue["id"], item))
        body.append("</section>")
    return _layout(
        str(issue["title"]),
        "".join(body),
        description=_meta_description(str(issue["title"]), intro),
        path=f'/issues/{issue["id"]}',
    )


def render_site_issue_section_page(
    *,
    issue: dict[str, object],
    section: str,
    items: list[dict[str, object]],
    editorial_section: dict[str, object] | None = None,
) -> str:
    body = [
        _site_header("Выпуски"),
        '<section class="page-header">',
        f"<p class=\"kicker\">Раздел выпуска</p><h1>{escape(_section_label(section))}</h1>",
        f"<p class=\"page-lede\"><a href=\"/issues/{issue['id']}\">{escape(str(issue['title']))}</a></p>",
        "</section>",
    ]
    if editorial_section is not None:
        body.append('<section class="homepage-block issue-section-block">')
        main_item = editorial_section.get("main_item")
        if main_item is not None:
            body.append(_issue_main_event_card(main_item))
        secondary_items = editorial_section.get("secondary_items") or []
        if secondary_items:
            body.append('<div class="issue-secondary-grid">')
            for item in secondary_items[:4]:
                body.append(_issue_secondary_event_card(item))
            body.append("</div>")
        if main_item is None and not secondary_items:
            body.append('<p class="empty-state">В этом разделе пока нет материалов.</p>')
        body.append("</section>")
    else:
        body.append('<section class="feed-grid">')
        for item in items:
            body.append(_issue_item_card(issue["id"], item))
        if not items:
            body.append('<p class="empty-state">В этом разделе пока нет материалов.</p>')
        body.append("</section>")
    return _layout(
        f"{issue['title']} · {_section_label(section)}",
        "".join(body),
        description=_meta_description(_section_label(section), f'Раздел выпуска {issue["title"]}.'),
        path=f'/issues/{issue["id"]}/sections/{section}',
    )


def render_site_alpha_page(*, items: list[dict[str, object]]) -> str:
    body = [
        _site_header("Альфа"),
        '<section class="page-header">',
        '<p class="kicker">Альфа</p><h1>Альфа-сигналы</h1><p class="page-lede">Ручной слой заметок и сигналов поверх основного event потока.</p>',
        "</section>",
        '<section class="feed-grid">',
    ]
    for item in items:
        body.append(_alpha_page_card(item))
    if not items:
        body.append('<p class="empty-state">Опубликованных альфа-сигналов пока нет.</p>')
    body.append("</section>")
    return _layout(
        "Альфа",
        "".join(body),
        description="Альфа-сигналы и редакционные заметки поверх основного AI-потока.",
        path="/alpha",
    )


def _site_header(active: str) -> str:
    items = [
        ("Главная", "/"),
        ("Лента", "/events"),
        ("Выпуски", "/issues"),
        ("ИИ в России", "/russia"),
        ("Альфа", "/alpha"),
    ]
    links = []
    for label, href in items:
        class_name = "nav-link active" if label == active else "nav-link"
        links.append(f'<a class="{class_name}" href="{href}">{escape(label)}</a>')
    return (
        '<header class="site-header">'
        '<div class="brand-block"><a class="brand" href="/">Malakhov AI Digest</a>'
        '<p class="brand-subtitle">Русскоязычный медиаслой об AI, продуктах, рынке и инфраструктуре.</p></div>'
        f'<nav class="site-nav">{"".join(links)}</nav>'
        "</header>"
    )


def _featured_event_card(item: dict[str, object]) -> str:
    source = item.get("primary_source") or {}
    source_title = escape(str(source.get("title") or "Источник"))
    title = _display_title(item)
    summary = _display_teaser(item)
    return (
        '<article class="featured-card">'
        f'<p class="kicker">{escape(_section_label(item.get("primary_section") or "ai_news"))}</p>'
        f'<h2><a href="{escape(event_href(item))}">{escape(title)}</a></h2>'
        f'<p class="card-summary">{escape(summary)}</p>'
        f'<div class="card-meta"><span>{escape(str(item["event_date"]))}</span><span>{source_title}</span></div>'
        '</article>'
    )


def _standard_event_card(item: dict[str, object]) -> str:
    source = item.get("primary_source") or {}
    title = _display_title(item)
    summary = _display_teaser(item)
    return (
        '<article class="event-card">'
        f'<p class="kicker">{escape(_section_label(item.get("primary_section") or "ai_news"))}</p>'
        f'<h2><a href="{escape(event_href(item))}">{escape(title)}</a></h2>'
        f'<p class="card-summary">{escape(summary)}</p>'
        f'<div class="card-meta"><span>{escape(str(item["event_date"]))}</span><span>{escape(str(source.get("title") or "Источник"))}</span></div>'
        '</article>'
    )


def _compact_event_card(item: dict[str, object]) -> str:
    title = _display_title(item)
    summary = _display_teaser(item)
    return (
        '<article class="compact-card">'
        f'<h3><a href="{escape(event_href(item))}">{escape(title)}</a></h3>'
        f'<p>{escape(summary)}</p>'
        f'<div class="card-meta"><span>{escape(str(item["event_date"]))}</span></div>'
        '</article>'
    )


def _issue_feature_card(issue: dict[str, object]) -> str:
    return (
        '<article class="issue-feature-card">'
        f'<h3><a href="/issues/{issue["id"]}">{escape(str(issue["title"]))}</a></h3>'
        f'<p class="card-summary">Дата выпуска: {escape(str(issue["issue_date"]))}. '
        f'Внутри — срез по секциям и полный список карточек для чтения на сайте.</p>'
        f'<div class="card-meta"><span>{escape(str(issue["issue_type"]))}</span><span>{escape(str(issue["period_start"]))} — {escape(str(issue["period_end"]))}</span></div>'
        '</article>'
    )


def _issue_list_card(issue: dict[str, object]) -> str:
    return (
        '<article class="compact-card">'
        f'<h3><a href="/issues/{issue["id"]}">{escape(str(issue["title"]))}</a></h3>'
        f'<div class="card-meta"><span>{escape(str(issue["issue_date"]))}</span><span>{escape(str(issue["issue_type"]))}</span></div>'
        '</article>'
    )


def _issue_archive_card(issue: dict[str, object]) -> str:
    counts = issue.get("section_counts") or {}
    return (
        '<article class="issue-card">'
        f'<p class="kicker">{escape(str(issue["issue_type"]))}</p>'
        f'<h2><a href="/issues/{issue["id"]}">{escape(str(issue["title"]))}</a></h2>'
        f'<p class="card-summary">Дата: {escape(str(issue["issue_date"]))}. '
        f'Событий в all: {escape(str(counts.get("all", 0)))} · important: {escape(str(counts.get("important", 0)))}.</p>'
        f'<div class="card-meta"><span>{escape(str(issue["period_start"]))} — {escape(str(issue["period_end"]))}</span></div>'
        '</article>'
    )


def _issue_item_card(issue_id: int, item: dict[str, object]) -> str:
    summary = _POLICY.public_summary(
        str(item.get("card_text") or ""),
        title=str(item.get("card_title") or ""),
        section=str(item.get("section") or ""),
    )
    event_link = ""
    if item.get("event_id") is not None:
        event_link = f' · <a href="{escape(event_href(item))}">событие</a>'
    return (
        '<article class="issue-item-card">'
        f'<p class="kicker">{escape(_section_label(item["section"]))}</p>'
        f'<h2>{escape(_POLICY.public_title(str(item["card_title"] or "")))}</h2>'
        f'<p class="card-summary">{escape(summary)}</p>'
        f'<div class="card-meta"><span><a href="/issues/{issue_id}/sections/{item["section"]}">раздел</a>{event_link}</span></div>'
        '</article>'
    )


def _issue_main_event_card(item: dict[str, object]) -> str:
    title = _POLICY.public_title(str(item.get("title") or item.get("card_title") or ""))
    article = _display_article(item, paragraph_limit=3)
    lead = article[0] if article else _issue_item_one_line(item)
    continuation = article[1:] if len(article) > 1 else []
    href = event_href(item) if item.get("event_id") is not None else None
    headline = f'<h3><a href="{href}">{escape(title)}</a></h3>' if href else f"<h3>{escape(title)}</h3>"
    prose = "".join(f'<p class="issue-article-line">{escape(paragraph)}</p>' for paragraph in continuation)
    return (
        '<article class="issue-main-card">'
        f'{headline}'
        f'<p class="card-summary">{escape(lead)}</p>'
        f'{prose}'
        '</article>'
    )


def _issue_secondary_event_card(item: dict[str, object]) -> str:
    title = _POLICY.public_title(str(item.get("title") or item.get("card_title") or ""))
    line = _issue_item_one_line(item)
    href = event_href(item) if item.get("event_id") is not None else None
    headline = f'<h3><a href="{href}">{escape(title)}</a></h3>' if href else f"<h3>{escape(title)}</h3>"
    return (
        '<article class="compact-card issue-secondary-card">'
        f'{headline}'
        f'<p>{escape(line)}</p>'
        '</article>'
    )


def _alpha_card(item: dict[str, object]) -> str:
    return (
        '<article class="compact-card">'
        f'<h3><a href="/alpha">{escape(str(item["title"]))}</a></h3>'
        f'<p>{escape(str(item.get("body_short") or ""))}</p>'
        f'<div class="card-meta"><span>{escape(str(item["publish_date"]))}</span></div>'
        '</article>'
    )


def _alpha_page_card(item: dict[str, object]) -> str:
    body_long = str(item.get("body_long") or "")
    return (
        '<article class="event-card">'
        f'<p class="kicker">alpha</p>'
        f'<h2>{escape(str(item["title"]))}</h2>'
        f'<p class="card-summary">{escape(str(item.get("body_short") or ""))}</p>'
        f'<p class="muted">{escape(body_long)}</p>'
        f'<div class="card-meta"><span>{escape(str(item["publish_date"]))}</span></div>'
        '</article>'
    )


def select_site_russia_events(
    *,
    strict_items: list[dict[str, object]],
    broader_items: list[dict[str, object]],
    limit: int = 8,
    min_items: int = 4,
) -> list[dict[str, object]]:
    selected: list[dict[str, object]] = []
    seen_ids: set[int] = set()
    for item in strict_items:
        event_id = int(item["id"])
        if event_id in seen_ids:
            continue
        if not _is_russia_surface_candidate(item):
            continue
        selected.append(item)
        seen_ids.add(event_id)
        if len(selected) >= limit:
            return selected
    if len(selected) >= min_items:
        return selected[:limit]
    extras = sorted(
        (
            item
            for item in broader_items
            if int(item["id"]) not in seen_ids and _is_russia_surface_candidate(item)
        ),
        key=lambda item: (float(item.get("ranking_score") or 0), str(item.get("event_date") or "")),
        reverse=True,
    )
    for item in extras:
        selected.append(item)
        seen_ids.add(int(item["id"]))
        if len(selected) >= limit:
            break
    return selected[:limit]


def _is_russia_surface_candidate(item: dict[str, object]) -> bool:
    primary_source = item.get("primary_source") or {}
    region = str(primary_source.get("region") or "")
    if region != "russia" and not item.get("is_ai_in_russia"):
        return False
    if float(item.get("ranking_score") or 0) < 42:
        return False
    text = " ".join(
        [
            str(item.get("title") or ""),
            str(item.get("short_summary") or ""),
        ]
    ).lower()
    weak_tokens = ("форум", "премия", "выставк", "roadmap", "роадмап", "мероприят")
    strong_tokens = ("закон", "регулир", "гос", "минциф", "инфраструкт", "стек", "cloud", "рын", "платформ", "внедр")
    if any(token in text for token in weak_tokens) and not any(token in text for token in strong_tokens):
        return False
    return True


def _display_title(item: dict[str, object]) -> str:
    raw_title = str(item.get("title") or item.get("card_title") or "").strip()
    if _looks_like_russian_title(raw_title):
        return raw_title.rstrip(".")
    return _POLICY.public_title(raw_title)


def _display_summary(item: dict[str, object]) -> str:
    summary = _cleanup_public_text(
        _POLICY.public_summary(
        str(item.get("short_summary") or ""),
        title=str(item.get("title") or ""),
        section=str(item.get("primary_section") or ""),
        )
    )
    return summary if _is_meaningful_public_text(item, summary) else ""


def _display_long_summary(item: dict[str, object]) -> str:
    return _cleanup_public_text(
        _POLICY.public_long_summary(
        str(item.get("long_summary") or ""),
        title=str(item.get("title") or ""),
        short_summary=str(item.get("short_summary") or ""),
        section=str(item.get("primary_section") or ""),
        )
    )


def _display_article(item: dict[str, object], *, paragraph_limit: int | None = None) -> list[str]:
    article = _POLICY.build_article(
        title=str(item.get("title") or ""),
        short_summary=str(item.get("short_summary") or ""),
        long_summary=str(item.get("long_summary") or ""),
        section=str(item.get("primary_section") or item.get("section") or ""),
        primary_source_title=str((item.get("primary_source") or {}).get("title") or ""),
        categories=[str(category.get("section") or "") for category in (item.get("categories") or [])],
        tags=[str(tag.get("tag") or "") for tag in (item.get("tags") or [])],
        supporting_source_count=int(item.get("supporting_source_count") or 0),
        source_documents=[
            document
            for document in (item.get("source_documents") or [])
            if isinstance(document, dict)
        ],
    )
    paragraphs = [_cleanup_public_text(paragraph) for paragraph in article.paragraphs if paragraph]
    paragraphs = [paragraph for paragraph in paragraphs if paragraph]
    if paragraph_limit is not None:
        return paragraphs[:paragraph_limit]
    return paragraphs


def _display_teaser(item: dict[str, object]) -> str:
    summary = _display_summary(item)
    if summary:
        return summary
    article = _display_article(item, paragraph_limit=2)
    for paragraph in article:
        if _is_meaningful_public_text(item, paragraph):
            return paragraph
    fallback = _display_long_summary(item)
    if fallback and _is_meaningful_public_text(item, fallback):
        return fallback
    return ""


def _section_label(section: object) -> str:
    return _POLICY.public_section_label(None if section is None else str(section))


def _region_label(region: object) -> str:
    mapping = {
        "global": "Глобальный контур",
        "russia": "Россия",
    }
    key = None if region is None else str(region)
    return mapping.get(key, key or "Глобальный контур")


def _layout(title: str, body: str, *, description: str | None = None, path: str = "/") -> str:
    return _layout_with_meta(title=title, body=body, description=description or title, path=path)


def _layout_with_meta(*, title: str, body: str, description: str, path: str) -> str:
    page_title = title if title == "Malakhov AI Digest" else f"{title} | Malakhov AI Digest"
    meta_description = escape(_truncate(description, 180))
    canonical_url = f"{_SITE_BASE_URL}{path}"
    og_title = escape(page_title)
    return f"""<!doctype html>
<html lang="ru">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>{escape(page_title)}</title>
    <meta name="description" content="{meta_description}">
    <meta property="og:title" content="{og_title}">
    <meta property="og:description" content="{meta_description}">
    <meta property="og:type" content="website">
    <meta property="og:url" content="{escape(canonical_url)}">
    <link rel="canonical" href="{escape(canonical_url)}">
    <!-- Yandex.Metrika counter -->
    <script type="text/javascript">
      (function(m,e,t,r,i,k,a){{
          m[i]=m[i]||function(){{(m[i].a=m[i].a||[]).push(arguments)}};
          m[i].l=1*new Date();
          for (var j = 0; j < document.scripts.length; j++) {{if (document.scripts[j].src === r) {{ return; }}}}
          k=e.createElement(t),a=e.getElementsByTagName(t)[0],k.async=1,k.src=r,a.parentNode.insertBefore(k,a);
      }})(window, document, 'script', 'https://mc.yandex.ru/metrika/tag.js?id=107006613', 'ym');

      ym(107006613, 'init', {{
          ssr: true,
          webvisor: true,
          clickmap: true,
          ecommerce: "dataLayer",
          referrer: document.referrer,
          url: location.href,
          accurateTrackBounce: true,
          trackLinks: true
      }});
    </script>
    <!-- /Yandex.Metrika counter -->
    <style>
      :root {{
        --bg: #eef1fb;
        --bg-2: #f7f8fe;
        --panel: rgba(255, 255, 255, 0.88);
        --panel-strong: rgba(255, 255, 255, 0.96);
        --ink: #12172a;
        --muted: #69708a;
        --line: rgba(181, 190, 230, 0.62);
        --accent: #5c63ff;
        --accent-soft: rgba(116, 127, 255, 0.12);
        --shadow: 0 24px 80px rgba(92, 99, 255, 0.10);
      }}
      * {{ box-sizing: border-box; }}
      body {{
        margin: 0;
        color: var(--ink);
        background:
          radial-gradient(circle at 18% 16%, rgba(151, 166, 255, 0.26), transparent 24%),
          radial-gradient(circle at 82% 12%, rgba(202, 159, 255, 0.24), transparent 22%),
          linear-gradient(180deg, var(--bg-2) 0%, var(--bg) 100%);
        font-family: "Avenir Next", "Segoe UI", "Helvetica Neue", sans-serif;
      }}
      a {{ color: var(--accent); text-decoration: none; }}
      a:hover {{ text-decoration: underline; }}
      main {{ max-width: 1200px; margin: 0 auto; padding: 24px 18px 64px; }}
      .site-header {{
        display: flex; gap: 24px; justify-content: space-between; align-items: end;
        padding: 18px 0 26px; border-bottom: 1px solid var(--line); margin-bottom: 24px;
      }}
      .brand {{ font-size: 1.8rem; font-weight: 700; color: var(--ink); }}
      .brand-subtitle {{ margin: 6px 0 0; color: var(--muted); max-width: 46ch; }}
      .site-nav {{ display: flex; flex-wrap: wrap; gap: 10px; }}
      .nav-link {{
        padding: 8px 12px; border-radius: 999px; border: 1px solid var(--line);
        background: rgba(255,255,255,0.52); color: var(--ink); font-size: 0.95rem;
      }}
      .nav-link.active {{ background: var(--accent); border-color: var(--accent); color: #fff8f3; }}
      .hero-block, .homepage-block, .page-header, .event-card, .featured-card, .compact-card, .issue-card, .issue-feature-card, .issue-item-card, .detail-page, .section-nav-block {{
        background: var(--panel); border: 1px solid var(--line); border-radius: 20px;
        box-shadow: var(--shadow);
        backdrop-filter: blur(16px);
      }}
      .hero-block {{
        display: grid; grid-template-columns: 1.35fr 0.75fr; gap: 24px; padding: 28px; margin-bottom: 24px;
        position: relative;
        overflow: hidden;
        border-radius: 30px;
      }}
      .hero-block::after {{
        content: "";
        position: absolute;
        width: 360px;
        height: 360px;
        right: 18%;
        top: 50%;
        transform: translateY(-50%);
        border-radius: 50%;
        background:
          radial-gradient(circle at 50% 48%, rgba(140, 107, 255, 0.34), transparent 38%),
          radial-gradient(circle at 32% 32%, rgba(255, 255, 255, 0.76), transparent 42%),
          radial-gradient(circle at 68% 72%, rgba(120, 227, 243, 0.30), transparent 34%);
        filter: blur(10px);
        pointer-events: none;
      }}
      .hero-copy, .hero-meta {{ position: relative; z-index: 1; }}
      .hero-copy h1 {{ font-size: clamp(2.4rem, 4vw, 4.3rem); line-height: 0.95; margin: 0 0 14px; max-width: 10ch; }}
      .hero-lede, .page-lede, .card-summary, .detail-lede {{ color: var(--muted); line-height: 1.5; }}
      .hero-meta {{ display: grid; gap: 12px; align-content: start; }}
      .metric {{ background: var(--panel-strong); border-radius: 22px; padding: 18px; border: 1px solid rgba(154, 164, 214, 0.35); }}
      .metric-value {{ display: block; font-size: 2rem; line-height: 1; margin-bottom: 4px; }}
      .metric-label {{ color: var(--muted); }}
      .homepage-grid {{ display: grid; grid-template-columns: 1.45fr 0.85fr; gap: 22px; }}
      .feature-layout {{ display: grid; grid-template-columns: 1.2fr 0.8fr; gap: 18px; padding: 22px; }}
      .feature-side {{ display: grid; gap: 12px; }}
      .primary-column, .secondary-column, .feed-grid {{ display: grid; gap: 18px; }}
      .homepage-block, .page-header, .section-nav-block {{ padding: 22px; }}
      .page-header h1 {{ font-size: clamp(1.8rem, 3vw, 3rem); line-height: 1.02; margin: 0 0 10px; }}
      .block-head {{ display: flex; justify-content: space-between; align-items: baseline; gap: 12px; margin-bottom: 14px; }}
      .issue-intro {{ margin: 0; color: var(--muted); line-height: 1.65; max-width: 72ch; }}
      .block-head h2, .featured-card h2, .event-card h2, .issue-card h2, .issue-item-card h2 {{ margin: 0 0 10px; line-height: 1.08; }}
      .compact-card h3, .issue-feature-card h3 {{ margin: 0 0 8px; font-size: 1.05rem; line-height: 1.2; }}
      .featured-card, .event-card, .compact-card, .issue-card, .issue-feature-card, .issue-item-card {{ padding: 18px; background: var(--panel-strong); }}
      .issue-main-card {{ padding: 22px; border: 1px solid var(--line); border-radius: 22px; background: var(--panel-strong); box-shadow: inset 0 1px 0 rgba(255,255,255,0.5); }}
      .issue-main-card h3 {{ margin: 0 0 10px; font-size: 1.5rem; line-height: 1.12; }}
      .issue-why {{ margin: 12px 0 0; color: var(--muted); line-height: 1.55; }}
      .issue-consequence {{ margin: 10px 0 0; color: var(--muted); line-height: 1.55; }}
      .issue-secondary-grid {{ display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; margin-top: 14px; }}
      .issue-secondary-card h3 {{ margin: 0 0 8px; font-size: 1rem; line-height: 1.2; }}
      .featured-card h2 {{ font-size: clamp(1.7rem, 2.8vw, 2.4rem); }}
      .event-card h2, .issue-card h2, .issue-item-card h2 {{ font-size: 1.35rem; }}
      .kicker {{ margin: 0 0 10px; font-size: 0.74rem; text-transform: uppercase; letter-spacing: 0.11em; color: #6c73a8; font-weight: 700; }}
      .card-meta, .detail-meta, .muted {{ color: var(--muted); font-size: 0.93rem; }}
      .card-meta {{ display: flex; flex-wrap: wrap; gap: 10px; margin-top: 12px; }}
      .feed-grid {{ grid-template-columns: repeat(2, minmax(0, 1fr)); }}
      .detail-page {{ display: grid; grid-template-columns: 1.5fr 0.75fr; gap: 22px; padding: 24px; }}
      .detail-main {{ display: grid; gap: 18px; }}
      .content-block {{ border-top: 1px solid var(--line); padding-top: 16px; }}
      .content-block h2 {{ margin: 0 0 10px; font-size: 1.15rem; }}
      .content-block p {{ max-width: 72ch; line-height: 1.65; margin: 0; }}
      .detail-prose {{ display: grid; gap: 12px; }}
      .detail-prose p {{ max-width: 72ch; line-height: 1.7; margin: 0; }}
      .related-grid {{ grid-template-columns: 1fr; gap: 12px; }}
      .continue-reading-group + .continue-reading-group {{ margin-top: 18px; }}
      .continue-reading-group h3 {{ margin: 0 0 10px; font-size: 1rem; }}
      .issue-flow-nav {{ display: flex; flex-wrap: wrap; gap: 12px; }}
      .flow-link {{
        display: inline-flex; padding: 9px 12px; border-radius: 999px;
        border: 1px solid var(--line); background: rgba(255,255,255,0.82); color: var(--ink); font-size: 0.92rem;
      }}
      .detail-side {{ display: grid; gap: 14px; align-content: start; }}
      .meta-panel {{ border: 1px solid var(--line); border-radius: 18px; padding: 16px; background: rgba(255,255,255,0.9); }}
      .meta-panel h2 {{ margin: 0 0 10px; font-size: 1rem; }}
      .tag-row {{ display: flex; flex-wrap: wrap; gap: 8px; }}
      .tag-row span, .section-pill {{
        display: inline-flex; padding: 7px 11px; border-radius: 999px;
        border: 1px solid var(--line); background: rgba(255,255,255,0.82); color: var(--ink); font-size: 0.9rem;
      }}
      .pager {{ display: flex; align-items: center; gap: 12px; padding: 10px 4px 0; }}
      .pager-link {{
        display: inline-flex; padding: 8px 12px; border-radius: 999px;
        border: 1px solid var(--line); background: rgba(255,255,255,0.78); color: var(--ink); font-size: 0.92rem;
      }}
      .pager-current {{ color: var(--muted); font-size: 0.92rem; }}
      .empty-state {{ color: var(--muted); margin: 0; }}
      @media (max-width: 980px) {{
        .hero-block, .homepage-grid, .feature-layout, .detail-page {{ grid-template-columns: 1fr; }}
        .feed-grid {{ grid-template-columns: 1fr; }}
        .issue-secondary-grid {{ grid-template-columns: 1fr; }}
        .site-header {{ align-items: start; flex-direction: column; }}
      }}
    </style>
  </head>
  <body>
    <noscript><div><img src="https://mc.yandex.ru/watch/107006613" style="position:absolute; left:-9999px;" alt=""></div></noscript>
    <main>{body}</main>
  </body>
</html>"""


def _split_sentences(text: str) -> list[str]:
    return [
        _cleanup_public_phrase(part.strip())
        for part in _SENTENCE_RE.split(text)
        if part.strip()
    ]


def _cleanup_public_phrase(text: str) -> str:
    cleaned = text.strip().rstrip(".!?")
    replacements = (
        ("Это может повлиять на", "Это влияет на"),
        ("это может повлиять на", "это влияет на"),
        ("Это помогает понять", "Рынок уже показывает"),
        ("это помогает понять", "рынок уже показывает"),
        ("Это позволяет", "Такой шаг ускоряет"),
        ("это позволяет", "такой шаг ускоряет"),
        ("данное ", ""),
        ("Данное ", ""),
    )
    for source, target in replacements:
        cleaned = cleaned.replace(source, target)
    cleaned = re.sub(r"\bне [^,.!?;:]{1,50}, а ([^.!?]{1,80})", r"\1", cleaned, flags=re.IGNORECASE)
    return f"{cleaned}." if cleaned else ""


def _cleanup_public_text(text: str) -> str:
    return " ".join(part for part in (_cleanup_public_phrase(sentence) for sentence in _split_sentences(text)) if part)


def _normalized_public_text(text: str) -> str:
    return _MULTISPACE_RE.sub(" ", re.sub(r"[^\w\s]", " ", text.lower())).strip()


def _looks_like_title_repeat(title: str, text: str) -> bool:
    if not title or not text:
        return False
    normalized_title = _normalized_public_text(title)
    normalized_text = _normalized_public_text(text)
    if not normalized_title or not normalized_text:
        return False
    if normalized_text == normalized_title:
        return True
    return normalized_text.startswith(f"{normalized_title} {normalized_title}")


def _has_bad_public_pattern(text: str) -> bool:
    normalized = _normalized_public_text(text)
    return any(_normalized_public_text(pattern) in normalized for pattern in _BAD_PUBLIC_PATTERNS)


def _looks_like_russian_title(text: str) -> bool:
    cyrillic_count = sum(1 for char in text.lower() if "а" <= char <= "я" or char == "ё")
    latin_count = sum(1 for char in text.lower() if "a" <= char <= "z")
    return cyrillic_count >= 8 and cyrillic_count >= latin_count


def _is_meaningful_public_text(item: dict[str, object], text: str) -> bool:
    cleaned = _cleanup_public_text(text)
    if not cleaned:
        return False
    title = _display_title(item)
    if _looks_like_title_repeat(title, cleaned):
        return False
    if _has_bad_public_pattern(cleaned):
        return False
    if len(_normalized_public_text(cleaned)) < 24:
        return False
    return True


def is_publishable_site_item(item: dict[str, object], *, require_event: bool = False) -> bool:
    if require_event and item.get("event_id") is None:
        return False
    ranking_value = item.get("ranking_score")
    ranking_score = float(ranking_value or 0) if ranking_value is not None else None
    if ranking_score is not None and ranking_score < 40:
        return False
    if item.get("event_id") is not None and ranking_score is not None and ranking_score <= 0:
        return False
    title = _display_title(item)
    if not title:
        return False
    if _PLACEHOLDER_TITLE_RE.search(title):
        return False
    if _has_bad_public_pattern(title):
        return False
    combined_text = _normalized_public_text(
        " ".join(
            [
                title,
                str(item.get("short_summary") or ""),
                str(item.get("card_text") or ""),
            ]
        )
    )
    if any(token in combined_text for token in _WEAK_PUBLIC_TOKENS) and not any(token in combined_text for token in _STRONG_PUBLIC_TOKENS):
        return False
    teaser = _display_teaser(item)
    if teaser:
        return True
    article = _display_article(item, paragraph_limit=2)
    return any(_is_meaningful_public_text(item, paragraph) for paragraph in article)


def filter_publishable_site_items(
    items: list[dict[str, object]],
    *,
    require_event: bool = False,
) -> list[dict[str, object]]:
    return [item for item in items if is_publishable_site_item(item, require_event=require_event)]


def build_event_slug(item: dict[str, object]) -> str:
    event_id = int(item.get("id") or item.get("event_id") or 0)
    title = _display_title(item) or str(item.get("card_title") or "event")
    normalized = title.lower().translate(_CYRILLIC_TO_LATIN)
    normalized = _NON_SLUG_RE.sub("-", normalized).strip("-")
    slug = normalized[:80].strip("-") or f"event-{event_id}"
    return f"{slug}-{event_id}"


def event_href(item: dict[str, object]) -> str:
    return f'/events/{build_event_slug(item)}'


def _truncate(text: str, limit: int) -> str:
    value = " ".join(text.split())
    if len(value) <= limit:
        return value
    return value[: limit - 1].rstrip() + "…"


def _meta_description(title: str, summary: str) -> str:
    return _truncate(f"{title}. {summary}".strip(), 180)


def _path_with_query(path: str, **params: object) -> str:
    clean = {key: value for key, value in params.items() if value not in (None, "", 1)}
    if not clean:
        return path
    return f"{path}?{urlencode(clean)}"


def _pagination(base_path: str, *, page: int, has_next: bool) -> str:
    if page <= 1 and not has_next:
        return ""
    parts = ['<nav class="pager">']
    if page > 1:
        parts.append(f'<a class="pager-link" href="{escape(_path_with_query(base_path, page=page - 1))}">← Назад</a>')
    parts.append(f'<span class="pager-current">Страница {page}</span>')
    if has_next:
        parts.append(f'<a class="pager-link" href="{escape(_path_with_query(base_path, page=page + 1))}">Дальше →</a>')
    parts.append("</nav>")
    return "".join(parts)


def build_issue_editorial_sections(*, items: list[dict[str, object]]) -> list[dict[str, object]]:
    buckets: dict[str, list[dict[str, object]]] = {
        "ai_news": [],
        "coding": [],
        "investments": [],
        "russia": [],
    }
    seen_by_section: dict[str, set[int]] = {key: set() for key in buckets}

    for item in items:
        if not is_publishable_site_item(item, require_event=True):
            continue
        for target in _issue_editorial_targets(item):
            event_id = int(item.get("event_id") or 0) if item.get("event_id") is not None else None
            if event_id is not None and event_id in seen_by_section[target]:
                continue
            buckets[target].append(item)
            if event_id is not None:
                seen_by_section[target].add(event_id)

    ordered_sections = [
        ("ai_news", "Новости ИИ", "ai_news"),
        ("coding", "Инструменты", "coding"),
        ("investments", "Инвестиции", "investments"),
        ("russia", "ИИ в России", "all"),
    ]
    result: list[dict[str, object]] = []
    for slug, title, source_section in ordered_sections:
        section_items = buckets[slug]
        if not section_items:
            continue
        main_item = next((item for item in section_items if bool(item.get("is_primary_block"))), section_items[0])
        secondary_items = [item for item in section_items if item is not main_item][:3]
        result.append(
            {
                "slug": slug,
                "title": title,
                "source_section": source_section,
                "count": len(section_items),
                "main_item": main_item,
                "secondary_items": secondary_items,
            }
        )
    return result


def build_issue_intro(issue: dict[str, object], editorial_sections: list[dict[str, object]]) -> str:
    titles = [section["title"] for section in editorial_sections]
    if not titles:
        return "Сегодня AI-рынок меняется сразу в продуктах, инфраструктуре и корпоративных сценариях. Компании уже пересматривают ставки на платформы, бюджеты и скорость внедрения."
    if len(titles) == 1:
        scope = titles[0].lower()
    elif len(titles) == 2:
        scope = f"{titles[0].lower()} и {titles[1].lower()}"
    else:
        scope = ", ".join(title.lower() for title in titles[:-1]) + f" и {titles[-1].lower()}"
    return f"Сегодня в центре внимания {scope}: новые релизы, инструменты и стратегические шаги уже меняют выбор платформ, бюджеты и продуктовые решения компаний. Дальше рынок ответит ускорением конкуренции, новыми партнерствами и более жестким отбором AI-ставок."


def _issue_editorial_targets(item: dict[str, object]) -> list[str]:
    targets: list[str] = []
    section = str(item.get("section") or item.get("primary_section") or "")
    if section in {"important", "ai_news"}:
        targets.append("ai_news")
    elif section == "coding":
        targets.append("coding")
    elif section == "investments":
        targets.append("investments")
    if bool(item.get("is_ai_in_russia")):
        targets.append("russia")
    return targets


def _issue_item_one_line(item: dict[str, object]) -> str:
    summary = _display_teaser(item)
    parts = _split_sentences(summary)
    return parts[0] if parts else summary


def _issue_item_why_matters(item: dict[str, object]) -> str:
    summary = _POLICY.public_summary(
        str(item.get("short_summary") or item.get("card_text") or ""),
        title=str(item.get("title") or item.get("card_title") or ""),
        section=str(item.get("primary_section") or item.get("section") or ""),
    )
    parts = _split_sentences(summary)
    if len(parts) >= 2:
        return parts[1]
    section = str(item.get("primary_section") or item.get("section") or "")
    if section == "investments":
        return "Это влияет на оценки рынка, доступ к капиталу и стратегические ожидания инвесторов."
    if section == "coding":
        return "Это меняет рабочие сценарии команд и влияет на скорость вывода AI-функций в продукт."
    if bool(item.get("is_ai_in_russia")):
        return "Это влияет на локальный рынок, корпоративные бюджеты и конфигурацию AI-инфраструктуры."
    return "Это влияет на рынок, конкуренцию и решения компаний, которые строят или покупают AI-продукты."


def _issue_item_consequences(item: dict[str, object]) -> str:
    section = str(item.get("primary_section") or item.get("section") or "")
    if section == "investments":
        return "Компании пересмотрят ожидания по капиталу и партнерствам, а рынок — оценки и приоритетные направления роста."
    if section == "coding":
        return "Команды быстрее пересобирают workflow, а поставщики инструментов вынуждены отвечать новыми функциями и ценой."
    if bool(item.get("is_ai_in_russia")):
        return "Локальный рынок будет перестраивать бюджеты, инфраструктуру и требования к поставщикам."
    return "Компании будут пересматривать продуктовые дорожные карты, а рынок — ожидания по скорости внедрения и конкурентной позиции."
