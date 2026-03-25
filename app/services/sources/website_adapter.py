from __future__ import annotations

from app.db.models import Source
from app.services.sources.base import SourceAdapter
from app.services.sources.feed_utils import discover_feed_url, parse_feed_document
from app.services.sources.http_client import SourceHttpClient
from app.services.sources.schemas import FetchResult

KNOWN_WEBSITE_FEED_OVERRIDES: dict[str, str] = {
    "https://techcrunch.com/category/artificial-intelligence/": "https://techcrunch.com/category/artificial-intelligence/feed/",
    "https://venturebeat.com/category/ai/": "https://venturebeat.com/category/ai/feed",
    "https://news.crunchbase.com/sections/ai/": "https://news.crunchbase.com/sections/ai/feed/",
    "https://www.theneurondaily.com/": "https://rss.beehiiv.com/feeds/N4eCstxvgX.xml",
    "https://www.bensbites.com/": "https://www.bensbites.com/feed",
    "https://github.blog/changelog/label/copilot/": "https://github.blog/changelog/label/copilot/feed/",
}


class WebsiteFeedAdapter(SourceAdapter):
    def __init__(self, http_client: SourceHttpClient) -> None:
        self.http_client = http_client

    async def fetch(self, source: Source) -> FetchResult:
        feed_url = self._known_feed_override(source.handle_or_url)
        warnings: list[str] = []

        if feed_url is None:
            homepage = await self.http_client.fetch_text(source.handle_or_url)
            discovery = discover_feed_url(homepage, source.handle_or_url)
            feed_url = discovery.feed_url
            if feed_url is None:
                raise ValueError(f"feed discovery failed for source {source.id}")
            if feed_url != source.handle_or_url:
                warnings.append(f"discovered feed {feed_url}")
        else:
            warnings.append(f"known feed override {feed_url}")

        feed_content = await self.http_client.fetch_text(feed_url)
        result = parse_feed_document(feed_content, default_language=source.language)
        result.warnings.extend(warnings)
        return result

    def _known_feed_override(self, url: str) -> str | None:
        normalized = url.rstrip("/") + "/"
        override = KNOWN_WEBSITE_FEED_OVERRIDES.get(normalized)
        if override is not None:
            return override
        if "thedaily" in normalized:
            return None
        if "therundown.ai" in normalized:
            return None
        if "tldr.tech/ai" in normalized:
            return None
        if "reuters.com/technology/artificial-intelligence" in normalized:
            return None
        return None
