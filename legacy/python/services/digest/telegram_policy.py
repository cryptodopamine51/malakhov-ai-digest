from __future__ import annotations

from dataclasses import dataclass
from enum import Enum

from app.core.config import get_settings


class TelegramPackageSection(str, Enum):
    MODELS_SERVICES = "models_services"
    TOOLS_CODING = "tools_coding"
    INVESTMENTS_MARKET = "investments_market"
    AI_RUSSIA = "ai_russia"
    ALPHA = "alpha"


@dataclass(frozen=True, slots=True)
class TelegramPackagingPolicy:
    min_ranking_score: float
    fallback_min_score: float
    total_cap: int
    weak_day_total_cap: int
    section_caps: dict[TelegramPackageSection, int]


def get_telegram_packaging_policy() -> TelegramPackagingPolicy:
    settings = get_settings()
    return TelegramPackagingPolicy(
        min_ranking_score=settings.telegram_daily_min_ranking_score,
        fallback_min_score=settings.telegram_daily_fallback_min_score,
        total_cap=settings.telegram_daily_total_cap,
        weak_day_total_cap=settings.telegram_daily_weak_day_total_cap,
        section_caps={
            TelegramPackageSection.MODELS_SERVICES: settings.telegram_models_services_cap,
            TelegramPackageSection.TOOLS_CODING: settings.telegram_tools_coding_cap,
            TelegramPackageSection.INVESTMENTS_MARKET: settings.telegram_investments_market_cap,
            TelegramPackageSection.AI_RUSSIA: settings.telegram_ai_russia_cap,
            TelegramPackageSection.ALPHA: 1,
        },
    )
