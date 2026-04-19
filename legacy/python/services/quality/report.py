from __future__ import annotations

from collections import Counter, defaultdict
from datetime import UTC, datetime, timedelta
from statistics import median

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker
from sqlalchemy.orm import selectinload

from app.db.models import (
    Delivery,
    DigestIssue,
    DigestIssueItem,
    DigestIssueType,
    DigestSection,
    Event,
    ProcessRun,
    Source,
    SourceRun,
)
from app.services.digest import DigestBuilderService
from app.services.digest.telegram_policy import TelegramPackageSection, get_telegram_packaging_policy
from app.services.russia import qualifies_for_ai_russia_event
from app.services.site import compute_event_importance, select_homepage_events


class QualityReportService:
    def __init__(
        self,
        session_factory: async_sessionmaker[AsyncSession],
        digest_builder: DigestBuilderService,
    ) -> None:
        self.session_factory = session_factory
        self.digest_builder = digest_builder
        self.telegram_policy = get_telegram_packaging_policy()

    async def build_report(self, *, days: int = 7) -> dict[str, object]:
        safe_days = max(1, min(days, 30))
        window_end = datetime.now(UTC)
        window_start = window_end - timedelta(days=safe_days)
        event_start_date = window_start.date()

        async with self.session_factory() as session:
            sources = await self._load_sources(session)
            source_runs = await self._load_source_runs(session, window_start)
            process_runs = await self._load_process_runs(session, window_start)
            events = await self._load_events(session, event_start_date)
            deliveries = await self._load_deliveries(session, window_start)
            daily_issues = await self._load_daily_issues(session, event_start_date)
            raw_items_by_source = await self._raw_items_by_source(session, window_start)

        telegram_stats = await self._telegram_packaging_stats(daily_issues)
        homepage_hit_ids = self._homepage_surface_hit_ids(events)
        importance_by_event_id = {event.id: compute_event_importance(event) for event in events}
        return {
            "window": {
                "days": safe_days,
                "start": window_start.isoformat(),
                "end": window_end.isoformat(),
            },
            "sources": self._source_quality_report(
                sources=sources,
                source_runs=source_runs,
                events=events,
                raw_items_by_source=raw_items_by_source,
                telegram_hits_by_source=telegram_stats["telegram_hits_by_source"],
                ai_russia_hits_by_source=telegram_stats["ai_russia_hits_by_source"],
                homepage_hit_ids=homepage_hit_ids,
                importance_by_event_id=importance_by_event_id,
            ),
            "shortlist": self._shortlist_quality_report(process_runs),
            "events": self._event_quality_report(events, importance_by_event_id),
            "telegram": self._telegram_quality_report(daily_issues, telegram_stats),
            "ai_in_russia": self._ai_russia_quality_report(events, telegram_stats["ai_russia_hits_by_source"], importance_by_event_id),
            "delivery": self._delivery_quality_report(deliveries),
        }

    async def _load_sources(self, session: AsyncSession) -> list[Source]:
        return list((await session.scalars(select(Source).order_by(Source.editorial_priority.asc(), Source.priority_weight.asc(), Source.id.asc()))).all())

    async def _load_source_runs(self, session: AsyncSession, window_start: datetime) -> list[SourceRun]:
        return list((await session.scalars(select(SourceRun).where(SourceRun.started_at >= window_start).options(selectinload(SourceRun.source)))).all())

    async def _load_process_runs(self, session: AsyncSession, window_start: datetime) -> list[ProcessRun]:
        return list((await session.scalars(select(ProcessRun).where(ProcessRun.started_at >= window_start).order_by(ProcessRun.started_at.asc(), ProcessRun.id.asc()))).all())

    async def _load_events(self, session: AsyncSession, event_start_date) -> list[Event]:
        return list(
            (
                await session.scalars(
                    select(Event)
                    .where(Event.event_date >= event_start_date)
                    .options(selectinload(Event.primary_source), selectinload(Event.categories))
                    .order_by(Event.event_date.asc(), Event.id.asc())
                )
            ).all()
        )

    async def _load_deliveries(self, session: AsyncSession, window_start: datetime) -> list[Delivery]:
        return list((await session.scalars(select(Delivery).where(Delivery.sent_at >= window_start).options(selectinload(Delivery.issue)))).all())

    async def _load_daily_issues(self, session: AsyncSession, event_start_date) -> list[DigestIssue]:
        return list(
            (
                await session.scalars(
                    select(DigestIssue)
                    .where(DigestIssue.issue_type == DigestIssueType.DAILY, DigestIssue.issue_date >= event_start_date)
                    .options(
                        selectinload(DigestIssue.items)
                        .selectinload(DigestIssueItem.event)
                        .selectinload(Event.primary_source),
                        selectinload(DigestIssue.items)
                        .selectinload(DigestIssueItem.event)
                        .selectinload(Event.categories),
                    )
                    .order_by(DigestIssue.issue_date.asc(), DigestIssue.id.asc())
                )
            ).all()
        )

    async def _raw_items_by_source(self, session: AsyncSession, window_start: datetime) -> dict[int, int]:
        rows = (
            await session.execute(
                select(Source.id, Source.id)
                .select_from(Source)
            )
        ).all()
        counts: dict[int, int] = {int(source_id): 0 for source_id, _ in rows}
        from app.db.models import RawItem  # local import to avoid unused import noise

        raw_items = list((await session.scalars(select(RawItem).where(RawItem.fetched_at >= window_start))).all())
        for raw_item in raw_items:
            counts[raw_item.source_id] = counts.get(raw_item.source_id, 0) + 1
        return counts

    async def _telegram_packaging_stats(self, issues: list[DigestIssue]) -> dict[str, object]:
        per_section = Counter()
        excluded_reasons = Counter()
        telegram_hits_by_source: Counter[int] = Counter()
        ai_russia_hits_by_source: Counter[int] = Counter()
        broader_items = 0
        selected_items = 0
        weak_day_count = 0
        previews: list[dict[str, object]] = []

        for issue in issues:
            broader_items += sum(1 for item in issue.items if item.section is DigestSection.ALL and item.event_id is not None)
            preview = await self.digest_builder.get_daily_main_preview(issue.id)
            if preview is None:
                continue
            previews.append(preview.policy_snapshot)
            if preview.policy_snapshot.get("weak_day_mode"):
                weak_day_count += 1
            for section, items in preview.visible_by_section.items():
                event_items = [item for item in items if item.event_id is not None]
                per_section[section.value] += len(event_items)
                selected_items += len(event_items)
                for item in event_items:
                    if item.event is None or item.event.primary_source_id is None:
                        continue
                    telegram_hits_by_source[item.event.primary_source_id] += 1
                    if section is TelegramPackageSection.AI_RUSSIA:
                        ai_russia_hits_by_source[item.event.primary_source_id] += 1
            for excluded in preview.excluded:
                excluded_reasons[excluded.reason] += 1

        return {
            "broader_items": broader_items,
            "selected_items": selected_items,
            "per_section": dict(per_section),
            "excluded_reasons": dict(excluded_reasons),
            "weak_day_count": weak_day_count,
            "telegram_hits_by_source": telegram_hits_by_source,
            "ai_russia_hits_by_source": ai_russia_hits_by_source,
            "policy_snapshot": {
                "min_ranking_score": self.telegram_policy.min_ranking_score,
                "fallback_min_score": self.telegram_policy.fallback_min_score,
                "total_cap": self.telegram_policy.total_cap,
                "weak_day_total_cap": self.telegram_policy.weak_day_total_cap,
                "section_caps": {section.value: cap for section, cap in self.telegram_policy.section_caps.items()},
            },
        }

    def _homepage_surface_hit_ids(self, events: list[Event]) -> set[int]:
        by_day: dict[object, list[Event]] = defaultdict(list)
        for event in events:
            by_day[event.event_date].append(event)
        hit_ids: set[int] = set()
        for day_events in by_day.values():
            for event in select_homepage_events(day_events):
                hit_ids.add(event.id)
        return hit_ids

    def _source_quality_report(
        self,
        *,
        sources: list[Source],
        source_runs: list[SourceRun],
        events: list[Event],
        raw_items_by_source: dict[int, int],
        telegram_hits_by_source: Counter[int],
        ai_russia_hits_by_source: Counter[int],
        homepage_hit_ids: set[int],
        importance_by_event_id: dict[int, object],
    ) -> dict[str, object]:
        status_breakdown = Counter(source.status.value for source in sources)
        role_breakdown = Counter(source.role.value for source in sources)
        region_breakdown = Counter(source.region.value for source in sources)
        runs_by_source: dict[int, list[SourceRun]] = defaultdict(list)
        for run in source_runs:
            runs_by_source[run.source_id].append(run)
        events_by_source = Counter(event.primary_source_id for event in events if event.primary_source_id is not None)
        homepage_hits_by_source = Counter(
            event.primary_source_id
            for event in events
            if event.id in homepage_hit_ids and event.primary_source_id is not None
        )
        demoted_by_source = Counter(
            event.primary_source_id
            for event in events
            if event.primary_source_id is not None and getattr(importance_by_event_id.get(event.id), "excluded", False)
        )
        consequence_demoted_by_source = Counter(
            event.primary_source_id
            for event in events
            if event.primary_source_id is not None and getattr(importance_by_event_id.get(event.id), "consequence_gate_triggered", False)
        )
        items: list[dict[str, object]] = []
        for source in sources:
            runs = runs_by_source.get(source.id, [])
            success_runs = sum(1 for run in runs if run.status.value in {"success", "partial"})
            failed_runs = sum(1 for run in runs if run.status.value == "failed")
            total_runs = len(runs)
            success_rate = round(success_runs / total_runs, 3) if total_runs else None
            items.append(
                {
                    "source_id": source.id,
                    "title": source.title,
                    "role": source.role.value,
                    "region": source.region.value,
                    "status": source.status.value,
                    "is_active": source.is_active,
                    "run_count": total_runs,
                    "success_rate": success_rate,
                    "raw_item_count": raw_items_by_source.get(source.id, 0),
                    "event_count": events_by_source.get(source.id, 0),
                    "homepage_surface_hit_count": homepage_hits_by_source.get(source.id, 0),
                    "telegram_hit_count": telegram_hits_by_source.get(source.id, 0),
                    "ai_russia_hit_count": ai_russia_hits_by_source.get(source.id, 0),
                    "surface_demoted_event_count": demoted_by_source.get(source.id, 0),
                    "consequence_demoted_event_count": consequence_demoted_by_source.get(source.id, 0),
                }
            )
        surfaced_source_role_breakdown = Counter(
            item["role"]
            for item in items
            for _ in range(int(item["homepage_surface_hit_count"]))
        )
        return {
            "summary": {
                "total_sources": len(sources),
                "status_breakdown": dict(status_breakdown),
                "role_breakdown": dict(role_breakdown),
                "region_breakdown": dict(region_breakdown),
                "homepage_surface_role_breakdown": dict(surfaced_source_role_breakdown),
            },
            "sources": items,
            "top_sources_by_events": sorted(items, key=lambda item: (item["event_count"], item["telegram_hit_count"]), reverse=True)[:10],
            "top_sources_by_homepage": sorted(
                items,
                key=lambda item: (
                    item["homepage_surface_hit_count"],
                    -item["consequence_demoted_event_count"],
                    item["event_count"],
                ),
                reverse=True,
            )[:10],
            "top_sources_by_surface_demotions": sorted(
                [item for item in items if item["surface_demoted_event_count"] > 0],
                key=lambda item: (
                    item["surface_demoted_event_count"],
                    item["consequence_demoted_event_count"],
                ),
                reverse=True,
            )[:10],
        }

    def _shortlist_quality_report(self, process_runs: list[ProcessRun]) -> dict[str, object]:
        evaluated = sum(run.raw_shortlist_evaluated_count for run in process_runs)
        accepted = sum(run.raw_shortlist_accepted_count for run in process_runs)
        rejected = sum(run.raw_shortlist_rejected_count for run in process_runs)
        reasons = Counter()
        for run in process_runs:
            for reason, count in (run.raw_shortlist_reject_breakdown_json or {}).items():
                reasons[reason] += int(count)
        return {
            "total_evaluated": evaluated,
            "accepted": accepted,
            "rejected": rejected,
            "reject_rate": round(rejected / evaluated, 3) if evaluated else 0.0,
            "reject_breakdown": dict(reasons),
            "top_reject_reasons": [{"reason": reason, "count": count} for reason, count in reasons.most_common(5)],
        }

    def _event_quality_report(self, events: list[Event], importance_by_event_id: dict[int, object]) -> dict[str, object]:
        ranking_scores = [event.ranking_score for event in events]
        verification_count = sum(1 for event in events if event.has_verification_source)
        support_distribution = Counter(event.supporting_source_count for event in events)
        canonical_distribution = Counter(event.primary_source.title for event in events if event.primary_source is not None)
        tier_distribution = Counter(
            getattr(importance_by_event_id.get(event.id), "tier", None).value
            for event in events
            if importance_by_event_id.get(event.id) is not None
        )
        surface_exclusion_breakdown = Counter(
            getattr(importance_by_event_id.get(event.id), "exclusion_reason", None)
            for event in events
            if getattr(importance_by_event_id.get(event.id), "excluded", False)
            and getattr(importance_by_event_id.get(event.id), "exclusion_reason", None) is not None
        )
        return {
            "event_count": len(events),
            "average_ranking_score": round(sum(ranking_scores) / len(ranking_scores), 3) if ranking_scores else 0.0,
            "median_ranking_score": round(float(median(ranking_scores)), 3) if ranking_scores else 0.0,
            "verification_coverage_rate": round(verification_count / len(events), 3) if events else 0.0,
            "supporting_source_count_distribution": {str(key): value for key, value in sorted(support_distribution.items())},
            "canonical_source_distribution": dict(canonical_distribution.most_common(10)),
            "surface_tier_distribution": dict(tier_distribution),
            "surface_exclusion_breakdown": dict(surface_exclusion_breakdown),
        }

    def _telegram_quality_report(self, issues: list[DigestIssue], telegram_stats: dict[str, object]) -> dict[str, object]:
        broader_items = int(telegram_stats["broader_items"])
        selected_items = int(telegram_stats["selected_items"])
        return {
            "daily_issue_count": len(issues),
            "broader_issue_items": broader_items,
            "telegram_selected_items": selected_items,
            "selection_rate": round(selected_items / broader_items, 3) if broader_items else 0.0,
            "per_section_distribution": telegram_stats["per_section"],
            "excluded_reason_breakdown": telegram_stats["excluded_reasons"],
            "weak_day_activations": telegram_stats["weak_day_count"],
            "policy_snapshot": telegram_stats["policy_snapshot"],
        }

    def _ai_russia_quality_report(
        self,
        events: list[Event],
        ai_russia_hits_by_source: Counter[int],
        importance_by_event_id: dict[int, object],
    ) -> dict[str, object]:
        russia_tagged = [
            event
            for event in events
            if event.primary_source is not None and getattr(event.primary_source, "region", None) is not None and event.primary_source.region.value == "russia"
        ]
        qualified = [event for event in events if qualifies_for_ai_russia_event(event)]
        weak_pr_penalty_count = sum(1 for event in events if bool((event.score_components_json or {}).get("russia_weak_pr_penalty")))
        surface_excluded = [
            event
            for event in russia_tagged
            if getattr(importance_by_event_id.get(event.id), "excluded", False)
        ]
        top_sources = Counter(
            event.primary_source.title
            for event in qualified
            if event.primary_source is not None and getattr(event.primary_source, "region", None) is not None and event.primary_source.region.value == "russia"
        )
        return {
            "russia_qualified_event_count": len(qualified),
            "russia_tagged_but_excluded_count": max(len(russia_tagged) - len([event for event in qualified if event in russia_tagged]), 0),
            "weak_pr_penalty_activations": weak_pr_penalty_count,
            "top_russia_sources_by_qualified_events": dict(top_sources.most_common(10)),
            "top_russia_sources_by_telegram_hits": dict(ai_russia_hits_by_source.most_common(10)),
            "surface_excluded_russia_event_count": len(surface_excluded),
        }

    def _delivery_quality_report(self, deliveries: list[Delivery]) -> dict[str, object]:
        by_type = Counter(delivery.delivery_type.value for delivery in deliveries)
        by_status = Counter(delivery.status.value for delivery in deliveries)
        return {
            "delivery_count": len(deliveries),
            "by_type": dict(by_type),
            "by_status": dict(by_status),
        }
