from __future__ import annotations

import asyncio
from collections.abc import AsyncGenerator

import pytest
from sqlalchemy.pool import StaticPool
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.db.base import Base


@pytest.fixture(scope="session")
def event_loop() -> asyncio.AbstractEventLoop:
    loop = asyncio.new_event_loop()
    yield loop
    loop.close()


@pytest.fixture()
async def session_factory() -> AsyncGenerator[async_sessionmaker[AsyncSession], None]:
    engine = create_async_engine(
        "sqlite+aiosqlite:///:memory:",
        poolclass=StaticPool,
    )
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    yield factory

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
    await engine.dispose()


@pytest.fixture()
async def db_session(session_factory: async_sessionmaker[AsyncSession]) -> AsyncGenerator[AsyncSession, None]:
    async with session_factory() as session:
        yield session
