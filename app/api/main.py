from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager
from datetime import date as date_cls, datetime
from email.message import EmailMessage
from html import escape as html_escape
import re
import smtplib
import ssl

from aiogram.types import BufferedInputFile
from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import HTMLResponse, Response
from sqlalchemy import desc, select, text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker
from sqlalchemy.orm import selectinload

from app.core.config import get_settings
from app.core.digest_dates import default_daily_issue_date, default_weekly_issue_date
from app.core.logging import configure_logging
from app.db.models import (
    AlphaEntryStatus,
    Delivery,
    DigestIssue,
    DigestIssueItem,
    DigestIssueType,
    DigestSection,
    Event,
    EventCategory,
    EventSection,
    EventSource,
    EventTag,
    LlmUsageLog,
    ProcessRun,
    RawItem,
    RawItemStatus,
    Source,
    SourceRun,
    SourceType,
    User,
)
from app.db.session import AsyncSessionLocal
from app.jobs import (
    build_daily_issue,
    build_weekly_issue,
    create_scheduler,
    log_registered_jobs,
    register_digest_jobs,
    register_ingestion_job,
    register_process_events_job,
    serialize_scheduler_jobs,
    send_daily_issue,
    send_weekly_issue,
)
from app.bot.dispatcher import create_bot, start_polling
from app.api.routes.internal_alpha import register_internal_alpha_routes
from app.services.alpha import AlphaService
from app.services.events import ProcessEventsJobRunner, ProcessEventsService
from app.services.ingestion import IngestionJobRunner, IngestionService
from app.services.digest import DigestBuilderService
from app.services.deliveries import IssueDeliveryService
from app.services.editorial import get_ru_editorial_policy
from app.services.quality import QualityReportService
from app.services.russia import qualifies_for_ai_russia_event
from app.services.shortlist import RawItemShortlistService
from app.services.site import compute_event_importance, select_homepage_events, sort_site_events
from app.services.sources.reputation import classify_source_pool_role, score_source
from app.services.sources import (
    OfficialBlogAdapter,
    RssFeedAdapter,
    SourceAuditService,
    SourceHttpClient,
    SourceRegistry,
    WebsiteFeedAdapter,
)
from app.web import (
    build_event_slug,
    build_issue_editorial_sections,
    build_issue_intro,
    event_href,
    filter_publishable_site_items,
    is_publishable_site_item,
    render_alpha_page,
    render_event_detail_page,
    render_events_feed_page,
    render_homepage_preview,
    render_issue_detail_page,
    render_issue_section_page,
    render_site_alpha_page,
    render_site_event_detail_page,
    render_site_events_page,
    render_site_homepage,
    render_site_issue_detail_page,
    render_site_issue_section_page,
    render_site_issues_page,
    select_site_russia_events,
)


def _serialize_datetime(value: datetime | None) -> str | None:
    return value.isoformat() if value else None


_SITE_LEAD_ALLOWED_FILE_TYPES = {
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "text/plain",
    "image/png",
    "image/jpeg",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
}
_SITE_LEAD_MAX_FILE_SIZE = 10 * 1024 * 1024
_SITE_LEAD_REQUEST_TAGS = {
    "Аудит": "#аудит",
    "Пилот": "#пилот",
    "Проект": "#проект",
    "Внедрение": "#экосистема",
}


def _normalize_site_lead_text(value: str | None) -> str | None:
    if value is None:
        return None
    compact = re.sub(r"\s+", " ", value).strip()
    return compact or None


def _format_site_lead_message(
    *,
    name: str,
    company: str | None,
    contact: str,
    description: str,
    request_type: str | None,
    subject: str | None,
    page: str | None,
    utm: str | None,
) -> str:
    now = datetime.now().astimezone().strftime("%d.%m.%Y %H:%M")
    request_tag = _SITE_LEAD_REQUEST_TAGS.get(request_type or "", "")
    tags = " ".join(part for part in ("#заявка", "#malakhovai", request_tag) if part)
    lines = [
        tags,
        "",
        f"<b>Тип запроса:</b> {html_escape(request_type or '—')}",
        f"<b>Имя:</b> {html_escape(name)}",
        f"<b>Контакт:</b> {html_escape(contact)}",
    ]
    if company:
        lines.append(f"<b>Компания:</b> {html_escape(company)}")
    lines.append(f"<b>Описание:</b> {html_escape(description)}")
    if subject:
        lines.append(f"<b>Тема:</b> {html_escape(subject)}")
    if page:
        lines.append(f"<b>Страница:</b> {html_escape(page)}")
    if utm:
        lines.append(f"<b>UTM:</b> {html_escape(utm)}")
    lines.append(f"<b>Время:</b> {html_escape(now)}")
    return "\n".join(lines)


def _format_site_lead_email_subject(
    *,
    name: str,
    request_type: str | None,
    subject: str | None,
) -> str:
    parts = ["Новая заявка с malakhovai.ru"]
    if request_type:
        parts.append(request_type)
    elif subject:
        parts.append(subject)
    parts.append(name)
    return " | ".join(parts)


def _format_site_lead_email_body(
    *,
    name: str,
    company: str | None,
    contact: str,
    description: str,
    request_type: str | None,
    subject: str | None,
    page: str | None,
    utm: str | None,
) -> str:
    now = datetime.now().astimezone().strftime("%d.%m.%Y %H:%M")
    lines = [
        "Новая заявка с сайта malakhovai.ru",
        "",
        f"Тип запроса: {request_type or '—'}",
        f"Имя: {name}",
        f"Контакт: {contact}",
    ]
    if company:
        lines.append(f"Компания: {company}")
    lines.append("")
    lines.append("Описание:")
    lines.append(description)
    if subject:
        lines.append("")
        lines.append(f"Тема: {subject}")
    if page:
        lines.append(f"Страница: {page}")
    if utm:
        lines.append(f"UTM: {utm}")
    lines.append(f"Время: {now}")
    return "\n".join(lines)


def _site_leads_email_configured(settings) -> bool:
    return bool(
        settings.smtp_host
        and settings.smtp_port
        and settings.smtp_user
        and settings.smtp_pass
        and settings.leads_email_to
        and settings.leads_email_from
    )


def _send_site_lead_email_sync(
    *,
    settings,
    subject: str,
    body: str,
    file_bytes: bytes | None,
    file_name: str | None,
    file_content_type: str | None,
) -> None:
    message = EmailMessage()
    from_name = settings.leads_email_from_name or "Malakhov AI"
    message["Subject"] = subject
    message["From"] = f"{from_name} <{settings.leads_email_from}>"
    message["To"] = settings.leads_email_to
    message.set_content(body)

    if file_bytes is not None and file_name is not None:
        maintype = "application"
        subtype = "octet-stream"
        if file_content_type and "/" in file_content_type:
            maintype, subtype = file_content_type.split("/", 1)
        message.add_attachment(file_bytes, maintype=maintype, subtype=subtype, filename=file_name)

    if settings.smtp_secure:
        context = ssl.create_default_context()
        with smtplib.SMTP_SSL(settings.smtp_host, settings.smtp_port, context=context, timeout=20) as smtp:
            smtp.login(settings.smtp_user, settings.smtp_pass)
            smtp.send_message(message)
        return

    with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=20) as smtp:
        smtp.ehlo()
        smtp.starttls(context=ssl.create_default_context())
        smtp.ehlo()
        smtp.login(settings.smtp_user, settings.smtp_pass)
        smtp.send_message(message)


async def _send_site_lead_email(
    *,
    settings,
    subject: str,
    body: str,
    file_bytes: bytes | None,
    file_name: str | None,
    file_content_type: str | None,
) -> None:
    await asyncio.to_thread(
        _send_site_lead_email_sync,
        settings=settings,
        subject=subject,
        body=body,
        file_bytes=file_bytes,
        file_name=file_name,
        file_content_type=file_content_type,
    )


async def _resolve_site_leads_chat_id(
    *,
    session: AsyncSession,
    settings,
) -> int | None:
    if settings.site_leads_chat_id is not None:
        return settings.site_leads_chat_id
    return await session.scalar(select(User.telegram_chat_id).order_by(User.id.asc()).limit(1))


def _serialize_source(source: Source) -> dict[str, object]:
    reputation = score_source(source)
    return {
        "id": source.id,
        "source_type": source.source_type.value,
        "title": source.title,
        "handle_or_url": source.handle_or_url,
        "priority_weight": source.priority_weight,
        "is_active": source.is_active,
        "language": source.language,
        "country_scope": source.country_scope,
        "section_bias": source.section_bias,
        "role": source.role.value,
        "region": source.region.value,
        "status": source.status.value,
        "editorial_priority": source.editorial_priority,
        "noise_score": source.noise_score,
        "last_success_at": _serialize_datetime(source.last_success_at),
        "last_http_status": source.last_http_status,
        "source_quality_tier": reputation.tier,
        "source_quality_score": reputation.score,
        "source_pool_role": classify_source_pool_role(source),
        "created_at": _serialize_datetime(source.created_at),
        "updated_at": _serialize_datetime(source.updated_at),
    }


def _serialize_raw_item(item: RawItem) -> dict[str, object]:
    return {
        "id": item.id,
        "source_id": item.source_id,
        "external_id": item.external_id,
        "source_type": item.source_type.value,
        "author_name": item.author_name,
        "published_at": _serialize_datetime(item.published_at),
        "fetched_at": _serialize_datetime(item.fetched_at),
        "canonical_url": item.canonical_url,
        "raw_title": item.raw_title,
        "raw_text": item.raw_text,
        "language": item.language,
        "status": item.status.value,
    }


