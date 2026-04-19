from __future__ import annotations

from dataclasses import asdict
from datetime import date

from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.db.models import AlphaEntry, AlphaEntryStatus
from app.services.alpha.schemas import AlphaEntryCreate, AlphaEntryUpdate


class AlphaService:
    def __init__(self, session_factory: async_sessionmaker[AsyncSession]) -> None:
        self.session_factory = session_factory

    async def list_entries(
        self,
        *,
        status: AlphaEntryStatus | None = None,
        publish_date: date | None = None,
        limit: int = 20,
    ) -> list[AlphaEntry]:
        async with self.session_factory() as session:
            stmt = select(AlphaEntry).order_by(AlphaEntry.publish_date.desc(), AlphaEntry.priority_rank.asc(), AlphaEntry.id.desc()).limit(limit)
            if status is not None:
                stmt = stmt.where(AlphaEntry.status == status)
            if publish_date is not None:
                stmt = stmt.where(AlphaEntry.publish_date == publish_date)
            return list((await session.scalars(stmt)).all())

    async def get_entry(self, entry_id: int) -> AlphaEntry | None:
        async with self.session_factory() as session:
            return await session.get(AlphaEntry, entry_id)

    async def create_entry(self, payload: AlphaEntryCreate) -> AlphaEntry:
        async with self.session_factory() as session:
            entry = AlphaEntry(**asdict(payload))
            session.add(entry)
            await session.commit()
            await session.refresh(entry)
            return entry

    async def update_entry(self, entry_id: int, payload: AlphaEntryUpdate) -> AlphaEntry | None:
        async with self.session_factory() as session:
            entry = await session.get(AlphaEntry, entry_id)
            if entry is None:
                return None
            for field_name, value in asdict(payload).items():
                if value is not None:
                    setattr(entry, field_name, value)
            await session.commit()
            await session.refresh(entry)
            return entry

    async def publish_entry(self, entry_id: int) -> AlphaEntry | None:
        return await self.update_entry(entry_id, AlphaEntryUpdate(status=AlphaEntryStatus.PUBLISHED))

    async def list_published_for_period(self, start: date, end: date) -> list[AlphaEntry]:
        async with self.session_factory() as session:
            stmt = (
                select(AlphaEntry)
                .where(
                    and_(
                        AlphaEntry.status == AlphaEntryStatus.PUBLISHED,
                        AlphaEntry.publish_date >= start,
                        AlphaEntry.publish_date <= end,
                    )
                )
                .order_by(AlphaEntry.publish_date.desc(), AlphaEntry.priority_rank.asc(), AlphaEntry.id.asc())
            )
            return list((await session.scalars(stmt)).all())
