from __future__ import annotations

import httpx

from app.db.models import SourceType
from app.services.sources import OfficialBlogAdapter, RssFeedAdapter, SourceHttpClient, SourceRegistry, WebsiteFeedAdapter


RSS_FEED_XML = """<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Example Feed</title>
    <language>en</language>
    <item>
      <guid>item-1</guid>
      <title>First item</title>
      <link>https://example.com/items/1</link>
      <description>First description</description>
      <author>Author One</author>
      <pubDate>Tue, 24 Mar 2026 09:00:00 GMT</pubDate>
    </item>
    <item>
      <guid>item-2</guid>
      <title>Second item</title>
      <link>https://example.com/items/2</link>
      <description>Second description</description>
      <author>Author Two</author>
      <pubDate>Tue, 24 Mar 2026 10:00:00 GMT</pubDate>
    </item>
  </channel>
</rss>
"""

OFFICIAL_BLOG_HTML = """<!doctype html>
<html>
  <head>
    <link rel="alternate" type="application/rss+xml" href="/blog/feed.xml" />
  </head>
  <body>blog</body>
</html>
"""


def build_http_client(responses: dict[str, httpx.Response]) -> SourceHttpClient:
    def handler(request: httpx.Request) -> httpx.Response:
        response = responses.get(str(request.url))
        if response is None:
            return httpx.Response(status_code=404, text="not found")
        return response

    return SourceHttpClient(timeout_seconds=1.0, transport=httpx.MockTransport(handler))


def build_registry(http_client: SourceHttpClient) -> SourceRegistry:
    return SourceRegistry(
        {
            SourceType.RSS_FEED: RssFeedAdapter(http_client),
            SourceType.OFFICIAL_BLOG: OfficialBlogAdapter(http_client),
            SourceType.WEBSITE: WebsiteFeedAdapter(http_client),
        }
    )