def _serialize_event(event: Event) -> dict[str, object]:
    primary_section = next((category.section.value for category in event.categories if category.is_primary_section), None)
    return {
        "id": event.id,
        "event_date": event.event_date.isoformat(),
        "title": event.title,
        "short_summary": event.short_summary,
        "long_summary": event.long_summary,
        "primary_source_id": event.primary_source_id,
        "primary_source_url": event.primary_source_url,
        "importance_score": event.importance_score,
        "market_impact_score": event.market_impact_score,
        "ai_news_score": event.ai_news_score,
        "coding_score": event.coding_score,
        "investment_score": event.investment_score,
        "confidence_score": event.confidence_score,
        "ranking_score": event.ranking_score,
        "supporting_source_count": event.supporting_source_count,
        "verification_source_count": event.verification_source_count,
        "has_verification_source": event.has_verification_source,
        "is_highlight": event.is_highlight,
        "primary_section": primary_section,
        "related_previous_event_id": event.related_previous_event_id,
        "created_at": _serialize_datetime(event.created_at),
        "updated_at": _serialize_datetime(event.updated_at),
    }


def _serialize_event_source(event_source: EventSource) -> dict[str, object]:
    return {
        "id": event_source.id,
        "source_id": event_source.source_id,
        "raw_item_id": event_source.raw_item_id,
        "role": event_source.role.value,
        "citation_url": event_source.citation_url,
        "source_title": event_source.source.title if event_source.source else None,
        "raw_title": event_source.raw_item.normalized_title if event_source.raw_item else None,
    }


def _serialize_site_source_document(event_source: EventSource) -> dict[str, object]:
    raw_item = event_source.raw_item
    source = event_source.source
    return {
        "role": event_source.role.value,
        "source_title": source.title if source is not None else None,
        "title": (
            raw_item.normalized_title
            if raw_item is not None and raw_item.normalized_title
            else raw_item.raw_title if raw_item is not None else None
        ),
        "text": (
            raw_item.normalized_text
            if raw_item is not None and raw_item.normalized_text
            else raw_item.raw_text if raw_item is not None else None
        ),
        "canonical_url": raw_item.canonical_url if raw_item is not None else event_source.citation_url,
        "entities": raw_item.entities_json if raw_item is not None else None,
    }


def _serialize_event_category(category: EventCategory) -> dict[str, object]:
    return {
        "section": category.section.value,
        "score": category.score,
        "is_primary_section": category.is_primary_section,
    }


def _serialize_event_tag(tag: EventTag) -> dict[str, object]:
    return {
        "tag": tag.tag,
        "tag_type": tag.tag_type.value,
    }


def _serialize_source_run(run: SourceRun) -> dict[str, object]:
    source = run.source
    reputation = score_source(source) if source is not None else None
    return {
        "id": run.id,
        "source_id": run.source_id,
        "source_title": source.title if source is not None else None,
        "source_pool_role": classify_source_pool_role(source) if source is not None else None,
        "source_quality_tier": reputation.tier if reputation is not None else None,
        "source_region": source.region.value if source is not None else None,
        "source_status": source.status.value if source is not None else None,
        "started_at": _serialize_datetime(run.started_at),
        "finished_at": _serialize_datetime(run.finished_at),
        "status": run.status.value,
        "fetched_count": run.fetched_count,
        "inserted_count": run.inserted_count,
        "duplicate_count": run.duplicate_count,
        "failed_count": run.failed_count,
        "duration_ms": run.duration_ms,
        "error_message": run.error_message,
    }


def _serialize_process_run(run: ProcessRun) -> dict[str, object]:
    return {
        "id": run.id,
        "started_at": _serialize_datetime(run.started_at),
        "finished_at": _serialize_datetime(run.finished_at),
        "status": run.status.value,
        "raw_items_considered": run.raw_items_considered,
        "normalized_count": run.normalized_count,
        "clustered_count": run.clustered_count,
        "discarded_count": run.discarded_count,
        "created_events": run.created_events,
        "updated_events": run.updated_events,
        "clusters_merged": run.clusters_merged,
        "ambiguous_count": run.ambiguous_count,
        "shortlist_count": run.shortlist_count,
        "llm_event_count": run.llm_event_count,
        "raw_shortlist_evaluated_count": run.raw_shortlist_evaluated_count,
        "raw_shortlist_accepted_count": run.raw_shortlist_accepted_count,
        "raw_shortlist_rejected_count": run.raw_shortlist_rejected_count,
        "raw_shortlist_reject_breakdown": run.raw_shortlist_reject_breakdown_json or {},
        "duration_ms": run.duration_ms,
        "error_message": run.error_message,
    }


def _serialize_llm_usage(record: LlmUsageLog) -> dict[str, object]:
    return {
        "id": record.id,
        "pipeline_step": record.pipeline_step,
        "model_name": record.model_name,
        "item_count": record.item_count,
        "latency_ms": record.latency_ms,
        "prompt_tokens": record.prompt_tokens,
        "completion_tokens": record.completion_tokens,
        "total_tokens": record.total_tokens,
        "success": record.success,
        "error_message": record.error_message,
        "created_at": _serialize_datetime(record.created_at),
    }


def _serialize_delivery(delivery: Delivery) -> dict[str, object]:
    return {
        "id": delivery.id,
        "user_id": delivery.user_id,
        "issue_id": delivery.issue_id,
        "telegram_message_id": delivery.telegram_message_id,
        "delivery_type": delivery.delivery_type.value,
        "section": delivery.section,
        "sent_at": _serialize_datetime(delivery.sent_at),
        "status": delivery.status.value,
    }


def _serialize_editorial_debug(event: Event) -> dict[str, object]:
    policy = get_ru_editorial_policy()
    title_analysis = policy.inspect_text(event.title)
    short_analysis = policy.inspect_text(event.short_summary or "")
    long_analysis = policy.inspect_text(event.long_summary or "")
    return {
        "language_default": policy.output_language_default,
        "preserve_terms": list(policy.preserve_terms),
        "discouraged_english_phrases": list(policy.discouraged_english_phrases),
        "title": {
            "has_cyrillic": title_analysis.has_cyrillic,
            "english_leakage_ratio": title_analysis.english_leakage_ratio,
            "preserved_terms": title_analysis.preserved_terms,
        },
        "short_summary": {
            "has_cyrillic": short_analysis.has_cyrillic,
            "english_leakage_ratio": short_analysis.english_leakage_ratio,
            "preserved_terms": short_analysis.preserved_terms,
        },
        "long_summary": {
            "has_cyrillic": long_analysis.has_cyrillic,
            "english_leakage_ratio": long_analysis.english_leakage_ratio,
            "preserved_terms": long_analysis.preserved_terms,
        },
    }


def _serialize_shortlist_decision(decision: object) -> dict[str, object]:
    return {
        "raw_item_id": decision.raw_item_id,
        "accepted": decision.accepted,
        "reasons": decision.reasons,
        "signals": decision.signals,
    }


def _serialize_issue(issue: DigestIssue) -> dict[str, object]:
    return {
        "id": issue.id,
        "issue_type": issue.issue_type.value,
        "issue_date": issue.issue_date.isoformat(),
        "period_start": issue.period_start.isoformat(),
        "period_end": issue.period_end.isoformat(),
        "title": issue.title,
        "status": issue.status.value,
        "created_at": _serialize_datetime(issue.created_at),
        "updated_at": _serialize_datetime(issue.updated_at),
    }


def _serialize_issue_item(item: DigestIssueItem) -> dict[str, object]:
    return {
        "id": item.id,
        "issue_id": item.issue_id,
        "section": item.section.value,
        "event_id": item.event_id,
        "alpha_entry_id": item.alpha_entry_id,
        "rank_order": item.rank_order,
        "card_title": item.card_title,
        "card_text": item.card_text,
        "card_links_json": item.card_links_json,
        "is_primary_block": item.is_primary_block,
    }


def _serialize_public_source(source: Source | None) -> dict[str, object] | None:
    if source is None:
        return None
    return {
        "id": source.id,
        "title": source.title,
        "source_type": source.source_type.value,
        "region": source.region.value,
        "country_scope": source.country_scope,
        "language": source.language,
        "url": source.handle_or_url,
    }


def _serialize_public_event_card(event: Event) -> dict[str, object]:
    primary_section = next((category.section.value for category in event.categories if category.is_primary_section), None)
    secondary_sections = [category.section.value for category in event.categories if not category.is_primary_section]
    return {
        "id": event.id,
        "event_date": event.event_date.isoformat(),
        "title": event.title,
        "short_summary": event.short_summary,
        "ranking_score": event.ranking_score,
        "importance_score": event.importance_score,
        "confidence_score": event.confidence_score,
        "primary_section": primary_section,
        "secondary_sections": secondary_sections,
        "is_ai_in_russia": qualifies_for_ai_russia_event(event),
        "has_verification_source": event.has_verification_source,
        "is_highlight": event.is_highlight,
        "primary_source": _serialize_public_source(event.primary_source),
        "primary_source_url": event.primary_source_url,
        "created_at": _serialize_datetime(event.created_at),
        "updated_at": _serialize_datetime(event.updated_at),
    }


def _serialize_public_event_detail(event: Event) -> dict[str, object]:
    return {
        **_serialize_public_event_card(event),
        "long_summary": event.long_summary,
        "categories": [_serialize_event_category(category) for category in event.categories],
        "tags": [_serialize_event_tag(tag) for tag in event.tags],
        "related_previous_event_id": event.related_previous_event_id,
    }


