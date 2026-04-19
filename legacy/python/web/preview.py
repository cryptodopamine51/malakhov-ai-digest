from __future__ import annotations

from html import escape


def render_homepage_preview(*, issues: list[dict[str, object]], events: list[dict[str, object]], alpha_items: list[dict[str, object]]) -> str:
    lead_issue = issues[0] if issues else None
    body = [
        '<section class="hero">',
        "<p class=\"eyebrow\">Malakhov AI Digest</p>",
        "<h1>Internal Web Preview</h1>",
        "<p class=\"lede\">Плотный медиаслой на shared event/publication model. Telegram остается best-of слоем.</p>",
        "</section>",
    ]
    if lead_issue is not None:
        body.extend(
            [
                '<section class="panel">',
                f"<h2>Latest issue</h2><p><a href=\"/preview/issues/{lead_issue['id']}\">{escape(str(lead_issue['title']))}</a></p>",
                f"<p class=\"meta\">{escape(str(lead_issue['issue_date']))} • {escape(str(lead_issue['issue_type']))}</p>",
                "</section>",
            ]
        )
    body.append('<section class="grid">')
    body.append('<div class="column">')
    body.append("<h2>Events feed</h2>")
    for item in events[:8]:
        body.append(_event_card(item))
    body.append("</div>")
    body.append('<div class="column">')
    body.append("<h2>Published issues</h2>")
    for issue in issues[:8]:
        body.append(
            f'<article class="mini-card"><a href="/preview/issues/{issue["id"]}">{escape(str(issue["title"]))}</a>'
            f'<div class="meta">{escape(str(issue["issue_date"]))}</div></article>'
        )
    if alpha_items:
        body.append("<h2>Alpha</h2>")
        for item in alpha_items[:4]:
            body.append(
                f'<article class="mini-card"><a href="/preview/alpha">{escape(str(item["title"]))}</a>'
                f'<div class="meta">{escape(str(item["publish_date"]))}</div></article>'
            )
    body.append("</div>")
    body.append("</section>")
    return _layout("Internal Preview", "".join(body))


def render_events_feed_page(*, events: list[dict[str, object]]) -> str:
    body = [
        "<header><p class=\"eyebrow\">Events feed</p><h1>Все события</h1><p class=\"lede\">Более плотный слой, чем Telegram daily.</p></header>",
        '<section class="stack">',
    ]
    for item in events:
        body.append(_event_card(item))
    body.append("</section>")
    return _layout("Events Feed", "".join(body))


def render_event_detail_page(*, item: dict[str, object]) -> str:
    primary_source = item.get("primary_source") or {}
    categories = item.get("categories") or []
    tags = item.get("tags") or []
    body = [
        "<article class=\"detail\">",
        f"<p class=\"eyebrow\">Event detail</p><h1>{escape(str(item['title']))}</h1>",
        f"<p class=\"meta\">{escape(str(item['event_date']))} • ranking {escape(str(item['ranking_score']))}</p>",
    ]
    if item.get("short_summary"):
        body.append(f"<p class=\"summary\">{escape(str(item['short_summary']))}</p>")
    if item.get("long_summary"):
        body.append(f"<div class=\"prose\"><p>{escape(str(item['long_summary']))}</p></div>")
    if primary_source:
        body.append(
            f"<p class=\"meta\">Source: {escape(str(primary_source.get('title')))}"
            f"{' • ' + escape(str(primary_source.get('region'))) if primary_source.get('region') else ''}</p>"
        )
    if categories:
        body.append("<div class=\"chips\">" + "".join(f"<span>{escape(str(cat['section']))}</span>" for cat in categories) + "</div>")
    if tags:
        body.append("<div class=\"chips muted\">" + "".join(f"<span>{escape(str(tag['tag']))}</span>" for tag in tags[:12]) + "</div>")
    body.append("</article>")
    return _layout(str(item["title"]), "".join(body))


def render_issue_detail_page(*, issue: dict[str, object], sections: list[dict[str, object]], items: list[dict[str, object]]) -> str:
    body = [
        f"<header><p class=\"eyebrow\">Issue</p><h1>{escape(str(issue['title']))}</h1>",
        f"<p class=\"meta\">{escape(str(issue['issue_date']))} • {escape(str(issue['issue_type']))}</p></header>",
        '<section class="panel"><h2>Sections</h2><div class="chips">',
    ]
    for section in sections:
        body.append(
            f'<a class="chip-link" href="/preview/issues/{issue["id"]}/sections/{section["section"]}">'
            f'{escape(str(section["section"]))} ({escape(str(section["event_count"]))})</a>'
        )
    body.append("</div></section>")
    body.append('<section class="stack">')
    for item in items:
        body.append(_issue_item_card(issue["id"], item))
    body.append("</section>")
    return _layout(str(issue["title"]), "".join(body))


