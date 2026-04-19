from aiogram.types import KeyboardButton, ReplyKeyboardMarkup

from app.bot.keyboards.buttons import (
    MENU_ABOUT_BUTTON,
    MENU_SETTINGS_BUTTON,
    MENU_TODAY_BUTTON,
    MENU_WEEKLY_BUTTON,
    ONBOARDING_DAILY_BUTTON,
    ONBOARDING_WEEKLY_BUTTON,
    SETTINGS_BACK_BUTTON,
    SETTINGS_DAILY_BUTTON,
    SETTINGS_WEEKLY_BUTTON,
)


def onboarding_keyboard() -> ReplyKeyboardMarkup:
    return ReplyKeyboardMarkup(
        keyboard=[
            [KeyboardButton(text=ONBOARDING_DAILY_BUTTON)],
            [KeyboardButton(text=ONBOARDING_WEEKLY_BUTTON)],
            [KeyboardButton(text=MENU_ABOUT_BUTTON)],
        ],
        resize_keyboard=True,
    )


def main_menu_keyboard() -> ReplyKeyboardMarkup:
    return ReplyKeyboardMarkup(
        keyboard=[
            [KeyboardButton(text=MENU_TODAY_BUTTON), KeyboardButton(text=MENU_WEEKLY_BUTTON)],
            [KeyboardButton(text=MENU_SETTINGS_BUTTON), KeyboardButton(text=MENU_ABOUT_BUTTON)],
        ],
        resize_keyboard=True,
    )


def settings_keyboard() -> ReplyKeyboardMarkup:
    return ReplyKeyboardMarkup(
        keyboard=[
            [KeyboardButton(text=SETTINGS_DAILY_BUTTON)],
            [KeyboardButton(text=SETTINGS_WEEKLY_BUTTON)],
            [KeyboardButton(text=SETTINGS_BACK_BUTTON)],
        ],
        resize_keyboard=True,
    )