def _serialize_public_issue_summary(issue: DigestIssue) -> dict[str, object]:
    section_counts: dict[str, int] = {}
    for section in DigestSection:
        section_counts[section.value] = sum(1 for item in issue.items if item.section is section and item.event_id is not None)
    return {
        "id": issue.id,
        "issue_type": issue.issue_type.value,
        "issue_date": issue.issue_date.isoformat(),
        "period_start": issue.period_start.isoformat(),
        "period_end": issue.period_end.isoformat(),
        "title": issue.title,
        "status": issue.status.value,
        "section_counts": section_counts,
        "created_at": _serialize_datetime(issue.created_at),
        "updated_at": _serialize_datetime(issue.updated_at),
    }


def _serialize_public_issue_item(item: DigestIssueItem) -> dict[str, object]:
    return {
        "id": item.id,
        "section": item.section.value,
        "rank_order": item.rank_order,
        "card_title": item.card_title,
        "card_text": item.card_text,
        "card_links": item.card_links_json or [],
        "is_primary_block": item.is_primary_block,
        "event_id": item.event_id,
        "alpha_entry_id": item.alpha_entry_id,
    }


def _serialize_public_alpha_entry(entry) -> dict[str, object]:
    return {
        "id": entry.id,
        "title": entry.title,
        "body_short": entry.body_short,
        "body_long": entry.body_long,
        "source_links": entry.source_links_json or [],
        "event_id": entry.event_id,
        "priority_rank": entry.priority_rank,
        "publish_date": entry.publish_date.isoformat(),
        "created_at": _serialize_datetime(entry.created_at),
        "updated_at": _serialize_datetime(entry.updated_at),
    }


def _serialize_daily_main_preview(preview) -> dict[str, object]:
    return {
        "visible_sections": {
            section.value: [_serialize_issue_item(item) for item in items]
            for section, items in preview.visible_by_section.items()
        },
        "suppressed": [
            {
                "item_id": item.item_id,
                "event_id": item.event_id,
                "source_section": item.source_section.value,
                "shown_in_section": item.shown_in_section.value,
                "reason": item.reason,
            }
            for item in preview.suppressed
        ],
        "excluded": [
            {
                "event_id": item.event_id,
                "candidate_section": item.candidate_section.value,
                "included_section": item.included_section.value if item.included_section is not None else None,
                "ranking_score": item.ranking_score,
                "reason": item.reason,
            }
            for item in preview.excluded
        ],
        "policy": preview.policy_snapshot,
    }


def _issue_debug_summary(issue: DigestIssue, preview) -> dict[str, object]:
    section_counts = {
        section.value: sum(1 for item in issue.items if item.section is section and item.event_id is not None)
        for section in DigestSection
    }
    return {
        "issue_id": issue.id,
        "issue_type": issue.issue_type.value,
        "issue_date": issue.issue_date.isoformat(),
        "section_counts": section_counts,
        "selected_event_ids_by_section": {
            section.value: [
                item.event_id
                for item in [item for item in issue.items if item.section is section]
                if item.event_id is not None
            ]
            for section in DigestSection
        },
        "suppressed_duplicates": [] if preview is None else [
            {
                "item_id": item.item_id,
                "event_id": item.event_id,
                "source_section": item.source_section.value,
                "shown_in_section": item.shown_in_section.value,
                "reason": item.reason,
            }
            for item in preview.suppressed
        ],
        "weak_day_mode": False if preview is None else sum(
            1
            for items in preview.visible_by_section.values()
            if any(item.event_id is not None for item in items)
        ) <= 2,
        "telegram_selection": None if preview is None else _serialize_daily_main_preview(preview),
        "selected_items": [_serialize_issue_item(item) for item in sorted(issue.items, key=lambda item: (item.section.value, item.rank_order, item.id))],
    }


