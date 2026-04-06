from __future__ import annotations

from app.db.models import Source, SourceRegion, SourceRole, SourceStatus, SourceType


async def test_source_schema_defaults_are_backward_compatible(session_factory):
    async with session_factory() as session:
        source = Source(
            source_type=SourceType.WEBSITE,
            title="Example source",
            handle_or_url="https://example.com/feed",
            priority_weight=80,
            is_active=True,
            language="en",
            country_scope="global",
        )
        session.add(source)
        await session.commit()
        await session.refresh(source)

    assert source.role is SourceRole.SIGNAL_FEEDER
    assert source.region is SourceRegion.GLOBAL
    assert source.status is SourceStatus.ACTIVE
    assert source.editorial_priority == 100
    assert source.noise_score == 0.0
    assert source.last_success_at is None
    assert source.last_http_status is None
