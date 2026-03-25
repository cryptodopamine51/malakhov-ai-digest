from enum import Enum


class SubscriptionMode(str, Enum):
    DAILY = "daily"
    WEEKLY = "weekly"


class DeliveryType(str, Enum):
    ONBOARDING = "onboarding"
    SETTINGS_CHANGE = "settings_change"
    ABOUT = "about"
    DAILY_MAIN = "daily_main"
    WEEKLY_MAIN = "weekly_main"
    SECTION_OPEN = "section_open"
    TODAY_STUB = "today_stub"
    WEEKLY_STUB = "weekly_stub"


class DeliveryStatus(str, Enum):
    QUEUED = "queued"
    SENT = "sent"
    FAILED = "failed"


class SourceType(str, Enum):
    RSS_FEED = "rss_feed"
    WEBSITE = "website"
    OFFICIAL_BLOG = "official_blog"


class RawItemStatus(str, Enum):
    FETCHED = "fetched"
    NORMALIZED = "normalized"
    CLUSTERED = "clustered"
    DISCARDED = "discarded"


class SourceRunStatus(str, Enum):
    SUCCESS = "success"
    PARTIAL = "partial"
    FAILED = "failed"


class EventSourceRole(str, Enum):
    PRIMARY = "primary"
    SUPPORTING = "supporting"
    REACTION = "reaction"


class EventSection(str, Enum):
    IMPORTANT = "important"
    AI_NEWS = "ai_news"
    CODING = "coding"
    INVESTMENTS = "investments"
    ALPHA = "alpha"


class EventTagType(str, Enum):
    THEME = "theme"
    ENTITY = "entity"
    MARKET = "market"
    TECH = "tech"


class DigestIssueType(str, Enum):
    DAILY = "daily"
    WEEKLY = "weekly"


class DigestIssueStatus(str, Enum):
    DRAFT = "draft"
    READY = "ready"
    SENT = "sent"


class DigestSection(str, Enum):
    IMPORTANT = "important"
    AI_NEWS = "ai_news"
    CODING = "coding"
    INVESTMENTS = "investments"
    ALPHA = "alpha"
    ALL = "all"


class AlphaEntryStatus(str, Enum):
    DRAFT = "draft"
    READY = "ready"
    PUBLISHED = "published"
