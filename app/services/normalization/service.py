from __future__ import annotations

from app.db.models import RawItem, Source
from app.services.normalization.schemas import NormalizationResult
from app.services.normalization.utils import clean_text, detect_language, extract_entities, extract_links


class NormalizationService:
    def normalize(self, raw_item: RawItem, source: Source | None = None) -> NormalizationResult:
        normalized_title = clean_text(raw_item.raw_title)
        normalized_text = clean_text(raw_item.raw_text)
        payload_links = extract_links(str(raw_item.raw_payload_json))
        outbound_links = extract_links(raw_item.raw_text, normalized_text, *payload_links)
        language = detect_language(
            " ".join(filter(None, [normalized_title, normalized_text])),
            raw_item.language or (source.language if source else None),
        )
        entities = extract_entities(normalized_title, normalized_text, raw_item.canonical_url)

        discarded = normalized_title is None and normalized_text is None
        discard_reason = "raw item has no usable title or text" if discarded else None
        return NormalizationResult(
            normalized_title=normalized_title,
            normalized_text=normalized_text,
            language=language,
            entities=entities,
            outbound_links=outbound_links,
            discarded=discarded,
            discard_reason=discard_reason,
        )