def create_app(
    session_factory: async_sessionmaker[AsyncSession] | None = None,
    ingestion_job_runner: IngestionJobRunner | None = None,
    process_events_job_runner: ProcessEventsJobRunner | None = None,
    http_client: SourceHttpClient | None = None,
    telegram_bot=None,
    enable_scheduler: bool | None = None,
) -> FastAPI:
    configure_logging()
    settings = get_settings()
    db_session_factory = session_factory or AsyncSessionLocal
    source_http_client = http_client or SourceHttpClient(timeout_seconds=settings.ingestion_http_timeout_seconds)
    registry = SourceRegistry(
        {
            SourceType.RSS_FEED: RssFeedAdapter(source_http_client),
            SourceType.OFFICIAL_BLOG: OfficialBlogAdapter(source_http_client),
            SourceType.WEBSITE: WebsiteFeedAdapter(source_http_client),
        }
    )
    job_runner = ingestion_job_runner or IngestionJobRunner(
        IngestionService(session_factory=db_session_factory, source_registry=registry)
    )
    process_runner = process_events_job_runner or ProcessEventsJobRunner(
        ProcessEventsService(session_factory=db_session_factory)
    )
    digest_builder = DigestBuilderService(db_session_factory)
    alpha_service = AlphaService(db_session_factory)
    issue_delivery_service = IssueDeliveryService(db_session_factory)
    bot = telegram_bot
    scheduler_enabled = settings.ingestion_scheduler_enabled if enable_scheduler is None else enable_scheduler
    app_scheduler = None

    @asynccontextmanager
    async def lifespan(_: FastAPI):
        nonlocal app_scheduler
        scheduler = None
        runtime_bot = bot
        bot_task: asyncio.Task[None] | None = None
        if settings.bot_polling_enabled:
            if runtime_bot is None:
                runtime_bot = create_bot()
            bot_task = asyncio.create_task(start_polling(runtime_bot, handle_signals=False))
        if scheduler_enabled:
            if runtime_bot is None:
                runtime_bot = create_bot()
            scheduler = create_scheduler()
            register_ingestion_job(
                scheduler=scheduler,
                runner=job_runner,
                interval_minutes=settings.ingestion_interval_minutes,
            )
            if settings.process_events_scheduler_enabled:
                register_process_events_job(
                    scheduler=scheduler,
                    runner=process_runner,
                    interval_minutes=settings.process_events_interval_minutes,
                )
            register_digest_jobs(
                scheduler=scheduler,
                session_factory=db_session_factory,
                bot=runtime_bot,
                settings=settings,
            )
            scheduler.start()
            log_registered_jobs(scheduler=scheduler, service_name="api")
            app_scheduler = scheduler
        try:
            yield
        finally:
            if scheduler is not None and scheduler.running:
                scheduler.shutdown(wait=False)
            app_scheduler = None
            if bot_task is not None:
                bot_task.cancel()
                try:
                    await bot_task
                except asyncio.CancelledError:
                    pass
            if runtime_bot is not None and telegram_bot is None:
                await runtime_bot.session.close()
            if http_client is None:
                await source_http_client.aclose()

    app = FastAPI(title="Malakhov AI Digest API", version="0.2.0", lifespan=lifespan)
    app.state.ingestion_job_runner = job_runner
    app.state.process_events_job_runner = process_runner
    app.state.digest_builder = digest_builder
    app.state.alpha_service = alpha_service
    app.state.bot = telegram_bot
    app.state.scheduler_enabled = scheduler_enabled

    register_internal_alpha_routes(app, alpha_service)

    @app.api_route("/health", methods=["GET", "HEAD"], response_model=None)
    async def health(request: Request):
        if request.method == "HEAD":
            return Response(status_code=200)
        return {
            "status": "ok",
            "service": "malakhov-ai-digest",
            "environment": settings.app_env,
        }

    @app.get("/health/db")
    async def health_db() -> dict[str, str]:
        try:
            async with db_session_factory() as session:
                await session.execute(text("SELECT 1"))
            return {"status": "ok", "database": "connected"}
        except SQLAlchemyError as exc:
            raise HTTPException(status_code=503, detail="database unavailable") from exc

    @app.post("/api/leads")
    async def submit_site_lead(
        name: str = Form(...),
        company: str | None = Form(default=None),
        contact: str = Form(...),
        description: str = Form(...),
        requestType: str | None = Form(default=None),
        subject: str | None = Form(default=None),
        page: str | None = Form(default=None),
        utm: str | None = Form(default=None),
        hp: str | None = Form(default=None, alias="_hp"),
        file: UploadFile | None = File(default=None),
    ) -> dict[str, object]:
        if _normalize_site_lead_text(hp):
            return {"ok": True}

        normalized_name = _normalize_site_lead_text(name)
        normalized_company = _normalize_site_lead_text(company)
        normalized_contact = _normalize_site_lead_text(contact)
        normalized_description = _normalize_site_lead_text(description)
        normalized_request_type = _normalize_site_lead_text(requestType)
        normalized_subject = _normalize_site_lead_text(subject)
        normalized_page = _normalize_site_lead_text(page)
        normalized_utm = _normalize_site_lead_text(utm)

        if not normalized_name or not normalized_contact or not normalized_description:
            raise HTTPException(status_code=400, detail="Заполните обязательные поля")

        file_bytes: bytes | None = None
        file_name: str | None = None
        file_content_type: str | None = None
        if file is not None and file.filename:
            if file.content_type not in _SITE_LEAD_ALLOWED_FILE_TYPES:
                raise HTTPException(
                    status_code=400,
                    detail="Недопустимый тип файла. Допустимы: PDF, DOCX, TXT, PNG, JPG, XLS.",
                )
            file_bytes = await file.read()
            if len(file_bytes) > _SITE_LEAD_MAX_FILE_SIZE:
                raise HTTPException(status_code=400, detail="Файл слишком большой. Максимум 10 МБ.")
            file_name = file.filename
            file_content_type = file.content_type

        async with db_session_factory() as session:
            chat_id = await _resolve_site_leads_chat_id(session=session, settings=settings)

        if chat_id is None:
            raise HTTPException(status_code=503, detail="Не настроен чат для приёма заявок")

        bot = telegram_bot or create_bot()
        message = _format_site_lead_message(
            name=normalized_name,
            company=normalized_company,
            contact=normalized_contact,
            description=normalized_description,
            request_type=normalized_request_type,
            subject=normalized_subject,
            page=normalized_page,
            utm=normalized_utm,
        )
        email_subject = _format_site_lead_email_subject(
            name=normalized_name,
            request_type=normalized_request_type,
            subject=normalized_subject,
        )
        email_body = _format_site_lead_email_body(
            name=normalized_name,
            company=normalized_company,
            contact=normalized_contact,
            description=normalized_description,
            request_type=normalized_request_type,
            subject=normalized_subject,
            page=normalized_page,
            utm=normalized_utm,
        )

        try:
            await bot.send_message(chat_id=chat_id, text=message)
            if file_bytes is not None and file_name is not None:
                caption = f"Файл к заявке: {normalized_name} — {normalized_contact}"[:1024]
                await bot.send_document(
                    chat_id=chat_id,
                    document=BufferedInputFile(file=file_bytes, filename=file_name),
                    caption=caption,
                )
            if _site_leads_email_configured(settings):
                await _send_site_lead_email(
                    settings=settings,
                    subject=email_subject,
                    body=email_body,
                    file_bytes=file_bytes,
                    file_name=file_name,
                    file_content_type=file_content_type,
                )
        except Exception as exc:
            raise HTTPException(status_code=502, detail="Не удалось доставить заявку") from exc
        finally:
            if telegram_bot is None:
                await bot.session.close()

        return {"ok": True, "delivered": True}

    @app.get("/internal/sources")
    async def list_sources() -> dict[str, list[dict[str, object]]]:
        async with db_session_factory() as session:
            sources = list(
                (
                    await session.scalars(
                        select(Source).order_by(Source.editorial_priority.asc(), Source.priority_weight.asc(), Source.id.asc())
                    )
                ).all()
            )
        return {"items": [_serialize_source(source) for source in sources]}

    @app.get("/internal/raw-items")
    async def list_raw_items(source_id: int | None = None, limit: int = 20) -> dict[str, list[dict[str, object]]]:
        safe_limit = max(1, min(limit, 100))
        stmt = select(RawItem).order_by(desc(RawItem.published_at), desc(RawItem.id)).limit(safe_limit)
        if source_id is not None:
            stmt = stmt.where(RawItem.source_id == source_id)
        async with db_session_factory() as session:
            items = list((await session.scalars(stmt)).all())
        return {"items": [_serialize_raw_item(item) for item in items]}

    @app.get("/internal/source-runs")
    async def list_source_runs(limit: int = 20) -> dict[str, list[dict[str, object]]]:
        safe_limit = max(1, min(limit, 100))
        stmt = select(SourceRun).options(selectinload(SourceRun.source)).order_by(desc(SourceRun.started_at), desc(SourceRun.id)).limit(safe_limit)
        async with db_session_factory() as session:
            runs = list((await session.scalars(stmt)).all())
        return {"items": [_serialize_source_run(run) for run in runs]}

    @app.get("/internal/debug/source-runs")
    async def list_debug_source_runs(limit: int = 20) -> dict[str, list[dict[str, object]]]:
        return await list_source_runs(limit=limit)

    @app.get("/internal/debug/source-audit")
    async def list_source_audit(limit: int = 100, region: str | None = None, status: str | None = None) -> dict[str, object]:
        async with db_session_factory() as session:
            return await SourceAuditService(session).build_report(limit=limit, region=region, status=status)

    @app.get("/internal/debug/raw-shortlist")
    async def preview_raw_shortlist(limit: int = 50) -> dict[str, object]:
        safe_limit = max(1, min(limit, 200))
        stmt = (
            select(RawItem)
            .where(RawItem.status == RawItemStatus.FETCHED)
            .options(selectinload(RawItem.source))
            .order_by(RawItem.published_at.asc().nulls_last(), RawItem.id.asc())
            .limit(safe_limit)
        )
        async with db_session_factory() as session:
            raw_items = list((await session.scalars(stmt)).all())
            shortlist_result = await RawItemShortlistService().evaluate_batch(session=session, raw_items=raw_items)

        return {
            "items": [_serialize_shortlist_decision(decision) for decision in shortlist_result.decisions],
            "metrics": {
                "evaluated": shortlist_result.evaluated_count,
                "accepted": shortlist_result.accepted_count,
                "rejected": shortlist_result.rejected_count,
                "reject_breakdown": shortlist_result.reject_breakdown,
            },
        }

    @app.post("/internal/jobs/ingest")
    async def run_ingestion_job() -> dict[str, object]:
        result = await job_runner.run()
        if result is None:
            raise HTTPException(status_code=409, detail="ingestion already running")
        return {
            "status": "ok",
            "sources_processed": len(result.results),
            "fetched_count": result.total_fetched,
            "inserted_count": result.total_inserted,
            "duplicate_count": result.total_duplicates,
            "results": [
                {
                    "source_id": item.source_id,
                    "status": item.status.value,
                    "fetched_count": item.fetched_count,
                    "inserted_count": item.inserted_count,
                    "duplicate_count": item.duplicate_count,
                    "failed_count": item.failed_count,
                    "duration_ms": item.duration_ms,
                    "skipped": item.skipped,
                    "error_message": item.error_message,
                    "warnings": item.warnings,
                }
                for item in result.results
            ],
        }

    @app.get("/internal/events")
    async def list_events(
        section: str | None = None,
        date: str | None = None,
        limit: int = 20,
    ) -> dict[str, list[dict[str, object]]]:
        safe_limit = max(1, min(limit, 100))
        stmt = (
            select(Event)
            .options(selectinload(Event.categories), selectinload(Event.tags), selectinload(Event.event_sources))
            .order_by(Event.event_date.desc(), Event.importance_score.desc(), Event.id.desc())
            .limit(safe_limit)
        )
        if date is not None:
            try:
                target_date = date_cls.fromisoformat(date)
            except ValueError as exc:
                raise HTTPException(status_code=400, detail="invalid date") from exc
            stmt = stmt.where(Event.event_date == target_date)
        if section is not None:
            try:
                target_section = EventSection(section)
            except ValueError as exc:
                raise HTTPException(status_code=400, detail="invalid section") from exc
            stmt = stmt.join(Event.categories).where(EventCategory.section == target_section)
        async with db_session_factory() as session:
            events = list((await session.scalars(stmt)).unique().all())
        return {"items": [_serialize_event(event) for event in events]}

    @app.get("/api/events")
    async def public_list_events(
        section: str | None = None,
        date: str | None = None,
        surface: str | None = None,
        limit: int = 20,
        page: int = 1,
    ) -> dict[str, object]:
        safe_limit = max(1, min(limit, 100))
        safe_page = max(1, min(page, 500))
        stmt = (
            select(Event)
            .options(selectinload(Event.categories), selectinload(Event.tags), selectinload(Event.primary_source))
            .order_by(Event.event_date.desc(), Event.ranking_score.desc(), Event.id.desc())
            .limit(safe_limit + 1)
            .offset((safe_page - 1) * safe_limit)
        )
        if date is not None:
            try:
                target_date = date_cls.fromisoformat(date)
            except ValueError as exc:
                raise HTTPException(status_code=400, detail="invalid date") from exc
            stmt = stmt.where(Event.event_date == target_date)
        if section is not None:
            try:
                target_section = EventSection(section)
            except ValueError as exc:
                raise HTTPException(status_code=400, detail="invalid section") from exc
            stmt = stmt.join(Event.categories).where(EventCategory.section == target_section)
        if surface is not None and surface not in {"ai_in_russia"}:
            raise HTTPException(status_code=400, detail="invalid surface")
        async with db_session_factory() as session:
            events = list((await session.scalars(stmt)).unique().all())
        if surface == "ai_in_russia":
            events = [event for event in events if qualifies_for_ai_russia_event(event)]
        has_next = len(events) > safe_limit
        events = events[:safe_limit]
        return {
            "items": [_serialize_public_event_card(event) for event in events],
            "meta": {
                "limit": safe_limit,
                "page": safe_page,
                "has_next": has_next,
                "section": section,
                "date": date,
                "surface": surface,
            },
        }

    @app.get("/internal/events/{event_id}")
    async def get_event(event_id: int) -> dict[str, object]:
        stmt = (
            select(Event)
            .where(Event.id == event_id)
            .options(
                selectinload(Event.categories),
                selectinload(Event.tags),
                selectinload(Event.primary_source),
                selectinload(Event.event_sources).selectinload(EventSource.source),
                selectinload(Event.event_sources).selectinload(EventSource.raw_item),
            )
        )
        async with db_session_factory() as session:
            event = await session.scalar(stmt)
        if event is None:
            raise HTTPException(status_code=404, detail="event not found")
        return {
            "event": _serialize_event(event),
            "categories": [_serialize_event_category(category) for category in event.categories],
            "tags": [_serialize_event_tag(tag) for tag in event.tags],
            "primary_source": _serialize_source(event.primary_source) if event.primary_source else None,
            "sources": [_serialize_event_source(event_source) for event_source in event.event_sources],
        }

    @app.get("/api/events/{event_id}")
    async def public_get_event(event_id: int) -> dict[str, object]:
        stmt = (
            select(Event)
            .where(Event.id == event_id)
            .options(
                selectinload(Event.categories),
                selectinload(Event.tags),
                selectinload(Event.primary_source),
            )
        )
        async with db_session_factory() as session:
            event = await session.scalar(stmt)
        if event is None:
            raise HTTPException(status_code=404, detail="event not found")
        return {"item": _serialize_public_event_detail(event)}

    @app.get("/internal/debug/events/{event_id}")
    async def get_event_debug(event_id: int) -> dict[str, object]:
        stmt = (
            select(Event)
            .where(Event.id == event_id)
            .options(
                selectinload(Event.categories),
                selectinload(Event.tags),
                selectinload(Event.primary_source),
                selectinload(Event.related_previous_event).selectinload(Event.categories),
                selectinload(Event.event_sources).selectinload(EventSource.source),
                selectinload(Event.event_sources).selectinload(EventSource.raw_item),
            )
        )
        async with db_session_factory() as session:
            event = await session.scalar(stmt)
            if event is None:
                raise HTTPException(status_code=404, detail="event not found")

            candidate_issues = list(
                (
                    await session.scalars(
                        select(DigestIssue)
                        .join(DigestIssue.items)
                        .where(DigestIssueItem.event_id == event_id)
                        .options(selectinload(DigestIssue.items))
                        .order_by(DigestIssue.issue_date.desc(), DigestIssue.id.desc())
                    )
                ).unique().all()
            )

        selected_for_issue = False
        suppression_reason = None
        selected_issue_id = None
        if candidate_issues:
            selected_issue = candidate_issues[0]
            selected_issue_id = selected_issue.id
            if selected_issue.issue_type is DigestIssueType.DAILY:
                preview = await digest_builder.get_daily_main_preview(selected_issue.id)
                if preview is not None:
                    selected_for_issue = any(item.event_id == event_id for items in preview.visible_by_section.values() for item in items)
                    suppressed = next((item for item in preview.suppressed if item.event_id == event_id), None)
                    suppression_reason = suppressed.reason if suppressed is not None else None
            else:
                selected_for_issue = any(item.event_id == event_id for item in selected_issue.items)

        primary_section = next((category.section.value for category in event.categories if category.is_primary_section), None)
        secondary_sections = [category.section.value for category in event.categories if not category.is_primary_section]
        return {
            "event": _serialize_event(event),
            "sources": [_serialize_event_source(event_source) for event_source in event.event_sources],
            "scores": {
                "importance_score": event.importance_score,
                "market_impact_score": event.market_impact_score,
                "ai_news_score": event.ai_news_score,
                "coding_score": event.coding_score,
                "investment_score": event.investment_score,
                "confidence_score": event.confidence_score,
                "ranking_score": event.ranking_score,
            },
            "event_quality": {
                "event_importance_tier": compute_event_importance(event).tier.value,
                "event_impact_type": None if compute_event_importance(event).impact_type is None else compute_event_importance(event).impact_type.value,
                "impact_boost_applied": compute_event_importance(event).impact_boost_applied,
                "event_importance_reasons": compute_event_importance(event).reasons,
                "source_surface_adjustment": compute_event_importance(event).source_surface_adjustment,
                "consequence_gate_triggered": compute_event_importance(event).consequence_gate_triggered,
                "surface_excluded": compute_event_importance(event).excluded,
                "surface_exclusion_reason": compute_event_importance(event).exclusion_reason,
                "canonical_source_id": event.primary_source_id,
                "canonical_source": _serialize_source(event.primary_source) if event.primary_source else None,
                "canonical_source_reason": (event.score_components_json or {}).get("canonical_source_reason"),
                "supporting_source_count": event.supporting_source_count,
                "verification_source_count": event.verification_source_count,
                "has_verification_source": event.has_verification_source,
                "russia_relevance": {
                    "score": (event.score_components_json or {}).get("russia_relevance_score", 0.0),
                    "reason_codes": (event.score_components_json or {}).get("russia_reason_codes", []),
                    "qualified_for_ai_russia": qualifies_for_ai_russia_event(event),
                    "source_region_is_russia": bool(
                        event.primary_source is not None
                        and getattr(event.primary_source, "region", None) is not None
                        and event.primary_source.region.value == "russia"
                    ),
                    "signals": {
                        "source_region_count": (event.score_components_json or {}).get("russia_source_region_count", 0),
                        "source_role_count": (event.score_components_json or {}).get("russia_source_role_count", 0),
                        "policy_signal": bool((event.score_components_json or {}).get("russia_policy_signal")),
                        "state_signal": bool((event.score_components_json or {}).get("russia_state_signal")),
                        "major_company_signal": bool((event.score_components_json or {}).get("russia_major_company_signal")),
                        "market_infra_signal": bool((event.score_components_json or {}).get("russia_market_infra_signal")),
                        "adoption_signal": bool((event.score_components_json or {}).get("russia_adoption_signal")),
                        "restriction_signal": bool((event.score_components_json or {}).get("russia_restriction_signal")),
                        "weak_pr_penalty": bool((event.score_components_json or {}).get("russia_weak_pr_penalty")),
                    },
                },
                "score_components": event.score_components_json or {},
            },
            "editorial": _serialize_editorial_debug(event),
            "categories": [_serialize_event_category(category) for category in event.categories],
            "tags": [_serialize_event_tag(tag) for tag in event.tags],
            "shortlist_passed": max(
                event.importance_score,
                event.ai_news_score,
                event.coding_score,
                event.investment_score,
            ) >= settings.event_llm_shortlist_secondary_threshold,
            "selected_for_issue": selected_for_issue,
            "suppression_reason": suppression_reason,
            "primary_section": primary_section,
            "secondary_sections": secondary_sections,
            "related_previous_event": _serialize_event(event.related_previous_event) if event.related_previous_event else None,
            "selected_issue_id": selected_issue_id,
        }

    @app.get("/internal/events/preview/day/{day}")
    async def preview_events_by_day(day: str) -> dict[str, object]:
        try:
            target_date = date_cls.fromisoformat(day)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail="invalid date") from exc

        stmt = (
            select(Event)
            .where(Event.event_date == target_date)
            .options(selectinload(Event.categories))
            .order_by(Event.importance_score.desc(), Event.id.desc())
        )
        async with db_session_factory() as session:
            events = list((await session.scalars(stmt)).unique().all())

        grouped: dict[str, list[dict[str, object]]] = {section.value: [] for section in EventSection}
        for event in events:
            primary_section = next((category.section for category in event.categories if category.is_primary_section), None)
            bucket = primary_section.value if primary_section else EventSection.AI_NEWS.value
            grouped[bucket].append(_serialize_event(event))

        return {"date": target_date.isoformat(), "sections": grouped}

    @app.post("/internal/jobs/process-events")
    async def run_process_events_job() -> dict[str, object]:
        result = await process_runner.run()
        if result is None:
            raise HTTPException(status_code=409, detail="process-events already running")
        return {
            "status": "ok",
            "process_run_id": result.process_run_id,
            "raw_items_considered": result.raw_items_considered,
            "normalized_count": result.normalized_count,
            "clustered_count": result.clustered_count,
            "discarded_count": result.discarded_count,
            "created_events": result.created_events,
            "updated_events": result.updated_events,
            "clusters_merged": result.clusters_merged,
            "ambiguous_count": result.ambiguous_count,
            "raw_shortlist_evaluated_count": result.raw_shortlist_evaluated_count,
            "raw_shortlist_accepted_count": result.raw_shortlist_accepted_count,
            "raw_shortlist_rejected_count": result.raw_shortlist_rejected_count,
            "raw_shortlist_reject_breakdown": result.raw_shortlist_reject_breakdown or {},
            "shortlist_count": result.shortlist_count,
            "llm_event_count": result.llm_event_count,
        }

    @app.get("/internal/debug/process-runs")
    async def list_process_runs(limit: int = 20) -> dict[str, list[dict[str, object]]]:
        safe_limit = max(1, min(limit, 100))
        stmt = select(ProcessRun).order_by(desc(ProcessRun.started_at), desc(ProcessRun.id)).limit(safe_limit)
        async with db_session_factory() as session:
            runs = list((await session.scalars(stmt)).all())
        return {"items": [_serialize_process_run(run) for run in runs]}

    @app.get("/internal/debug/scheduler")
    async def get_scheduler_debug() -> dict[str, object]:
        return {
            "scheduler_enabled_in_api": app.state.scheduler_enabled,
            "scheduler_running_in_api": bool(app_scheduler.running) if app_scheduler is not None else False,
            "configured_timezone": settings.default_timezone,
            "configured_jobs": {
                "ingestion_interval_minutes": settings.ingestion_interval_minutes,
                "process_events_interval_minutes": settings.process_events_interval_minutes,
                "daily_build": {
                    "hour": settings.daily_digest_hour,
                    "minute": settings.daily_digest_minute,
                },
                "daily_send": {
                    "hour": settings.daily_digest_hour,
                    "minute": (settings.daily_digest_minute + settings.digest_send_delay_minutes) % 60,
                },
                "weekly_build": {
                    "weekday": settings.weekly_digest_weekday,
                    "hour": settings.weekly_digest_hour,
                    "minute": settings.weekly_digest_minute,
                },
                "weekly_send": {
                    "weekday": settings.weekly_digest_weekday,
                    "hour": settings.weekly_digest_hour,
                    "minute": (settings.weekly_digest_minute + settings.digest_send_delay_minutes) % 60,
                },
                "misfire_grace_seconds": settings.scheduler_misfire_grace_seconds,
            },
            "active_jobs": [] if app_scheduler is None else serialize_scheduler_jobs(app_scheduler.get_jobs()),
            "note": "On VPS production the dedicated scheduler container is the source of truth; API-local scheduler is normally disabled.",
        }

    @app.get("/internal/debug/deliveries")
    async def list_delivery_debug(limit: int = 50) -> dict[str, object]:
        safe_limit = max(1, min(limit, 200))
        async with db_session_factory() as session:
            deliveries = list(
                (
                    await session.scalars(
                        select(Delivery).order_by(desc(Delivery.sent_at), desc(Delivery.id)).limit(safe_limit)
                    )
                ).all()
            )
        aggregate_by_type: dict[str, int] = {}
        aggregate_by_status: dict[str, int] = {}
        for delivery in deliveries:
            aggregate_by_type[delivery.delivery_type.value] = aggregate_by_type.get(delivery.delivery_type.value, 0) + 1
            aggregate_by_status[delivery.status.value] = aggregate_by_status.get(delivery.status.value, 0) + 1
        return {
            "items": [_serialize_delivery(delivery) for delivery in deliveries],
            "aggregate_by_type": aggregate_by_type,
            "aggregate_by_status": aggregate_by_status,
        }

    @app.get("/internal/debug/quality-report")
    async def get_quality_report(days: int = 7) -> dict[str, object]:
        return await QualityReportService(
            session_factory=db_session_factory,
            digest_builder=digest_builder,
        ).build_report(days=days)

    @app.get("/internal/issues")
    async def list_issues(
        issue_type: str | None = None,
        date: str | None = None,
        limit: int = 20,
    ) -> dict[str, list[dict[str, object]]]:
        parsed_issue_type = DigestIssueType(issue_type) if issue_type is not None else None
        parsed_date = date_cls.fromisoformat(date) if date is not None else None
        issues = await digest_builder.list_issues(issue_type=parsed_issue_type, issue_date=parsed_date, limit=max(1, min(limit, 100)))
        return {"items": [_serialize_issue(issue) for issue in issues]}

    @app.get("/api/issues")
    async def public_list_issues(
        issue_type: str | None = None,
        date: str | None = None,
        limit: int = 20,
        page: int = 1,
    ) -> dict[str, object]:
        parsed_issue_type = DigestIssueType(issue_type) if issue_type is not None else None
        parsed_date = date_cls.fromisoformat(date) if date is not None else None
        safe_limit = max(1, min(limit, 100))
        safe_page = max(1, min(page, 500))
        issues = await digest_builder.list_issues(issue_type=parsed_issue_type, issue_date=parsed_date, limit=safe_limit * safe_page + 1)
        start = (safe_page - 1) * safe_limit
        sliced = issues[start:start + safe_limit + 1]
        has_next = len(sliced) > safe_limit
        issues = sliced[:safe_limit]
        return {
            "items": [_serialize_public_issue_summary(issue) for issue in issues],
            "meta": {
                "limit": safe_limit,
                "page": safe_page,
                "has_next": has_next,
                "issue_type": issue_type,
                "date": date,
            },
        }

    @app.get("/internal/issues/{issue_id}")
    async def get_issue(issue_id: int) -> dict[str, object]:
        issue = await digest_builder.get_issue(issue_id)
        if issue is None:
            raise HTTPException(status_code=404, detail="issue not found")
        payload = {
            "issue": _serialize_issue(issue),
            "items": [_serialize_issue_item(item) for item in sorted(issue.items, key=lambda item: (item.section.value, item.rank_order, item.id))],
        }
        if issue.issue_type is DigestIssueType.DAILY:
            preview = await digest_builder.get_daily_main_preview(issue_id)
            if preview is not None:
                payload["daily_main_debug"] = _serialize_daily_main_preview(preview)
        return payload

    @app.get("/api/issues/{issue_id}")
    async def public_get_issue(issue_id: int) -> dict[str, object]:
        issue = await digest_builder.get_issue(issue_id)
        if issue is None:
            raise HTTPException(status_code=404, detail="issue not found")
        section_counts: dict[str, int] = {}
        for section in DigestSection:
            section_counts[section.value] = sum(1 for item in issue.items if item.section is section and item.event_id is not None)
        sections = [
            {
                "section": section.value,
                "item_count": sum(1 for item in issue.items if item.section is section),
                "event_count": sum(1 for item in issue.items if item.section is section and item.event_id is not None),
            }
            for section in DigestSection
        ]
        return {
            "issue": _serialize_public_issue_summary(issue),
            "sections": sections,
            "section_counts": section_counts,
            "items": [_serialize_public_issue_item(item) for item in sorted(issue.items, key=lambda item: (item.section.value, item.rank_order, item.id))],
        }

    @app.get("/internal/debug/issues/{issue_id}")
    async def get_issue_debug(issue_id: int) -> dict[str, object]:
        issue = await digest_builder.get_issue(issue_id)
        if issue is None:
            raise HTTPException(status_code=404, detail="issue not found")
        preview = await digest_builder.get_daily_main_preview(issue_id) if issue.issue_type is DigestIssueType.DAILY else None
        return _issue_debug_summary(issue, preview)

    @app.get("/internal/issues/{issue_id}/section/{section}")
    async def get_issue_section(issue_id: int, section: str) -> dict[str, object]:
        try:
            parsed_section = DigestSection(section)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail="invalid section") from exc
        issue = await digest_builder.get_issue(issue_id)
        if issue is None:
            raise HTTPException(status_code=404, detail="issue not found")
        items = await digest_builder.get_section_items(issue_id, parsed_section)
        payload = {
            "issue": _serialize_issue(issue),
            "section": parsed_section.value,
            "items": [_serialize_issue_item(item) for item in items],
        }
        if issue.issue_type is DigestIssueType.DAILY:
            preview = await digest_builder.get_daily_main_preview(issue_id)
            if preview is not None:
                payload["main_section_visible"] = [
                    _serialize_issue_item(item) for item in preview.visible_by_section.get(parsed_section, [])
                ]
                payload["suppressed_from_main"] = [
                    {
                        "item_id": item.item_id,
                        "event_id": item.event_id,
                        "shown_in_section": item.shown_in_section.value,
                        "reason": item.reason,
                    }
                    for item in preview.suppressed
                    if item.source_section is parsed_section
                ]
        return payload

    @app.get("/api/issues/{issue_id}/sections/{section}")
    async def public_get_issue_section(issue_id: int, section: str) -> dict[str, object]:
        try:
            parsed_section = DigestSection(section)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail="invalid section") from exc
        issue = await digest_builder.get_issue(issue_id)
        if issue is None:
            raise HTTPException(status_code=404, detail="issue not found")
        items = await digest_builder.get_section_items(issue_id, parsed_section)
        return {
            "issue": _serialize_public_issue_summary(issue),
            "section": parsed_section.value,
            "items": [_serialize_public_issue_item(item) for item in items],
        }

    @app.post("/internal/jobs/build-daily")
    async def build_daily(date: str | None = None) -> dict[str, object]:
        target_date = date_cls.fromisoformat(date) if date else default_daily_issue_date(date_cls.today())
        result = await digest_builder.build_daily_issue(target_date)
        return {
            "status": "ok",
            "issue_id": result.issue_id,
            "issue_type": result.issue_type.value,
            "issue_date": result.issue_date.isoformat(),
            "reused_snapshot": result.reused_snapshot,
        }

    @app.post("/internal/jobs/build-weekly")
    async def build_weekly(date: str | None = None) -> dict[str, object]:
        target_date = date_cls.fromisoformat(date) if date else default_weekly_issue_date(date_cls.today())
        result = await digest_builder.build_weekly_issue(target_date)
        return {
            "status": "ok",
            "issue_id": result.issue_id,
            "issue_type": result.issue_type.value,
            "issue_date": result.issue_date.isoformat(),
            "reused_snapshot": result.reused_snapshot,
        }

    @app.post("/internal/jobs/send-daily")
    async def send_daily(date: str | None = None) -> dict[str, object]:
        target_date = date_cls.fromisoformat(date) if date else default_daily_issue_date(date_cls.today())
        runtime_bot = telegram_bot or create_bot()
        try:
            sent_count = await send_daily_issue(db_session_factory, runtime_bot, target_date)
        finally:
            if telegram_bot is None:
                await runtime_bot.session.close()
        return {"status": "ok", "sent_count": sent_count, "issue_date": target_date.isoformat()}

    @app.post("/internal/jobs/send-weekly")
    async def send_weekly(date: str | None = None) -> dict[str, object]:
        target_date = date_cls.fromisoformat(date) if date else default_weekly_issue_date(date_cls.today())
        runtime_bot = telegram_bot or create_bot()
        try:
            sent_count = await send_weekly_issue(db_session_factory, runtime_bot, target_date)
        finally:
            if telegram_bot is None:
                await runtime_bot.session.close()
        return {"status": "ok", "sent_count": sent_count, "issue_date": target_date.isoformat()}

    @app.post("/internal/issues/{issue_id}/resend")
    async def resend_issue(
        issue_id: int,
        telegram_user_id: int,
        telegram_chat_id: int,
    ) -> dict[str, object]:
        runtime_bot = telegram_bot or create_bot()
        try:
            message_id = await issue_delivery_service.resend_issue(
                bot=runtime_bot,
                issue_id=issue_id,
                telegram_user_id=telegram_user_id,
                telegram_chat_id=telegram_chat_id,
            )
        finally:
            if telegram_bot is None:
                await runtime_bot.session.close()
        if message_id is None:
            raise HTTPException(status_code=404, detail="issue not found")
        return {"status": "ok", "message_id": message_id}

    @app.get("/api/alpha")
    async def public_list_alpha(date: str | None = None, limit: int = 20) -> dict[str, object]:
        parsed_date = date_cls.fromisoformat(date) if date is not None else None
        entries = await alpha_service.list_entries(
            status=AlphaEntryStatus.PUBLISHED,
            publish_date=parsed_date,
            limit=max(1, min(limit, 100)),
        )
        return {
            "items": [_serialize_public_alpha_entry(entry) for entry in entries],
            "meta": {
                "date": date,
                "limit": max(1, min(limit, 100)),
            },
        }

    @app.get("/", response_class=HTMLResponse)
    async def site_homepage() -> HTMLResponse:
        recent_payload = await public_list_events(limit=24)
        issues_payload = await public_list_issues(limit=6)
        russia_payload = await public_list_events(surface="ai_in_russia", limit=8)
        broader_russia_payload = await public_list_events(limit=24)
        alpha_payload = await public_list_alpha(limit=6)
        sorted_recent_items = sort_site_events(recent_payload["items"])
        publishable_recent_items = filter_publishable_site_items(sorted_recent_items)
        quality_recent_items = [
            item
            for item in publishable_recent_items
            if not compute_event_importance(item).excluded and float(item.get("ranking_score") or 0) >= 60
        ]
        homepage_events = [
            item
            for item in filter_publishable_site_items(select_homepage_events(sorted_recent_items))
            if not compute_event_importance(item).excluded and float(item.get("ranking_score") or 0) >= 60
        ]
        featured_ids = {int(item["id"]) for item in homepage_events}
        if len(homepage_events) < 4:
            for pool in (quality_recent_items, publishable_recent_items):
                for item in pool:
                    item_id = int(item["id"])
                    if item_id in featured_ids:
                        continue
                    homepage_events.append(item)
                    featured_ids.add(item_id)
                    if len(homepage_events) >= 5:
                        break
                if len(homepage_events) >= 5:
                    break
        recent_event_pool = [
            item
            for item in quality_recent_items
            if int(item["id"]) not in {int(event["id"]) for event in homepage_events[:5]}
        ]
        recent_events = recent_event_pool[:8] if recent_event_pool else homepage_events[1:4]
        return HTMLResponse(
            render_site_homepage(
                featured_events=homepage_events[:5],
                latest_issue=issues_payload["items"][0] if issues_payload["items"] else None,
                russia_events=select_site_russia_events(
                    strict_items=[
                        item
                        for item in filter_publishable_site_items(russia_payload["items"])
                        if not compute_event_importance(item).excluded
                    ],
                    broader_items=[
                        item
                        for item in filter_publishable_site_items(broader_russia_payload["items"])
                        if not compute_event_importance(item).excluded
                    ],
                ),
                recent_events=recent_events,
                issues=issues_payload["items"],
                alpha_items=alpha_payload["items"],
            )
        )

    @app.get("/events", response_class=HTMLResponse)
    async def site_events_feed(page: int = 1) -> HTMLResponse:
        payload = await public_list_events(limit=12, page=page)
        return HTMLResponse(
            render_site_events_page(
                events=filter_publishable_site_items(sort_site_events(payload["items"])),
                page=payload["meta"]["page"],
                has_next=bool(payload["meta"]["has_next"]),
            )
        )

    @app.get("/events/{event_ref}", response_class=HTMLResponse)
    async def site_event_detail(event_ref: str) -> HTMLResponse:
        event_id = await _resolve_event_id_from_ref(event_ref, public_list_events)
        item = await _load_site_event_item(event_id=event_id, db_session_factory=db_session_factory)
        primary_section = item.get("primary_section")
        related_section_payload = await public_list_events(
            section=None if primary_section in {None, "all"} else str(primary_section),
            limit=18,
        )
        broader_payload = await public_list_events(limit=24)
        issue_context = await _build_issue_context_for_event(
            event_id=event_id,
            digest_builder=digest_builder,
            public_get_event_fn=public_get_event,
        )
        return HTMLResponse(
            render_site_event_detail_page(
                item=item,
                related_events=_select_related_site_events(
                    current_item=item,
                    same_section_items=related_section_payload["items"],
                    broader_items=broader_payload["items"],
                ),
                same_issue_events=issue_context["same_issue_events"],
                same_category_events=_select_same_category_events(
                    current_item=item,
                    same_section_items=related_section_payload["items"],
                    broader_items=broader_payload["items"],
                ),
                issue_navigation=issue_context["navigation"],
            )
        )

    @app.get("/issues", response_class=HTMLResponse)
    async def site_issues_archive(page: int = 1) -> HTMLResponse:
        payload = await public_list_issues(limit=10, page=page)
        return HTMLResponse(
            render_site_issues_page(
                issues=payload["items"],
                page=payload["meta"]["page"],
                has_next=bool(payload["meta"]["has_next"]),
            )
        )

    @app.get("/issues/{issue_id}", response_class=HTMLResponse)
    async def site_issue_detail(issue_id: int) -> HTMLResponse:
        payload = await public_get_issue(issue_id)
        enriched_items = await _enrich_issue_items_with_public_events(
            payload["items"],
            lambda event_id: _load_site_event_item(event_id=event_id, db_session_factory=db_session_factory),
        )
        publishable_items = filter_publishable_site_items(enriched_items, require_event=True)
        editorial_sections = build_issue_editorial_sections(items=enriched_items)
        return HTMLResponse(
            render_site_issue_detail_page(
                issue=payload["issue"],
                sections=payload["sections"],
                items=publishable_items,
                editorial_sections=editorial_sections,
                intro=build_issue_intro(payload["issue"], editorial_sections),
            )
        )

    @app.get("/issues/{issue_id}/sections/{section}", response_class=HTMLResponse)
    async def site_issue_section(issue_id: int, section: str) -> HTMLResponse:
        payload = await public_get_issue_section(issue_id, section)
        enriched_items = await _enrich_issue_items_with_public_events(
            payload["items"],
            lambda event_id: _load_site_event_item(event_id=event_id, db_session_factory=db_session_factory),
        )
        publishable_items = filter_publishable_site_items(enriched_items, require_event=True)
        editorial_sections = build_issue_editorial_sections(items=enriched_items)
        editorial_section = next((item for item in editorial_sections if item["source_section"] == section or item["slug"] == section), None)
        return HTMLResponse(
            render_site_issue_section_page(
                issue=payload["issue"],
                section=payload["section"],
                items=publishable_items,
                editorial_section=editorial_section,
            )
        )

    @app.get("/russia", response_class=HTMLResponse)
    async def site_ai_in_russia() -> HTMLResponse:
        payload = await public_list_events(surface="ai_in_russia", limit=24)
        broader_payload = await public_list_events(limit=24)
        return HTMLResponse(
            render_site_events_page(
                events=filter_publishable_site_items(sort_site_events(select_site_russia_events(
                    strict_items=filter_publishable_site_items(payload["items"]),
                    broader_items=filter_publishable_site_items(broader_payload["items"]),
                    limit=24,
                    min_items=6,
                ))),
                title="ИИ в России",
                subtitle="Качественно отфильтрованный локальный контур: регуляторика, рынок, инфраструктура и сильные корпоративные сдвиги.",
            )
        )

    @app.get("/alpha", response_class=HTMLResponse)
    async def site_alpha(date: str | None = None) -> HTMLResponse:
        payload = await public_list_alpha(date=date, limit=24)
        return HTMLResponse(render_site_alpha_page(items=payload["items"]))

    @app.get("/sitemap.xml")
    async def sitemap() -> Response:
        events_payload = await public_list_events(limit=500, page=1)
        issues_payload = await public_list_issues(limit=200, page=1)
        urls = [
            f"{event_href(item)}"
            for item in events_payload["items"]
        ]
        issue_urls = [f'/issues/{item["id"]}' for item in issues_payload["items"]]
        xml = _build_sitemap_xml(["/", "/events", "/issues", *urls, *issue_urls])
        return Response(content=xml, media_type="application/xml")

    @app.get("/preview", response_class=HTMLResponse)
    async def preview_homepage() -> HTMLResponse:
        issues_payload = await public_list_issues(limit=8)
        events_payload = await public_list_events(limit=12)
        alpha_payload = await public_list_alpha(limit=6)
        return HTMLResponse(
            render_homepage_preview(
                issues=issues_payload["items"],
                events=events_payload["items"],
                alpha_items=alpha_payload["items"],
            )
        )

    @app.get("/preview/events", response_class=HTMLResponse)
    async def preview_events_feed() -> HTMLResponse:
        payload = await public_list_events(limit=24)
        return HTMLResponse(render_events_feed_page(events=payload["items"]))

    @app.get("/preview/events/{event_id}", response_class=HTMLResponse)
    async def preview_event_detail(event_id: int) -> HTMLResponse:
        payload = await public_get_event(event_id)
        return HTMLResponse(render_event_detail_page(item=payload["item"]))

    @app.get("/preview/issues/{issue_id}", response_class=HTMLResponse)
    async def preview_issue_detail(issue_id: int) -> HTMLResponse:
        payload = await public_get_issue(issue_id)
        return HTMLResponse(
            render_issue_detail_page(
                issue=payload["issue"],
                sections=payload["sections"],
                items=payload["items"],
            )
        )

    @app.get("/preview/issues/{issue_id}/sections/{section}", response_class=HTMLResponse)
    async def preview_issue_section(issue_id: int, section: str) -> HTMLResponse:
        payload = await public_get_issue_section(issue_id, section)
        return HTMLResponse(
            render_issue_section_page(
                issue=payload["issue"],
                section=payload["section"],
                items=payload["items"],
            )
        )

    @app.get("/preview/alpha", response_class=HTMLResponse)
    async def preview_alpha(date: str | None = None) -> HTMLResponse:
        payload = await public_list_alpha(date=date, limit=20)
        return HTMLResponse(render_alpha_page(items=payload["items"]))

    @app.get("/internal/debug/llm-usage")
    async def list_llm_usage(limit: int = 50) -> dict[str, object]:
        safe_limit = max(1, min(limit, 200))
        stmt = select(LlmUsageLog).order_by(desc(LlmUsageLog.created_at), desc(LlmUsageLog.id)).limit(safe_limit)
        async with db_session_factory() as session:
            rows = list((await session.scalars(stmt)).all())

        aggregate: dict[str, dict[str, int]] = {}
        for row in rows:
            bucket = aggregate.setdefault(
                row.pipeline_step,
                {
                    "calls": 0,
                    "items": 0,
                    "prompt_tokens": 0,
                    "completion_tokens": 0,
                    "total_tokens": 0,
                    "failures": 0,
                },
            )
            bucket["calls"] += 1
            bucket["items"] += row.item_count
            bucket["prompt_tokens"] += row.prompt_tokens or 0
            bucket["completion_tokens"] += row.completion_tokens or 0
            bucket["total_tokens"] += row.total_tokens or 0
            bucket["failures"] += int(not row.success)

        return {
            "items": [_serialize_llm_usage(row) for row in rows],
            "aggregate_by_step": aggregate,
        }

    return app


