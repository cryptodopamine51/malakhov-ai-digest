from __future__ import annotations

from datetime import date

from app.db.models import DigestIssue, DigestIssueItem, DigestSection
from app.services.rendering import TelegramRenderingService

SECTION_TITLES = {
    DigestSection.IMPORTANT: "Важное",
    DigestSection.AI_NEWS: "Новости ИИ",
    DigestSection.CODING: "Кодинг",
    DigestSection.INVESTMENTS: "Инвестиции",
    DigestSection.ALPHA: "Альфа",
    DigestSection.ALL: "Все за день",
}
DAILY_SECTION_ORDER = [
    DigestSection.IMPORTANT,
    DigestSection.AI_NEWS,
    DigestSection.CODING,
    DigestSection.INVESTMENTS,
    DigestSection.ALPHA,
]
DAILY_SECTION_LIMIT = 3
WEEKLY_LIMIT = 5

_rendering = TelegramRenderingService()


def render_daily_main(issue: DigestIssue, items_by_section: dict[DigestSection, list[DigestIssueItem]]) -> list[str]:
    header = f"<b>Malakhov AI Digest • {_format_date(issue.issue_date)}</b>"
    section_blocks = []
    has_non_empty_signal_section = any(
        items_by_section.get(section) and not _is_empty_section(items_by_section.get(section, []))
        for section in (DigestSection.AI_NEWS, DigestSection.CODING, DigestSection.INVESTMENTS)
    )
    for section in DAILY_SECTION_ORDER:
        items = items_by_section.get(section, [])[:DAILY_SECTION_LIMIT]
        if section is DigestSection.IMPORTANT and has_non_empty_signal_section and _is_empty_section(items):
            continue
        if section is DigestSection.ALPHA and _is_empty_section(items):
            continue
        if not items and section not in (DigestSection.IMPORTANT, DigestSection.ALPHA):
            continue
        if _is_empty_section(items) and section not in (DigestSection.IMPORTANT, DigestSection.ALPHA):
            continue
        section_blocks.append(_render_section_block(section, items))
    return _rendering.chunk_blocks(header, section_blocks)


def render_weekly_main(issue: DigestIssue, items: list[DigestIssueItem]) -> list[str]:
    header = f"<b>Malakhov AI Digest • {_format_date(issue.issue_date)}</b>\n<b>Итоги недели</b>"
    blocks = [_render_item(item, DigestSection.ALL) for item in items[:WEEKLY_LIMIT]]
    return _rendering.chunk_blocks(header, blocks)


def render_section(issue: DigestIssue, section: DigestSection, items: list[DigestIssueItem]) -> list[str]:
    header = f"<b>{SECTION_TITLES[section]} • {_format_date(issue.issue_date)}</b>"
    blocks = [_render_item(item, section) for item in items]
    return _rendering.chunk_blocks(header, blocks)


def _render_section_block(section: DigestSection, items: list[DigestIssueItem]) -> str:
    title = SECTION_TITLES[section]
    rendered_items = "\n\n".join(_render_item(item, section) for item in items)
    return f"<b>{title}</b>\n{rendered_items}".strip()


def _render_item(item: DigestIssueItem, section: DigestSection) -> str:
    title = _rendering.escape_text(_rendering.compact_headline(item.card_title))
    if item.event_id is None and not item.card_links_json:
        summary = _rendering.escape_text(_rendering.trim_text(item.card_text, 220))
        return f"• <b>{title}</b>\n{summary}"

    summary = _rendering.escape_text(
        _rendering.compact_summary(item.card_text, section_title=SECTION_TITLES[section])
    )
    links = _rendering.format_source_links(item.card_links_json or [])
    source_suffix = f" {links}" if links else ""
    return f"• <b>{title}</b>\n{summary}{source_suffix}"


def _format_date(value: date) -> str:
    months = {
        1: "января",
        2: "февраля",
        3: "марта",
        4: "апреля",
        5: "мая",
        6: "июня",
        7: "июля",
        8: "августа",
        9: "сентября",
        10: "октября",
        11: "ноября",
        12: "декабря",
    }
    return f"{value.day} {months[value.month]}"


def _is_empty_section(items: list[DigestIssueItem]) -> bool:
    return len(items) == 1 and items[0].event_id is None and items[0].alpha_entry_id is None
