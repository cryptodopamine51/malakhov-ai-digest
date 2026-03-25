from __future__ import annotations

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

_rendering = TelegramRenderingService()


def render_daily_main(issue: DigestIssue, items: list[DigestIssueItem]) -> list[str]:
    return _render_issue(issue, DigestSection.IMPORTANT, items)


def render_weekly_main(issue: DigestIssue, items: list[DigestIssueItem]) -> list[str]:
    header = f"<b>{_rendering.escape_text(issue.title)}</b>\n\n<b>Итоги недели</b>"
    return _join_render(header, items)


def render_section(issue: DigestIssue, section: DigestSection, items: list[DigestIssueItem]) -> list[str]:
    return _render_issue(issue, section, items)


def _render_issue(issue: DigestIssue, section: DigestSection, items: list[DigestIssueItem]) -> list[str]:
    header = f"<b>{_rendering.escape_text(issue.title)}</b>\n\n<b>{SECTION_TITLES[section]}</b>"
    return _join_render(header, items)


def _join_render(header: str, items: list[DigestIssueItem]) -> list[str]:
    blocks: list[str] = []
    for item in items:
        links = item.card_links_json or []
        source_line = f"\nИсточник: {_rendering.escape_text(links[0])}" if links else ""
        blocks.append(
            f"<b>{_rendering.escape_text(item.card_title)}</b>\n"
            f"{_rendering.escape_text(item.card_text)}{source_line}"
        )
    return _rendering.chunk_blocks(header, blocks)
