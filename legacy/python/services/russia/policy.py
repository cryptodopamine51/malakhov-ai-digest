from __future__ import annotations

from dataclasses import dataclass

from app.core.config import get_settings
from app.db.models import Event, RawItem, Source, SourceRegion, SourceStatus


@dataclass(frozen=True, slots=True)
class RussiaRelevancePolicy:
    min_relevance_score: float
    min_ranking_score: float
    regulation_keywords: tuple[str, ...]
    state_policy_keywords: tuple[str, ...]
    major_company_keywords: tuple[str, ...]
    market_infra_keywords: tuple[str, ...]
    adoption_keywords: tuple[str, ...]
    restriction_keywords: tuple[str, ...]
    weak_pr_keywords: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class RussiaRelevanceAssessment:
    relevance_score: float
    reason_codes: list[str]
    source_region_russia_count: int
    source_role_russia_count: int
    policy_signal: bool
    state_signal: bool
    major_company_signal: bool
    market_infra_signal: bool
    adoption_signal: bool
    restriction_signal: bool
    weak_pr_penalty: bool


@dataclass(frozen=True, slots=True)
class RussiaSourceReview:
    production_ready: bool
    recommendation: str
    reasons: list[str]
    weak_local_pr_risk: bool
    source_profile: str


def get_russia_relevance_policy() -> RussiaRelevancePolicy:
    settings = get_settings()
    return RussiaRelevancePolicy(
        min_relevance_score=settings.russia_relevance_min_score,
        min_ranking_score=settings.russia_section_min_ranking_score,
        regulation_keywords=(
            "law",
            "regulation",
            "regulator",
            "legal",
            "compliance",
            "закон",
            "регулир",
            "правов",
            "норматив",
            "комплаенс",
        ),
        state_policy_keywords=(
            "government",
            "ministry",
            "federal",
            "public sector",
            "state initiative",
            "минцифры",
            "госдума",
            "правительство",
            "государствен",
            "нацпроект",
            "госсектор",
        ),
        major_company_keywords=(
            "yandex",
            "яндекс",
            "sber",
            "сбер",
            "vk",
            "вк",
            "mts",
            "мтс",
            "t-bank",
            "тинькофф",
            "rostelecom",
            "ростелеком",
        ),
        market_infra_keywords=(
            "compute",
            "cloud",
            "platform",
            "gpu",
            "inference",
            "cluster",
            "infrastructure",
            "дата-центр",
            "вычисл",
            "инфраструктур",
            "облачн",
            "платформ",
            "кластер",
        ),
        adoption_keywords=(
            "enterprise adoption",
            "enterprise rollout",
            "government adoption",
            "deployment",
            "rollout",
            "внедр",
            "запуст",
            "использует",
            "госпроект",
            "корпоративн",
            "enterprise",
        ),
        restriction_keywords=(
            "restriction",
            "ban",
            "sanction",
            "localization",
            "compliance requirement",
            "огранич",
            "запрет",
            "санкц",
            "локализац",
            "сертификац",
        ),
        weak_pr_keywords=(
            "forum",
            "conference",
            "award",
            "exhibition",
            "commented",
            "shared at",
            "форум",
            "конференц",
            "выставк",
            "преми",
            "рассказал",
            "поделился",
            "обсудил",
            "в интервью",
        ),
    )


def assess_russia_relevance(raw_items: list[RawItem]) -> RussiaRelevanceAssessment:
    policy = get_russia_relevance_policy()
    sources = [item.source for item in raw_items if item.source is not None]
    combined = " ".join(filter(None, [item.raw_title for item in raw_items] + [item.raw_text for item in raw_items])).lower()

    source_region_russia_count = sum(1 for source in sources if source.region is SourceRegion.RUSSIA)
    source_role_russia_count = sum(1 for source in sources if getattr(source, "role", None) is not None and source.role.value == "russia")

    policy_signal = _contains_any(combined, policy.regulation_keywords)
    state_signal = _contains_any(combined, policy.state_policy_keywords)
    major_company_signal = _contains_any(combined, policy.major_company_keywords)
    market_infra_signal = _contains_any(combined, policy.market_infra_keywords)
    adoption_signal = _contains_any(combined, policy.adoption_keywords)
    restriction_signal = _contains_any(combined, policy.restriction_keywords)
    weak_pr_penalty = _contains_any(combined, policy.weak_pr_keywords)

    score = 0.0
    reasons: list[str] = []

    if source_region_russia_count > 0:
        score += 0.18
        reasons.append("russia_source_region")
    if source_region_russia_count > 1:
        score += 0.08
    if source_role_russia_count > 0:
        score += 0.10
        reasons.append("russia_source_role")
    if policy_signal:
        score += 0.24
        reasons.append("russia_policy_signal")
    if state_signal:
        score += 0.18
        reasons.append("russia_state_signal")
    if major_company_signal:
        score += 0.20
        reasons.append("russia_major_company_signal")
    if market_infra_signal:
        score += 0.18
        reasons.append("russia_market_infra_signal")
    if adoption_signal:
        score += 0.14
        reasons.append("russia_adoption_signal")
    if restriction_signal:
        score += 0.16
        reasons.append("russia_restriction_signal")
    if weak_pr_penalty:
        score -= 0.24
        reasons.append("russia_weak_pr_penalty")

    return RussiaRelevanceAssessment(
        relevance_score=round(max(0.0, min(score, 1.0)), 3),
        reason_codes=reasons,
        source_region_russia_count=source_region_russia_count,
        source_role_russia_count=source_role_russia_count,
        policy_signal=policy_signal,
        state_signal=state_signal,
        major_company_signal=major_company_signal,
        market_infra_signal=market_infra_signal,
        adoption_signal=adoption_signal,
        restriction_signal=restriction_signal,
        weak_pr_penalty=weak_pr_penalty,
    )


