from __future__ import annotations

from app.db.models import Source
from app.services.sources.base import SourceAdapter
from app.services.sources.feed_utils import discover_feed_url, parse_feed_document
from app.services.sources.http_client import SourceHttpClient
from app.services.sources.schemas import FetchResult


class OfficialBlogAdapter(SourceAdapter):
    def __init__(self, http_client: SourceHttpClient) -> None:
        self.http_client = http_client

    async def fetch(self, source: Source) -> FetchResult:
        homepage = await self.http_client.fetch_text(source.handle_or_url)
        discovery = discover_feed_url(homepage, source.handle_or_url)
        if discovery.feed_url is None:
            raise ValueError(f"feed discovery failed for source {source.id}")

        feed_content = await self.http_client.fetch_text(discovery.feed_url)
        result = parse_feed_document(feed_content, default_language=source.language)
        if discovery.feed_url != source.handle_or_url:
            result.warnings.append(f"discovered feed {discovery.feed_url}")
        return result
