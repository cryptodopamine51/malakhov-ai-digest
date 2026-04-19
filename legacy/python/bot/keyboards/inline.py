from aiogram.types import InlineKeyboardButton, InlineKeyboardMarkup

from app.db.models import DigestSection


def daily_sections_keyboard(issue_id: int) -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(
        inline_keyboard=[
            [
                InlineKeyboardButton(text="Новости ИИ", callback_data=f"issue:{issue_id}:{DigestSection.AI_NEWS.value}"),
                InlineKeyboardButton(text="Кодинг", callback_data=f"issue:{issue_id}:{DigestSection.CODING.value}"),
            ],
            [
                InlineKeyboardButton(text="Инвестиции", callback_data=f"issue:{issue_id}:{DigestSection.INVESTMENTS.value}"),
                InlineKeyboardButton(text="Альфа", callback_data=f"issue:{issue_id}:{DigestSection.ALPHA.value}"),
            ],
            [
                InlineKeyboardButton(text="Все за день", callback_data=f"issue:{issue_id}:{DigestSection.ALL.value}"),
                InlineKeyboardButton(text="О боте", callback_data=f"about:{issue_id}"),
            ],
        ]
    )
