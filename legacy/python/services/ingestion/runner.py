from __future__ import annotations

import asyncio
import logging

from app.services.ingestion.schemas import BatchIngestionResult
from app.services.ingestion.service import IngestionService

logger = logging.getLogger(__name__)


class IngestionJobRunner:
    def __init__(self, ingestion_service: IngestionService) -> None:
        self.ingestion_service = ingestion_service
        self._lock = asyncio.Lock()

    @property
    def is_running(self) -> bool:
        return self._lock.locked()

    async def run(self) -> BatchIngestionResult | None:
        if self._lock.locked():
            logger.info("ingestion batch skipped because a previous run is still active")
            return None

        async with self._lock:
            return await self.ingestion_service.ingest_active_sources()
