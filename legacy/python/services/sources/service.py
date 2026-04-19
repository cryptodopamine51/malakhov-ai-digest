from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import Source
from app.services.sources.policy import should_source_be_active


class SourceService:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def list_sources(self, active_only: bool = False) -> list[Source]:
        stmt = select(Source).order_by(Source.editorial_priority.asc(), Source.priority_weight.asc(), Source.id.asc())
        result = await self.session.scalars(stmt)
        sources = list(result.all())
        if not active_only:
            return sources
        return [
            source
            for source in sources
            if should_source_be_active(status=source.status, is_active=source.is_active)
        ]
