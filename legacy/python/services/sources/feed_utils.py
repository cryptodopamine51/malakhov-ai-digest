from __future__ import annotations

import hashlib
from dataclasses import dataclass
from datetime import UTC, datetime
from email.utils import parsedate_to_datetime
from html import unescape
from html.parser import HTMLParser
from urllib.parse import urljoin, urlparse
from xml.etree import ElementTree as ET

from app.services.sources.schemas import FetchResult, FetchedItem

ATOM_NS = {"atom": "http://www.w3.org/2005/Atom"}


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


def _build_external_id(canonical_url: str, guid: str | None, title: str) -> str:
    seed = guid or canonical_url or title
    if len(seed) <= 512:
        return seed
    return hashlib.sha256(seed.encode("utf-8")).hexdigest()


def _parse_rss_channel(root: ET.Element, default_language: str | None) -> FetchResult:
    channel = root.find("channel")
    if channel is None:
        return FetchResult(items=[], warnings=["rss feed missing channel"])

    feed_language = _normalize_text(channel.findtext("language")) or default_language
    items: list[FetchedItem] = []
    warnings: list[str] = []

    for entry in channel.findall("item"):
        title = _normalize_text(entry.findtext("title"))
        canonical_url = _normalize_text(entry.findtext("link"))
        if not title or not canonical_url:
            warnings.append("rss item skipped because title or link is missing")
            continue

        guid = _normalize_text(entry.findtext("guid"))
        description = _normalize_text(entry.findtext("description"))
        author_name = _normalize_text(entry.findtext("author"))
        published_at = _parse_datetime(entry.findtext("pubDate"))
        items.append(
            FetchedItem(
                external_id=_build_external_id(canonical_url, guid, title),
                published_at=published_at,
                canonical_url=canonical_url,
                title=title,
                text=description,
                author_name=author_name,
                language=feed_language,
                payload={
                    "guid": guid,
                    "description": description,
                },
            )
        )

    return FetchResult(items=items, warnings=warnings)


def _parse_atom_feed(root: ET.Element, default_language: str | None) -> FetchResult:
    feed_language = root.attrib.get("{http://www.w3.org/XML/1998/namespace}lang") or default_language
    items: list[FetchedItem] = []
    warnings: list[str] = []

    for entry in root.findall("atom:entry", ATOM_NS):
        title = _normalize_text(entry.findtext("atom:title", default=None, namespaces=ATOM_NS))
        link_element = entry.find("atom:link[@rel='alternate']", ATOM_NS) or entry.find("atom:link", ATOM_NS)
        canonical_url = link_element.attrib.get("href") if link_element is not None else None
        canonical_url = _normalize_text(canonical_url)
        if not title or not canonical_url:
            warnings.append("atom entry skipped because title or link is missing")
            continue

        entry_id = _normalize_text(entry.findtext("atom:id", default=None, namespaces=ATOM_NS))
        summary = _normalize_text(entry.findtext("atom:summary", default=None, namespaces=ATOM_NS))
        content = _normalize_text(entry.findtext("atom:content", default=None, namespaces=ATOM_NS))
        author_name = _normalize_text(entry.findtext("atom:author/atom:name", default=None, namespaces=ATOM_NS))
        published_at = _parse_datetime(
            entry.findtext("atom:published", default=None, namespaces=ATOM_NS)
            or entry.findtext("atom:updated", default=None, namespaces=ATOM_NS)
        )
        items.append(
            FetchedItem(
                external_id=_build_external_id(canonical_url, entry_id, title),
                published_at=published_at,
                canonical_url=canonical_url,
                title=title,
                text=content or summary,
                author_name=author_name,
                language=feed_language,
                payload={
                    "entry_id": entry_id,
                    "summary": summary,
                    "content": content,
                },
            )
        )

    return FetchResult(items=items, warnings=warnings)


def parse_feed_document(content: str, default_language: str | None) -> FetchResult:
    root = ET.fromstring(content)
    tag = root.tag.lower()

    if tag.endswith("rss"):
        return _parse_rss_channel(root, default_language)
    if tag.endswith("feed"):
        return _parse_atom_feed(root, default_language)

    raise ValueError("unsupported feed format")


@dataclass(slots=True)
class FeedDiscoveryResult:
    feed_url: str | None
    candidates: list[str]


class _FeedLinkParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.links: list[dict[str, str]] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag.lower() != "link":
            return
        attr_map = {key.lower(): value or "" for key, value in attrs}
        self.links.append(attr_map)


def discover_feed_url(html: str, base_url: str) -> FeedDiscoveryResult:
    parser = _FeedLinkParser()
    parser.feed(html)

    candidates: list[str] = []
    for link in parser.links:
        rel = link.get("rel", "").lower()
        href = link.get("href", "").strip()
        type_attr = link.get("type", "").lower()
        if "alternate" in rel and type_attr in {"application/rss+xml", "application/atom+xml"} and href:
            candidates.append(urljoin(base_url, href))

    if candidates:
        return FeedDiscoveryResult(feed_url=candidates[0], candidates=candidates)

    parsed_base = urlparse(base_url)
    fallback_candidates = [
        urljoin(base_url, "/feed"),
        urljoin(base_url, "/rss"),
        urljoin(base_url, "/atom.xml"),
        f"{parsed_base.scheme}://{parsed_base.netloc}/feed.xml" if parsed_base.netloc else "",
    ]
    normalized = [candidate for candidate in fallback_candidates if candidate]
    return FeedDiscoveryResult(feed_url=normalized[0] if normalized else None, candidates=normalized)
