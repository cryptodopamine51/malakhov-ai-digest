from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum
from typing import Any


class EventImportanceTier(StrEnum):
    TIER_1 = "tier_1"
    TIER_2 = "tier_2"
    TIER_3 = "tier_3"


class EventImpactType(StrEnum):
    MARKET_SHIFT = "market_shift"
    PRODUCT_LAUNCH = "product_launch"
    INFRA = "infra"
    INVESTMENT = "investment"
    REGULATION = "regulation"
    DEV_UPDATE = "dev_update"


@dataclass(frozen=True, slots=True)
class EventImportanceDecision:
    tier: EventImportanceTier
    impact_type: EventImpactType | None
    score: float
    impact_boost_applied: int
    reasons: list[str]
    excluded: bool
    exclusion_reason: str | None
    source_surface_adjustment: int
    consequence_gate_triggered: bool


_STRONG_SOURCE_BOOSTS = ("reuters", "venturebeat", "techcrunch", "the verge")
_WEAK_SOURCE_DOWNGRADES = ("hugging face blog", "copilot changelog", "changelog", "dev blog")


def compute_event_importance(item: Any) -> EventImportanceDecision:
    title = _text(item, "title")
    short_summary = _text(item, "short_summary")
    long_summary = _text(item, "long_summary")
    combined = f"{title} {short_summary} {long_summary}".lower()
    ranking_score = float(_value(item, "ranking_score", 0.0) or 0.0)
    primary_section = str(_value(item, "primary_section", "") or "").lower()
    primary_source = _value(item, "primary_source", {}) or {}
    source_title = _source_text(primary_source, "title").lower()
    source_strength = _source_strength_adjustment(source_title)
    impact_type = classify_event_impact_type(item)
    impact_boost = {
        EventImpactType.MARKET_SHIFT: 25,
        EventImpactType.REGULATION: 20,
        EventImpactType.INFRA: 15,
        EventImpactType.INVESTMENT: 10,
        EventImpactType.PRODUCT_LAUNCH: 12,
        EventImpactType.DEV_UPDATE: -10,
        None: 0,
    }[impact_type]

    reasons: list[str] = []
    if source_strength > 0:
        reasons.append("strong_media_source")
    elif source_strength < 0:
        reasons.append("minor_dev_source")

    if impact_type is not None:
        reasons.append(impact_type.value)

    consequence_positive = impact_type in {
        EventImpactType.MARKET_SHIFT,
        EventImpactType.PRODUCT_LAUNCH,
        EventImpactType.INFRA,
        EventImpactType.INVESTMENT,
        EventImpactType.REGULATION,
    }
    source_consequence_penalty, consequence_gate_triggered = _source_consequence_penalty(
        source_title=source_title,
        impact_type=impact_type,
        has_verification_source=bool(_value(item, "has_verification_source", False)),
        combined=combined,
    )
    if consequence_gate_triggered:
        reasons.append("weak_official_without_consequence")

    score = ranking_score * 0.55 + source_strength + impact_boost - source_consequence_penalty

    if primary_section == "important":
        score += 8
        reasons.append("important_section")
    elif primary_section in {"coding", "investments"}:
        score += 5
        reasons.append("high_signal_section")
    elif primary_section == "ai_news":
        score += 2

    weak_summary = is_weak_summary(item)
    weak_single_source = _is_single_weak_source(item)
    if weak_summary:
        score -= 14
        reasons.append("weak_summary")
    if weak_single_source:
        score -= 10
        reasons.append("single_weak_source")

    excluded = False
    exclusion_reason: str | None = None
    if impact_type is None:
        excluded = True
        exclusion_reason = "missing_impact_type"
    elif weak_summary:
        excluded = True
        exclusion_reason = "weak_summary"
    elif weak_single_source:
        excluded = True
        exclusion_reason = "single_weak_source"
    elif consequence_gate_triggered and not consequence_positive:
        excluded = True
        exclusion_reason = "weak_official_without_consequence"

    if impact_type is EventImpactType.DEV_UPDATE and source_strength > 0 and score >= 40:
        tier = EventImportanceTier.TIER_2
    elif score >= 76:
        tier = EventImportanceTier.TIER_1
    elif score >= 50:
        tier = EventImportanceTier.TIER_2
    else:
        tier = EventImportanceTier.TIER_3

    if tier is EventImportanceTier.TIER_3 and exclusion_reason is None:
        excluded = True
        exclusion_reason = "tier_3_filtered"

    return EventImportanceDecision(
        tier=tier,
        impact_type=impact_type,
        score=round(score, 2),
        impact_boost_applied=impact_boost,
        reasons=reasons or ["low_signal_default"],
        excluded=excluded,
        exclusion_reason=exclusion_reason,
        source_surface_adjustment=source_strength - source_consequence_penalty,
        consequence_gate_triggered=consequence_gate_triggered,
    )


def classify_event_impact_type(item: Any) -> EventImpactType | None:
    title = _text(item, "title")
    short_summary = _text(item, "short_summary")
    long_summary = _text(item, "long_summary")
    combined = f"{title} {short_summary} {long_summary}".lower()
    primary_section = str(_value(item, "primary_section", "") or "").lower()

    if _matches(combined, "acquire", "acquisition", "merger", "m&a", "покупает", "сделк", "рын", "competition", "конкурен"):
        return EventImpactType.MARKET_SHIFT
    if _matches(combined, "law", "legal", "regulation", "регулир", "закон", "compliance", "ban", "огранич"):
        return EventImpactType.REGULATION
    if _matches(combined, "launch", "launches", "launched", "release", "релиз", "запускает", "представила", "model", "gpt-", "claude", "gemini", "llama"):
        return EventImpactType.PRODUCT_LAUNCH
    if _matches(combined, "gpu", "cluster", "infra", "инфраструкт", "compute", "platform", "платформ", "стек", "cloud"):
        return EventImpactType.INFRA
    if _matches(combined, "funding", "series", "investment", "раунд финансирования", "инвести", "raises"):
        return EventImpactType.INVESTMENT
    if primary_section == "coding" or _matches(combined, "tool", "sdk", "api", "cli", "copilot", "workflow", "сценар", "developer", "обнов"):
        return EventImpactType.DEV_UPDATE
    return None


