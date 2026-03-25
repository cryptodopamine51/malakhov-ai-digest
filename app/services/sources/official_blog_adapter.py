from __future__ import annotations

import re
from datetime import UTC, datetime
from email.utils import parsedate_to_datetime
from html import unescape
from urllib.parse import urljoin, urlparse

from app.db.models import Source
from app.services.sources.base import SourceAdapter
from app.services.sources.feed_utils import discover_feed_url, parse_feed_document
from app.services.sources.http_client import SourceHttpClient
from app.services.sources.schemas import FetchResult, FetchedItem

KNOWN_OFFICIAL_BLOG_FEED_OVERRIDES: dict[str, str] = {
    "https://openai.com/news/": "https://openai.com/news/rss.xml",
}


def _normalize_text(value: str | None) -> str | None:
    if value is None:
        return None
    normalized = " ".join(unescape(value).split())
    return normalized or None


def _parse_datetime(value: str | None) -> datetime | None:
    if not value:
        return None

    try:
        parsed = parsedate_to_datetime(value)
    except (TypeError, ValueError, IndexError):
        parsed = None

    if parsed is not None:
        return parsed if parsed.tzinfo else parsed.replace(tzinfo=UTC)

    try:
        candidate = value.replace("Z", "+00:00")
        parsed = datetime.fromisoformat(candidate)
    except ValueError:
        return None

    return parsed if parsed.tzinfo else parsed.replace(tzinfo=UTC)


def _extract_meta_content(html: str, key: str, *, attribute: str = "property") -> str | None:
    pattern = re.compile(
        rf'<meta[^>]+{attribute}=["\']{re.escape(key)}["\'][^>]+content=["\']([^"\']+)["\']',
        re.IGNORECASE,
    )
    match = pattern.search(html)
    if match is not None:
        return _normalize_text(match.group(1))

    reverse_pattern = re.compile(
        rf'<meta[^>]+content=["\']([^"\']+)["\'][^>]+{attribute}=["\']{re.escape(key)}["\']',
        re.IGNORECASE,
    )
    reverse_match = reverse_pattern.search(html)
    if reverse_match is not None:
        return _normalize_text(reverse_match.group(1))
    return None


def _extract_canonical_url(html: str, base_url: str) -> str | None:
    pattern = re.compile(r'<link[^>]+rel=["\']canonical["\'][^>]+href=["\']([^"\']+)["\']', re.IGNORECASE)
    match = pattern.search(html)
    if match is None:
        return None
    return _normalize_text(urljoin(base_url, match.group(1)))


def _extract_same_domain_news_links(html: str, base_url: str) -> list[str]:
    base = urlparse(base_url)
    href_pattern = re.compile(r'href=["\']([^"\']+)["\']', re.IGNORECASE)
    links: list[str] = []
    seen: set[str] = set()

    for href in href_pattern.findall(html):
        absolute = urljoin(base_url, href)
        parsed = urlparse(absolute)
        if parsed.netloc != base.netloc:
            continue
        if "/news/" not in parsed.path:
            continue
        if parsed.path.rstrip("/") == "/news":
            continue
        normalized = absolute.split("#", 1)[0]
        if normalized in seen:
            continue
        seen.add(normalized)
        links.append(normalized)
    return links


def _fallback_title_from_url(url: str) -> str:
    slug = urlparse(url).path.rstrip("/").split("/")[-1]
    return slug.replace("-", " ").strip().title() or "Untitled"


class OfficialBlogAdapter(SourceAdapter):
    def __init__(self, http_client: SourceHttpClient) -> None:
        self.http_client = http_client

    async def fetch(self, source: Source) -> FetchResult:
        feed_override = self._known_feed_override(source.handle_or_url)
        if feed_override is not None:
            feed_content = await self.http_client.fetch_text(feed_override)
            result = parse_feed_document(feed_content, default_language=source.language)
            result.warnings.append(f"known feed override {feed_override}")
            return result

        homepage = await self.http_client.fetch_text(source.handle_or_url)
        discovery = discover_feed_url(homepage, source.handle_or_url)
        if discovery.feed_url is not None:
            try:
                feed_content = await self.http_client.fetch_text(discovery.feed_url)
            except Exception:
                pass
            else:
                result = parse_feed_document(feed_content, default_language=source.language)
                if discovery.feed_url != source.handle_or_url:
                    result.warnings.append(f"discovered feed {discovery.feed_url}")
                return result

        fallback = await self._fetch_listing_fallback(source, homepage)
        if fallback.items:
            fallback.warnings.append("listing fallback")
            return fallback
        raise ValueError(f"feed discovery failed for source {source.id}")

    def _known_feed_override(self, url: str) -> str | None:
        normalized = url.rstrip("/") + "/"
        return KNOWN_OFFICIAL_BLOG_FEED_OVERRIDES.get(normalized)

    async def _fetch_listing_fallback(self, source: Source, homepage: str) -> FetchResult:
        links = _extract_same_domain_news_links(homepage, source.handle_or_url)[:10]
        items: list[FetchedItem] = []
        warnings: list[str] = []

        for link in links:
            try:
                article_html = await self.http_client.fetch_text(link)
            except Exception as exc:
                warnings.append(f"article fetch failed {link}: {exc.__class__.__name__}")
                continue

            title = (
                _extract_meta_content(article_html, "og:title")
                or _extract_meta_content(article_html, "twitter:title", attribute="name")
                or _fallback_title_from_url(link)
            )
            description = (
                _extract_meta_content(article_html, "description", attribute="name")
                or _extract_meta_content(article_html, "og:description")
            )
            canonical_url = _extract_canonical_url(article_html, link) or link
            published_at = _parse_datetime(
                _extract_meta_content(article_html, "article:published_time")
                or _extract_meta_content(article_html, "og:updated_time")
            )

            items.append(
                FetchedItem(
                    external_id=canonical_url,
                    published_at=published_at,
                    canonical_url=canonical_url,
                    title=title,
                    text=description,
                    author_name=None,
                    language=source.language,
                    payload={"fallback": "listing", "source_url": source.handle_or_url},
                )
            )

        return FetchResult(items=items, warnings=warnings)
