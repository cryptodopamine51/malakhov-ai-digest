from __future__ import annotations

from app.db.models import Source
from app.services.sources.base import SourceAdapter
from app.services.sources.feed_utils import parse_feed_document
from app.services.sources.http_client import SourceHttpClient
from app.services.sources.schemas import FetchResult


class RssFeedAdapter(SourceAdapter):
    def __init__(self, http_client: SourceHttpClient) -> None:
        self.http_client = http_client

    async def fetch(self, source: Source) -> FetchResult:
        content = await self.http_client.fetch_text(source.handle_or_url)
        return parse_feed_document(content, default_language=source.language)