def sort_site_events(items: list[Any]) -> list[Any]:
    return sorted(
        items,
        key=lambda item: (
            _tier_rank(compute_event_importance(item).tier),
            compute_event_importance(item).impact_boost_applied,
            compute_event_importance(item).score,
            float(_value(item, "ranking_score", 0.0) or 0.0),
            str(_value(item, "event_date", "") or ""),
            int(_value(item, "id", 0) or 0),
        ),
        reverse=True,
    )


def select_homepage_events(
    items: list[Any],
    *,
    max_per_category: int = 2,
) -> list[Any]:
    ordered = [item for item in sort_site_events(items) if not compute_event_importance(item).excluded]
    selected: list[Any] = []
    selected_ids: set[int] = set()
    category_counts: dict[str, int] = {}

    def add_candidate(candidate: Any) -> bool:
        item_id = int(_value(candidate, "id", 0) or 0)
        if item_id in selected_ids:
            return False
        category = str(_value(candidate, "primary_section", "") or "unknown").lower()
        if category_counts.get(category, 0) >= max_per_category:
            return False
        selected.append(candidate)
        selected_ids.add(item_id)
        category_counts[category] = category_counts.get(category, 0) + 1
        return True

    _pick_first(ordered, add_candidate, lambda item: compute_event_importance(item).impact_type is EventImpactType.MARKET_SHIFT)
    _pick_first(ordered, add_candidate, lambda item: compute_event_importance(item).impact_type is EventImpactType.MARKET_SHIFT)
    _pick_first(ordered, add_candidate, lambda item: compute_event_importance(item).impact_type is EventImpactType.PRODUCT_LAUNCH)
    _pick_first(
        ordered,
        add_candidate,
        lambda item: compute_event_importance(item).impact_type in {EventImpactType.INFRA, EventImpactType.DEV_UPDATE},
    )
    _pick_first(ordered, add_candidate, lambda item: compute_event_importance(item).impact_type is EventImpactType.INVESTMENT)
    _pick_first(ordered, add_candidate, lambda item: bool(_value(item, "is_ai_in_russia", False)))

    for item in ordered:
        if len(selected) >= 6:
            break
        add_candidate(item)
    return selected


def _pick_first(items: list[Any], add_candidate, predicate) -> None:
    for item in items:
        if predicate(item):
            if add_candidate(item):
                return


def is_weak_summary(item: Any) -> bool:
    summary = _text(item, "short_summary").strip()
    if not summary:
        return True
    if len(summary) < 20:
        return True
    lowered = summary.lower()
    weak_tokens = (
        "новый заметный сигнал",
        "ai-повестка",
        "продуктовые приоритеты",
        "signal",
        "important for teams",
        "это помогает понять",
    )
    return any(token in lowered for token in weak_tokens)


def _source_strength_adjustment(source_title: str) -> int:
    if any(token in source_title for token in _STRONG_SOURCE_BOOSTS):
        return 8
    if any(token in source_title for token in _WEAK_SOURCE_DOWNGRADES):
        return -8
    return 0


def _source_consequence_penalty(
    *,
    source_title: str,
    impact_type: EventImpactType | None,
    has_verification_source: bool,
    combined: str,
) -> tuple[int, bool]:
    official_like = any(token in source_title for token in ("blog", "official", "news", "changelog", "developer", "github", "hugging face"))
    consequence_tokens = (
        "market",
        "competition",
        "enterprise",
        "business",
        "revenue",
        "infra",
        "infrastructure",
        "platform",
        "gpu",
        "cloud",
        "регулир",
        "рын",
        "конкурен",
        "корпоратив",
        "бизнес",
        "инфраструкт",
        "платформ",
    )
    has_consequence_text = any(token in combined for token in consequence_tokens)
    if not official_like:
        return 0, False
    if impact_type in {
        EventImpactType.MARKET_SHIFT,
        EventImpactType.PRODUCT_LAUNCH,
        EventImpactType.INFRA,
        EventImpactType.INVESTMENT,
        EventImpactType.REGULATION,
    }:
        return 0, False
    if has_verification_source or has_consequence_text:
        return 0, False
    return 12, True


def _is_single_weak_source(item: Any) -> bool:
    supporting_source_count = int(_value(item, "supporting_source_count", 0) or 0)
    source_title = _source_text(_value(item, "primary_source", {}) or {}, "title").lower()
    return supporting_source_count == 0 and any(token in source_title for token in _WEAK_SOURCE_DOWNGRADES)


def _tier_rank(tier: EventImportanceTier) -> int:
    return {
        EventImportanceTier.TIER_1: 3,
        EventImportanceTier.TIER_2: 2,
        EventImportanceTier.TIER_3: 1,
    }[tier]


def _matches(text: str, *tokens: str) -> bool:
    return any(token in text for token in tokens)


def _value(item: Any, key: str, default: Any = None) -> Any:
    if isinstance(item, dict):
        return item.get(key, default)
    return getattr(item, key, default)


def _text(item: Any, key: str) -> str:
    value = _value(item, key, "")
    return "" if value is None else str(value)


def _source_text(source: Any, key: str) -> str:
    if isinstance(source, dict):
        value = source.get(key, "")
    else:
        value = getattr(source, key, "")
    return "" if value is None else str(value)
