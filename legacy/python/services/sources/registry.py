from __future__ import annotations

from app.db.models import SourceType
from app.services.sources.base import SourceAdapter


class SourceRegistry:
    def __init__(self, adapters: dict[SourceType, SourceAdapter]) -> None:
        self._adapters = adapters

    def get_adapter(self, source_type: SourceType) -> SourceAdapter:
        adapter = self._adapters.get(source_type)
        if adapter is None:
            raise KeyError(f"adapter is not registered for source type {source_type.value}")
        return adapter
