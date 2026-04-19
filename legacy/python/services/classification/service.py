from __future__ import annotations

from app.core.pipeline import CLASSIFICATION_CONFIG
from app.db.models import EventSection, EventTagType, RawItem
from app.services.classification.schemas import ClassifiedCategory, ClassifiedTag
from app.services.normalization.utils import tokenize


class ClassificationService:
    def __init__(self) -> None:
        self.config = CLASSIFICATION_CONFIG

    def classify(self, raw_items: list[RawItem]) -> tuple[list[ClassifiedCategory], list[ClassifiedTag]]:
        combined_text = " ".join(
            filter(None, [item.normalized_title for item in raw_items] + [item.normalized_text for item in raw_items])
        ).lower()
        tokens = tokenize(combined_text)
        scores = {
            EventSection.IMPORTANT: 0.0,
            EventSection.AI_NEWS: 0.0,
            EventSection.CODING: 0.0,
            EventSection.INVESTMENTS: 0.0,
            EventSection.ALPHA: 0.0,
        }

        for section, keywords in self.config.section_keywords.items():
            for keyword in keywords:
                if keyword.lower() in combined_text or keyword.lower() in tokens:
                    scores[section] += 0.25

        for raw_item in raw_items:
            source = raw_item.source
            if source and source.section_bias:
                for bias in source.section_bias.split("|"):
                    normalized_bias = bias.strip()
                    if not normalized_bias:
                        continue
                    try:
                        section = EventSection(normalized_bias)
                    except ValueError:
                        continue
                    if section is EventSection.ALPHA:
                        continue
                    scores[section] += self.config.source_bias_bonus
                    if section is EventSection.IMPORTANT:
                        scores[section] += self.config.important_bias_bonus

            entities = raw_item.entities_json or {}
            if entities.get("companies") or entities.get("models"):
                scores[EventSection.AI_NEWS] += 0.15
            if entities.get("products"):
                scores[EventSection.CODING] += 0.1

        if scores[EventSection.AI_NEWS] == 0 and scores[EventSection.CODING] == 0 and scores[EventSection.INVESTMENTS] == 0:
            scores[EventSection.AI_NEWS] = 0.2

        primary_section = max(
            (section for section in scores if section is not EventSection.ALPHA),
            key=lambda section: scores[section],
        )

        categories = [
            ClassifiedCategory(
                section=section,
                score=round(score, 3),
                is_primary_section=section == primary_section and score > 0,
            )
            for section, score in scores.items()
            if score > 0 and section is not EventSection.ALPHA
        ]

        if not categories:
            categories = [ClassifiedCategory(section=EventSection.AI_NEWS, score=0.2, is_primary_section=True)]

        tags = self._build_tags(raw_items, categories)
        return categories, tags

    def _build_tags(self, raw_items: list[RawItem], categories: list[ClassifiedCategory]) -> list[ClassifiedTag]:
        tags: dict[tuple[str, EventTagType], ClassifiedTag] = {}

        for category in categories:
            tags[(category.section.value, EventTagType.THEME)] = ClassifiedTag(
                tag=category.section.value,
                tag_type=EventTagType.THEME,
            )

        for raw_item in raw_items:
            entities = raw_item.entities_json or {}
            for entity in entities.get("companies", []) + entities.get("people", []) + entities.get("organizations", []):
                tags[(entity, EventTagType.ENTITY)] = ClassifiedTag(tag=entity, tag_type=EventTagType.ENTITY)
            for entity in entities.get("models", []) + entities.get("products", []):
                tags[(entity, EventTagType.TECH)] = ClassifiedTag(tag=entity, tag_type=EventTagType.TECH)

            text = " ".join(filter(None, [raw_item.normalized_title, raw_item.normalized_text])).lower()
            for market_tag in ("funding", "acquisition", "partnership", "valuation"):
                if market_tag in text:
                    tags[(market_tag, EventTagType.MARKET)] = ClassifiedTag(tag=market_tag, tag_type=EventTagType.MARKET)

        return sorted(tags.values(), key=lambda item: (item.tag_type.value, item.tag.lower()))
