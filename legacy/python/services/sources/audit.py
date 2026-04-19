from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import RawItem, Source, SourceRun, SourceRunStatus
from app.services.russia import assess_russia_source_review


@dataclass(frozen=True, slots=True)
class SourceAuditRow:
    source: Source
    total_runs: int
    success_runs: int
    partial_runs: int
    failed_runs: int
    last_success_at: datetime | None
    last_http_status: int | None
    raw_item_count: int
    error_rate: float


class SourceAuditService:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def build_report(self, limit: int = 100, *, region: str | None = None, status: str | None = None) -> dict[str, object]:
        safe_limit = max(1, min(limit, 500))
        stmt = select(Source).order_by(Source.editorial_priority.asc(), Source.priority_weight.asc(), Source.id.asc()).limit(safe_limit)
        if region is not None:
            stmt = stmt.where(Source.region == region)
        if status is not None:
            stmt = stmt.where(Source.status == status)
        sources = list((await self.session.scalars(stmt)).all())
        source_ids = [source.id for source in sources]
        if not source_ids:
            return {
                "items": [],
                "summary": {
                    "total_sources": 0,
                    "status_breakdown": {},
                    "role_breakdown": {},
                    "region_breakdown": {},
                },
            }

        run_rows = (
            await self.session.execute(
                select(
                    SourceRun.source_id,
                    SourceRun.status,
                    func.count(SourceRun.id),
                    func.max(SourceRun.finished_at),
                )
                .where(SourceRun.source_id.in_(source_ids))
                .group_by(SourceRun.source_id, SourceRun.status)
            )
        ).all()
        raw_item_rows = (
            await self.session.execute(
                select(RawItem.source_id, func.count(RawItem.id))
                .where(RawItem.source_id.in_(source_ids))
                .group_by(RawItem.source_id)
            )
        ).all()

        raw_item_counts = {int(source_id): int(count) for source_id, count in raw_item_rows}
        run_stats: dict[int, dict[str, object]] = {source_id: {} for source_id in source_ids}
        for source_id, status, count, max_finished_at in run_rows:
            stats = run_stats[int(source_id)]
            stats[status.value] = int(count)
            if status in (SourceRunStatus.SUCCESS, SourceRunStatus.PARTIAL):
                previous_last_success = stats.get("last_success_at")
                if previous_last_success is None or (
                    max_finished_at is not None and max_finished_at > previous_last_success
                ):
                    stats["last_success_at"] = max_finished_at

        items: list[dict[str, object]] = []
        status_breakdown: dict[str, int] = {}
        role_breakdown: dict[str, int] = {}
        region_breakdown: dict[str, int] = {}
        for source in sources:
            stats = run_stats.get(source.id, {})
            success_runs = int(stats.get(SourceRunStatus.SUCCESS.value, 0))
            partial_runs = int(stats.get(SourceRunStatus.PARTIAL.value, 0))
            failed_runs = int(stats.get(SourceRunStatus.FAILED.value, 0))
            total_runs = success_runs + partial_runs + failed_runs
            effective_success_runs = success_runs + partial_runs
            error_rate = round(failed_runs / total_runs, 3) if total_runs else 0.0
            audit_row = SourceAuditRow(
                source=source,
                total_runs=total_runs,
                success_runs=effective_success_runs,
                partial_runs=partial_runs,
                failed_runs=failed_runs,
                last_success_at=stats.get("last_success_at", source.last_success_at),
                last_http_status=source.last_http_status,
                raw_item_count=raw_item_counts.get(source.id, 0),
                error_rate=error_rate,
            )
            items.append(self._serialize_row(audit_row))
            status_breakdown[source.status.value] = status_breakdown.get(source.status.value, 0) + 1
            role_breakdown[source.role.value] = role_breakdown.get(source.role.value, 0) + 1
            region_breakdown[source.region.value] = region_breakdown.get(source.region.value, 0) + 1

        return {
            "items": items,
            "summary": {
                "total_sources": len(items),
                "status_breakdown": status_breakdown,
                "role_breakdown": role_breakdown,
                "region_breakdown": region_breakdown,
            },
            "filters": {
                "region": region,
                "status": status,
            },
        }

    def _serialize_row(self, row: SourceAuditRow) -> dict[str, object]:
        russia_review = assess_russia_source_review(
            source=row.source,
            error_rate=row.error_rate,
            success_runs=row.success_runs,
            raw_item_count=row.raw_item_count,
        )
        return {
            "source_id": row.source.id,
            "title": row.source.title,
            "source_type": row.source.source_type.value,
            "role": row.source.role.value,
            "region": row.source.region.value,
            "status": row.source.status.value,
            "is_active": row.source.is_active,
            "priority_weight": row.source.priority_weight,
            "editorial_priority": row.source.editorial_priority,
            "noise_score": row.source.noise_score,
            "last_success_at": row.last_success_at.isoformat() if row.last_success_at else None,
            "last_http_status": row.last_http_status,
            "total_runs": row.total_runs,
            "success_runs": row.success_runs,
            "partial_runs": row.partial_runs,
            "failed_runs": row.failed_runs,
            "error_rate": row.error_rate,
            "raw_item_count": row.raw_item_count,
            "russia_review": None
            if russia_review is None
            else {
                "production_ready": russia_review.production_ready,
                "recommendation": russia_review.recommendation,
                "reasons": russia_review.reasons,
                "weak_local_pr_risk": russia_review.weak_local_pr_risk,
                "source_profile": russia_review.source_profile,
            },
        }