def qualifies_for_ai_russia_event(event: Event) -> bool:
    policy = get_russia_relevance_policy()
    components = event.score_components_json or {}
    relevance_score = float(components.get("russia_relevance_score") or 0.0)
    strong_signal = any(
        bool(components.get(flag))
        for flag in (
            "russia_policy_signal",
            "russia_state_signal",
            "russia_major_company_signal",
            "russia_market_infra_signal",
            "russia_adoption_signal",
            "russia_restriction_signal",
        )
    )
    weak_pr_penalty = bool(components.get("russia_weak_pr_penalty"))
    source_region_russia = bool(
        event.primary_source is not None
        and getattr(event.primary_source, "region", None) is SourceRegion.RUSSIA
    )
    if not source_region_russia and relevance_score <= 0:
        return False
    if event.ranking_score < policy.min_ranking_score:
        return False
    if weak_pr_penalty and relevance_score < policy.min_relevance_score + 0.12:
        return False
    return relevance_score >= policy.min_relevance_score and (strong_signal or event.importance_score >= 60 or event.market_impact_score >= 55)


def assess_russia_source_review(
    *,
    source: Source,
    error_rate: float,
    success_runs: int,
    raw_item_count: int,
) -> RussiaSourceReview | None:
    if source.region is not SourceRegion.RUSSIA:
        return None
    settings = get_settings()
    reasons: list[str] = []
    weak_local_pr_risk = _looks_like_weak_russia_source(source)
    source_profile = "weak_local_pr" if weak_local_pr_risk else "strategic_or_general"
    if source.status is SourceStatus.DISABLED:
        return RussiaSourceReview(
            production_ready=False,
            recommendation="disabled",
            reasons=["source_disabled"],
            weak_local_pr_risk=weak_local_pr_risk,
            source_profile=source_profile,
        )
    if source.status is SourceStatus.ACTIVE and source.is_active:
        return RussiaSourceReview(
            production_ready=True,
            recommendation="active_monitor",
            reasons=["source_active"],
            weak_local_pr_risk=weak_local_pr_risk,
            source_profile=source_profile,
        )
    if weak_local_pr_risk:
        reasons.append("weak_pr_source_risk")
    if success_runs > 0:
        reasons.append("has_successful_runs")
    if raw_item_count >= settings.russia_source_review_min_raw_items:
        reasons.append("has_raw_items")
    if error_rate <= settings.russia_source_review_max_error_rate:
        reasons.append("acceptable_error_rate")

    production_ready = (
        source.status is SourceStatus.QUARANTINE
        and success_runs > 0
        and raw_item_count >= settings.russia_source_review_min_raw_items
        and error_rate <= settings.russia_source_review_max_error_rate
        and not weak_local_pr_risk
    )
    return RussiaSourceReview(
        production_ready=production_ready,
        recommendation="promote_from_quarantine" if production_ready else "keep_quarantine",
        reasons=reasons or ["insufficient_signal"],
        weak_local_pr_risk=weak_local_pr_risk,
        source_profile=source_profile,
    )


def _contains_any(text: str, patterns: tuple[str, ...]) -> bool:
    return any(pattern in text for pattern in patterns)


def _looks_like_weak_russia_source(source: Source) -> bool:
    combined = f"{source.title} {source.handle_or_url}".lower()
    weak_tokens = (
        "forum",
        "conference",
        "award",
        "exhibition",
        "press",
        "press-center",
        "presscenter",
        "company press",
        "forumspb",
        "форум",
        "конферен",
        "выставк",
        "преми",
        "пресс",
        "новости компании",
    )
    strong_tokens = (
        "минцифры",
        "tass",
        "тасс",
        "rbc",
        "рбк",
        "kommersant",
        "коммерсант",
        "vedomosti",
        "ведомости",
        "yandex",
        "яндекс",
        "sber",
        "сбер",
        "vk",
        "вк",
        "cloud",
    )
    return any(token in combined for token in weak_tokens) and not any(token in combined for token in strong_tokens)
