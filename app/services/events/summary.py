from __future__ import annotations

from app.db.models import Event, RawItem


class SummaryBuilder:
    def build(self, event: Event, raw_items: list[RawItem]) -> tuple[str, str]:
        source_count = len(raw_items)
        primary_title = event.title
        primary_source = event.primary_source.title if event.primary_source else "the primary source"

        unique_entities = []
        seen: set[str] = set()
        for raw_item in raw_items:
            for values in (raw_item.entities_json or {}).values():
                for value in values:
                    lowered = value.lower()
                    if lowered not in seen:
                        seen.add(lowered)
                        unique_entities.append(value)
        entity_snippet = ", ".join(unique_entities[:4]) if unique_entities else "the main actors in this story"

        short_summary = (
            f"{primary_title}. "
            f"Covered by {source_count} source{'s' if source_count != 1 else ''}, led by {primary_source}."
        )
        long_summary = (
            f"{primary_title}. "
            f"This event aggregates {source_count} related source{'s' if source_count != 1 else ''}. "
            f"Primary coverage comes from {primary_source}, with supporting references centered on {entity_snippet}."
        )
        return short_summary, long_summary