def _select_related_site_events(
    *,
    current_item: dict[str, object],
    same_section_items: list[dict[str, object]],
    broader_items: list[dict[str, object]],
) -> list[dict[str, object]]:
    current_id = int(current_item["id"])
    current_section = str(current_item.get("primary_section") or "")
    current_source = str((current_item.get("primary_source") or {}).get("title") or "").lower()
    current_is_russia = bool(current_item.get("is_ai_in_russia"))

    seen_ids: set[int] = {current_id}
    scored: list[tuple[int, float, dict[str, object]]] = []
    for item in filter_publishable_site_items([*same_section_items, *broader_items]):
        item_id = int(item["id"])
        if item_id in seen_ids:
            continue
        seen_ids.add(item_id)
        match_score = 0
        if str(item.get("primary_section") or "") == current_section:
            match_score += 5
        if bool(item.get("is_ai_in_russia")) and current_is_russia:
            match_score += 4
        if str((item.get("primary_source") or {}).get("title") or "").lower() == current_source and current_source:
            match_score += 1
        scored.append((match_score, float(item.get("ranking_score") or 0), item))

    scored.sort(
        key=lambda row: (row[0], row[1], str(row[2].get("event_date") or ""), int(row[2]["id"])),
        reverse=True,
    )
    return [row[2] for row in scored[:5]]


