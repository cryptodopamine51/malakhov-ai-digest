from __future__ import annotations

from abc import ABC, abstractmethod

from app.db.models import Source
from app.services.sources.schemas import FetchResult


class SourceAdapter(ABC):
    @abstractmethod
    async def fetch(self, source: Source) -> FetchResult:
        raise NotImplementedError