def render_issue_section_page(*, issue: dict[str, object], section: str, items: list[dict[str, object]]) -> str:
    body = [
        f"<header><p class=\"eyebrow\">Issue section</p><h1>{escape(section)}</h1>",
        f"<p class=\"meta\"><a href=\"/preview/issues/{issue['id']}\">{escape(str(issue['title']))}</a></p></header>",
        '<section class="stack">',
    ]
    for item in items:
        body.append(_issue_item_card(issue["id"], item))
    body.append("</section>")
    return _layout(f"{issue['title']} • {section}", "".join(body))


def render_alpha_page(*, items: list[dict[str, object]]) -> str:
    body = [
        "<header><p class=\"eyebrow\">Alpha</p><h1>Published alpha</h1></header>",
        '<section class="stack">',
    ]
    for item in items:
        body.append(
            "<article class=\"card\">"
            f"<h2>{escape(str(item['title']))}</h2>"
            f"<p>{escape(str(item['body_short']))}</p>"
            f"<p class=\"meta\">{escape(str(item['publish_date']))}</p>"
            "</article>"
        )
    body.append("</section>")
    return _layout("Alpha", "".join(body))


def _event_card(item: dict[str, object]) -> str:
    section = item.get("primary_section") or "event"
    summary = escape(str(item.get("short_summary") or ""))
    return (
        "<article class=\"card\">"
        f"<p class=\"eyebrow\">{escape(str(section))}</p>"
        f"<h2><a href=\"/preview/events/{item['id']}\">{escape(str(item['title']))}</a></h2>"
        f"<p>{summary}</p>"
        f"<p class=\"meta\">{escape(str(item['event_date']))} • ranking {escape(str(item.get('ranking_score')))}</p>"
        "</article>"
    )


def _issue_item_card(issue_id: int, item: dict[str, object]) -> str:
    title = escape(str(item["card_title"]))
    text = escape(str(item["card_text"]))
    meta_bits = [escape(str(item["section"]))]
    if item.get("event_id") is not None:
        meta_bits.append(f'<a href="/preview/events/{item["event_id"]}">event #{item["event_id"]}</a>')
    return (
        "<article class=\"card\">"
        f"<h2>{title}</h2>"
        f"<p>{text}</p>"
        f"<p class=\"meta\">{' • '.join(meta_bits)}</p>"
        f"<p class=\"meta\"><a href=\"/preview/issues/{issue_id}/sections/{item['section']}\">Open section</a></p>"
        "</article>"
    )


def _layout(title: str, body: str) -> str:
    return f"""<!doctype html>
<html lang="ru">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>{escape(title)}</title>
    <style>
      :root {{
        --bg: #f4efe5;
        --panel: #fffdf8;
        --ink: #171411;
        --muted: #6f665d;
        --line: #d8cfc2;
        --accent: #9c3d16;
      }}
      * {{ box-sizing: border-box; }}
      body {{
        margin: 0;
        font-family: Georgia, "Times New Roman", serif;
        background: linear-gradient(180deg, #f7f2e9 0%, #efe6d8 100%);
        color: var(--ink);
      }}
      main {{ max-width: 1080px; margin: 0 auto; padding: 32px 20px 80px; }}
      a {{ color: var(--accent); text-decoration: none; }}
      a:hover {{ text-decoration: underline; }}
      h1, h2 {{ margin: 0 0 12px; line-height: 1.05; }}
      h1 {{ font-size: clamp(2rem, 4vw, 3.4rem); }}
      h2 {{ font-size: 1.35rem; }}
      p {{ margin: 0 0 12px; line-height: 1.45; }}
      header, .hero, .panel, .card, .mini-card, .detail {{ background: var(--panel); border: 1px solid var(--line); border-radius: 18px; padding: 20px; }}
      .hero {{ margin-bottom: 20px; }}
      .grid {{ display: grid; grid-template-columns: 1.5fr 1fr; gap: 20px; align-items: start; }}
      .column, .stack {{ display: grid; gap: 16px; }}
      .panel {{ margin-bottom: 20px; }}
      .eyebrow {{ text-transform: uppercase; letter-spacing: 0.08em; color: var(--muted); font-size: 0.72rem; font-weight: 700; }}
      .lede, .meta {{ color: var(--muted); }}
      .chips {{ display: flex; flex-wrap: wrap; gap: 8px; }}
      .chips span, .chip-link {{ display: inline-flex; padding: 6px 10px; border: 1px solid var(--line); border-radius: 999px; font-size: 0.86rem; background: #fbf6ee; }}
      .muted span {{ color: var(--muted); }}
      .prose p {{ max-width: 72ch; }}
      @media (max-width: 780px) {{
        .grid {{ grid-template-columns: 1fr; }}
      }}
    </style>
  </head>
  <body>
    <main>{body}</main>
  </body>
</html>"""
