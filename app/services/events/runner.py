from __future__ import annotations

import asyncio
import logging

from app.services.events.schemas import ProcessEventsResult
from app.services.events.service import ProcessEventsService

logger = logging.getLogger(__name__)


class ProcessEventsJobRunner:
    def __init__(self, process_events_service: ProcessEventsService) -> None:
        self.process_events_service = process_events_service
        self._lock = asyncio.Lock()

    async def run(self) -> ProcessEventsResult | None:
        if self._lock.locked():
            logger.info("process-events skipped because a previous run is still active")
            return None

        async with self._lock:
            return await self.process_events_service.process()
