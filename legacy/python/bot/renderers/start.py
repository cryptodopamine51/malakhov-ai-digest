from __future__ import annotations

from app.db.models import SubscriptionMode
from app.services.rendering import TelegramRenderingService

_rendering = TelegramRenderingService()


def render_start_welcome(current_mode: SubscriptionMode | None) -> list[str]:
    mode_hint = ""
    if current_mode is SubscriptionMode.DAILY:
        mode_hint = "\n\nТекущий режим: каждый день."
    elif current_mode is SubscriptionMode.WEEKLY:
        mode_hint = "\n\nТекущий режим: только еженедельные сводки."

    text = (
        "Добро пожаловать в Malakhov AI Digest.\n\n"
        "Здесь я собираю главное по ИИ:\n"
        "— важные обновления рынка,\n"
        "— новости ИИ,\n"
        "— кодинг и инструменты,\n"
        "— инвестиции,\n"
        "— авторский раздел «Альфа».\n\n"
        "Выбери, как тебе удобно получать дайджест: каждый день или только еженедельные сводки."
        f"{mode_hint}"
    )
    return _rendering.chunk_blocks(_rendering.escape_text(text), [])
