from __future__ import annotations

from dataclasses import dataclass

from app.db.models import SourceRegion, SourceRole, SourceStatus, SourceType


ROLE_PRIORITY_WEIGHT_DEFAULTS: dict[SourceRole, int] = {
    SourceRole.SIGNAL_FEEDER: 92,
    SourceRole.VERIFICATION: 97,
    SourceRole.CODING: 90,
    SourceRole.INVESTMENTS: 91,
    SourceRole.RUSSIA: 86,
}

ROLE_EDITORIAL_PRIORITY_DEFAULTS: dict[SourceRole, int] = {
    SourceRole.SIGNAL_FEEDER: 95,
    SourceRole.VERIFICATION: 100,
    SourceRole.CODING: 92,
    SourceRole.INVESTMENTS: 94,
    SourceRole.RUSSIA: 88,
}

TYPE_NOISE_SCORE_DEFAULTS: dict[SourceType, float] = {
    SourceType.OFFICIAL_BLOG: 0.08,
    SourceType.RSS_FEED: 0.16,
    SourceType.WEBSITE: 0.24,
}


@dataclass(frozen=True, slots=True)
class SourcePolicySnapshot:
    role: SourceRole
    region: SourceRegion
    status: SourceStatus
    priority_weight: int
    editorial_priority: int
    noise_score: float


def validate_source_role(value: str | SourceRole | None) -> SourceRole:
    if value is None or value == "":
        return SourceRole.SIGNAL_FEEDER
    if isinstance(value, SourceRole):
        return value
    return SourceRole(value)


def validate_source_region(value: str | SourceRegion | None) -> SourceRegion:
    if value is None or value == "":
        return SourceRegion.GLOBAL
    if isinstance(value, SourceRegion):
        return value
    return SourceRegion(value)


def validate_source_status(value: str | SourceStatus | None) -> SourceStatus:
    if value is None or value == "":
        return SourceStatus.ACTIVE
    if isinstance(value, SourceStatus):
        return value
    return SourceStatus(value)


def default_priority_weight_for_role(role: SourceRole) -> int:
    return ROLE_PRIORITY_WEIGHT_DEFAULTS[role]


def default_editorial_priority_for_role(role: SourceRole) -> int:
    return ROLE_EDITORIAL_PRIORITY_DEFAULTS[role]


def default_noise_score_for_type(source_type: SourceType) -> float:
    return TYPE_NOISE_SCORE_DEFAULTS.get(source_type, 0.24)


def source_status_allows_ingestion(status: SourceStatus) -> bool:
    return status is SourceStatus.ACTIVE


def should_source_be_active(*, status: SourceStatus, is_active: bool) -> bool:
    return is_active and source_status_allows_ingestion(status)


def build_source_policy_snapshot(
    *,
    source_type: SourceType,
    role: str | SourceRole | None,
    region: str | SourceRegion | None,
    status: str | SourceStatus | None,
    priority_weight: int | None,
    editorial_priority: int | None,
    noise_score: float | None,
) -> SourcePolicySnapshot:
    resolved_role = validate_source_role(role)
    resolved_region = validate_source_region(region)
    resolved_status = validate_source_status(status)
    return SourcePolicySnapshot(
        role=resolved_role,
        region=resolved_region,
        status=resolved_status,
        priority_weight=priority_weight if priority_weight is not None else default_priority_weight_for_role(resolved_role),
        editorial_priority=(
            editorial_priority
            if editorial_priority is not None
            else default_editorial_priority_for_role(resolved_role)
        ),
        noise_score=round(
            noise_score if noise_score is not None else default_noise_score_for_type(source_type),
            3,
        ),
    )
