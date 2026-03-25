from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import Source


class SourceService:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def list_sources(self, active_only: bool = False) -> list[Source]:
        stmt = select(Source).order_by(Source.priority_weight.asc(), Source.id.asc())
        if active_only:
            stmt = stmt.where(Source.is_active.is_(True))
        result = await self.session.scalars(stmt)
        return list(result.all())