def _select_same_category_events(
    *,
    current_item: dict[str, object],
    same_section_items: list[dict[str, object]],
    broader_items: list[dict[str, object]],
) -> list[dict[str, object]]:
    current_id = int(current_item["id"])
    candidates = [
        item
        for item in filter_publishable_site_items([*same_section_items, *broader_items])
        if int(item["id"]) != current_id
    ]
    unique: list[dict[str, object]] = []
    seen_ids: set[int] = set()
    current_section = str(current_item.get("primary_section") or "")
    for item in candidates:
        item_id = int(item["id"])
        if item_id in seen_ids:
            continue
        seen_ids.add(item_id)
        unique.append(item)
    unique.sort(
        key=lambda item: (
            1 if str(item.get("primary_section") or "") == current_section else 0,
            float(item.get("ranking_score") or 0),
            str(item.get("event_date") or ""),
            int(item["id"]),
        ),
        reverse=True,
    )
    return unique[:4]


async def _enrich_issue_items_with_public_events(
    items: list[dict[str, object]],
    event_loader_fn,
) -> list[dict[str, object]]:
    enriched: list[dict[str, object]] = []
    cache: dict[int, dict[str, object]] = {}
    for item in items:
        enriched_item = dict(item)
        event_id = item.get("event_id")
        if event_id is not None:
            event_id_int = int(event_id)
            if event_id_int not in cache:
                loaded = await event_loader_fn(event_id_int)
                cache[event_id_int] = loaded["item"] if isinstance(loaded, dict) and "item" in loaded else loaded
            enriched_item.update(cache[event_id_int])
            enriched_item["card_title"] = item.get("card_title")
            enriched_item["card_text"] = item.get("card_text")
            enriched_item["section"] = item.get("section")
            enriched_item["is_primary_block"] = item.get("is_primary_block")
        enriched.append(enriched_item)
    return enriched


