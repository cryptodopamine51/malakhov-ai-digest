from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from app.core.config import get_settings


TRACKING_QUERY_PARAMS = {
    "utm_source",
    "utm_medium",
    "utm_campaign",
    "utm_term",
    "utm_content",
    "fbclid",
    "gclid",
    "mc_cid",
    "mc_eid",
}


@dataclass(frozen=True, slots=True)
class RawShortlistPolicy:
    max_age_hours: int
    min_title_length: int
    min_title_tokens: int
    min_text_length: int
    duplicate_recent_days: int

    @property
    def max_age_delta(self) -> timedelta:
        return timedelta(hours=self.max_age_hours)

    @property
    def duplicate_recent_delta(self) -> timedelta:
        return timedelta(days=self.duplicate_recent_days)


def get_raw_shortlist_policy() -> RawShortlistPolicy:
    settings = get_settings()
    return RawShortlistPolicy(
        max_age_hours=settings.raw_shortlist_max_age_hours,
        min_title_length=settings.raw_shortlist_min_title_length,
        min_title_tokens=settings.raw_shortlist_min_title_tokens,
        min_text_length=settings.raw_shortlist_min_text_length,
        duplicate_recent_days=settings.raw_shortlist_duplicate_recent_days,
    )


def normalize_candidate_url(value: str | None) -> str | None:
    if not value:
        return None
    parts = urlsplit(value.strip())
    if not parts.scheme or not parts.netloc:
        return value.strip().rstrip("/") or None

    filtered_query = [
        (key, query_value)
        for key, query_value in parse_qsl(parts.query, keep_blank_values=True)
        if key.lower() not in TRACKING_QUERY_PARAMS
    ]
    normalized_path = parts.path.rstrip("/") or "/"
    normalized = urlunsplit(
        (
            parts.scheme.lower(),
            parts.netloc.lower(),
            normalized_path,
            urlencode(filtered_query, doseq=True),
            "",
        )
    )
    return normalized


def utc_now() -> datetime:
    return datetime.now(UTC)
