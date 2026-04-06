from __future__ import annotations

from datetime import UTC, datetime

from app.db.models import RawItem, RawItemStatus, Source, SourceRegion, SourceRole, SourceRun, SourceRunStatus, SourceStatus, SourceType
from app.services.sources.audit import SourceAuditService


async def test_source_audit_builds_health_report(session_factory):
    async with session_factory() as session:
        source = Source(
            source_type=SourceType.WEBSITE,
            title="TechCrunch AI",
            handle_or_url="https://techcrunch.com/category/artificial-intelligence/",
            priority_weight=92,
            editorial_priority=95,
            noise_score=0.18,
            is_active=True,
            language="en",
            country_scope="global",
            role=SourceRole.SIGNAL_FEEDER,
            region=SourceRegion.GLOBAL,
            status=SourceStatus.ACTIVE,
            last_http_status=200,
            last_success_at=datetime(2026, 4, 1, 12, 0, tzinfo=UTC),
        )
        session.add(source)
        await session.flush()

        session.add_all(
            [
                SourceRun(
                    source_id=source.id,
                    started_at=datetime(2026, 4, 1, 11, 0, tzinfo=UTC),
                    finished_at=datetime(2026, 4, 1, 11, 0, 2, tzinfo=UTC),
                    status=SourceRunStatus.SUCCESS,
                    fetched_count=5,
                    inserted_count=2,
                    duplicate_count=3,
                    failed_count=0,
                    duration_ms=2000,
                ),
                SourceRun(
                    source_id=source.id,
                    started_at=datetime(2026, 4, 1, 12, 0, tzinfo=UTC),
                    finished_at=datetime(2026, 4, 1, 12, 0, 1, tzinfo=UTC),
                    status=SourceRunStatus.FAILED,
                    fetched_count=0,
                    inserted_count=0,
                    duplicate_count=0,
                    failed_count=1,
                    duration_ms=1000,
                    error_message="boom",
                ),
                RawItem(
                    source_id=source.id,
                    external_id="tc-1",
                    source_type=SourceType.WEBSITE,
                    canonical_url="https://techcrunch.com/example",
                    raw_title="Example story",
                    raw_text="Example story body",
                    raw_payload_json={"title": "Example story"},
                    language="en",
                    status=RawItemStatus.FETCHED,
                ),
            ]
        )
        await session.commit()

        report = await SourceAuditService(session).build_report()

    assert report["summary"]["total_sources"] == 1
    assert report["summary"]["status_breakdown"]["active"] == 1
    item = report["items"][0]
    assert item["title"] == "TechCrunch AI"
    assert item["total_runs"] == 2
    assert item["success_runs"] == 1
    assert item["failed_runs"] == 1
    assert item["raw_item_count"] == 1
    assert item["last_http_status"] == 200
    assert item["error_rate"] == 0.5
    assert item["russia_review"] is None


async def test_source_audit_exposes_russia_review_readiness(session_factory):
    async with session_factory() as session:
        source = Source(
            source_type=SourceType.WEBSITE,
            title="ТАСС Технологии",
            handle_or_url="https://tass.ru/ekonomika",
            priority_weight=80,
            editorial_priority=90,
            noise_score=0.2,
            is_active=True,
            language="ru",
            country_scope="russia",
            role=SourceRole.RUSSIA,
            region=SourceRegion.RUSSIA,
            status=SourceStatus.QUARANTINE,
            last_http_status=200,
            last_success_at=datetime(2026, 4, 1, 12, 0, tzinfo=UTC),
        )
        session.add(source)
        await session.flush()
        session.add(
            SourceRun(
                source_id=source.id,
                started_at=datetime(2026, 4, 1, 11, 0, tzinfo=UTC),
                finished_at=datetime(2026, 4, 1, 11, 0, 2, tzinfo=UTC),
                status=SourceRunStatus.SUCCESS,
                fetched_count=4,
                inserted_count=2,
                duplicate_count=2,
                failed_count=0,
                duration_ms=2000,
            )
        )
        session.add(
            RawItem(
                source_id=source.id,
                external_id="tass-1",
                source_type=SourceType.WEBSITE,
                canonical_url="https://tass.ru/example",
                raw_title="Example story",
                raw_text="Example story body",
                raw_payload_json={"title": "Example story"},
                language="ru",
                status=RawItemStatus.FETCHED,
            )
        )
        await session.commit()

        report = await SourceAuditService(session).build_report(region="russia")

    assert report["summary"]["region_breakdown"]["russia"] == 1
    item = report["items"][0]
    assert item["russia_review"]["production_ready"] is True
    assert item["russia_review"]["recommendation"] == "promote_from_quarantine"
    assert item["russia_review"]["weak_local_pr_risk"] is False


async def test_source_audit_keeps_weak_russia_pr_source_in_quarantine(session_factory):
    async with session_factory() as session:
        source = Source(
            source_type=SourceType.WEBSITE,
            title="Форум AI Россия",
            handle_or_url="https://forum.example.ru/press",
            priority_weight=70,
            editorial_priority=110,
            noise_score=0.45,
            is_active=True,
            language="ru",
            country_scope="russia",
            role=SourceRole.RUSSIA,
            region=SourceRegion.RUSSIA,
            status=SourceStatus.QUARANTINE,
            last_http_status=200,
            last_success_at=datetime(2026, 4, 1, 12, 0, tzinfo=UTC),
        )
        session.add(source)
        await session.flush()
        session.add(
            SourceRun(
                source_id=source.id,
                started_at=datetime(2026, 4, 1, 11, 0, tzinfo=UTC),
                finished_at=datetime(2026, 4, 1, 11, 0, 2, tzinfo=UTC),
                status=SourceRunStatus.SUCCESS,
                fetched_count=5,
                inserted_count=3,
                duplicate_count=2,
                failed_count=0,
                duration_ms=2000,
            )
        )
        session.add(
            RawItem(
                source_id=source.id,
                external_id="forum-1",
                source_type=SourceType.WEBSITE,
                canonical_url="https://forum.example.ru/press/story",
                raw_title="Форум рассказал об AI-направлении",
                raw_text="Организаторы форума поделились новостями о мероприятии и AI-направлении.",
                raw_payload_json={"title": "Форум рассказал об AI-направлении"},
                language="ru",
                status=RawItemStatus.FETCHED,
            )
        )
        await session.commit()

        report = await SourceAuditService(session).build_report(region="russia")

    item = report["items"][0]
    assert item["russia_review"]["production_ready"] is False
    assert item["russia_review"]["recommendation"] == "keep_quarantine"
    assert item["russia_review"]["weak_local_pr_risk"] is True
    assert item["russia_review"]["source_profile"] == "weak_local_pr"
    assert "weak_pr_source_risk" in item["russia_review"]["reasons"]