async def _load_site_event_item(
    *,
    event_id: int,
    db_session_factory: async_sessionmaker[AsyncSession],
) -> dict[str, object]:
    stmt = (
        select(Event)
        .where(Event.id == event_id)
        .options(
            selectinload(Event.categories),
            selectinload(Event.tags),
            selectinload(Event.primary_source),
            selectinload(Event.event_sources).selectinload(EventSource.source),
            selectinload(Event.event_sources).selectinload(EventSource.raw_item),
        )
    )
    async with db_session_factory() as session:
        event = await session.scalar(stmt)
    if event is None:
        raise HTTPException(status_code=404, detail="event not found")
    item = _serialize_public_event_detail(event)
    source_documents = [
        _serialize_site_source_document(link)
        for link in sorted(
            event.event_sources,
            key=lambda link: (
                0 if link.role.value == "primary" else 1,
                link.id,
            ),
        )
        if link.raw_item is not None
    ]
    if source_documents:
        item["source_documents"] = source_documents
    return item


async def _build_issue_context_for_event(
    *,
    event_id: int,
    digest_builder,
    public_get_event_fn,
) -> dict[str, object]:
    issues = await digest_builder.list_issues(limit=12)
    candidate_issues = [issue for issue in issues if any(item.event_id == event_id for item in issue.items)]
    candidate_issues.sort(
        key=lambda issue: (
            1 if issue.issue_type is DigestIssueType.DAILY else 0,
            issue.issue_date,
            issue.id,
        ),
        reverse=True,
    )
    target_issue = candidate_issues[0] if candidate_issues else None
    if target_issue is None:
        return {"same_issue_events": [], "navigation": None}

    ordered_items = [item for item in target_issue.items if item.event_id is not None]
    ordered_items.sort(key=lambda item: (item.rank_order, item.id))
    ordered_event_ids: list[int] = []
    seen_event_ids: set[int] = set()
    for item in ordered_items:
        if item.event_id is None:
            continue
        event_id_value = int(item.event_id)
        if event_id_value in seen_event_ids:
            continue
        seen_event_ids.add(event_id_value)
        ordered_event_ids.append(event_id_value)
    current_index = ordered_event_ids.index(event_id) if event_id in ordered_event_ids else -1

    cache: dict[int, dict[str, object]] = {}

    async def load(event_id_value: int) -> dict[str, object]:
        if event_id_value not in cache:
            cache[event_id_value] = (await public_get_event_fn(event_id_value))["item"]
        return cache[event_id_value]

    same_issue_events: list[dict[str, object]] = []
    for candidate_id in ordered_event_ids:
        if candidate_id == event_id:
            continue
        loaded = await load(candidate_id)
        if not is_publishable_site_item(loaded):
            continue
        same_issue_events.append(loaded)
        if len(same_issue_events) >= 4:
            break

    previous_item = await load(ordered_event_ids[current_index - 1]) if current_index > 0 else None
    next_item = await load(ordered_event_ids[current_index + 1]) if 0 <= current_index < len(ordered_event_ids) - 1 else None
    if previous_item is not None and not is_publishable_site_item(previous_item):
        previous_item = None
    if next_item is not None and not is_publishable_site_item(next_item):
        next_item = None
    return {
        "same_issue_events": same_issue_events,
        "navigation": {
            "issue_id": target_issue.id,
            "previous": previous_item,
            "next": next_item,
        },
    }


async def _resolve_event_id_from_ref(event_ref: str, public_list_events_fn) -> int:
    if event_ref.isdigit():
        return int(event_ref)
    match = re.search(r"-(\d+)$", event_ref)
    if match:
        return int(match.group(1))
    payload = await public_list_events_fn(limit=500, page=1)
    for item in payload["items"]:
        if build_event_slug(item) == event_ref:
            return int(item["id"])
    raise HTTPException(status_code=404, detail="event not found")


def _build_sitemap_xml(paths: list[str]) -> str:
    base = "https://news.malakhovai.ru"
    urlset = "".join(
        f"<url><loc>{base}{path}</loc></url>"
        for path in paths
    )
    return f'<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">{urlset}</urlset>'


app = create_app()
