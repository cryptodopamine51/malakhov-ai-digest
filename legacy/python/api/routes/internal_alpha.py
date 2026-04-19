from __future__ import annotations

from datetime import date

from fastapi import FastAPI, HTTPException

from app.db.models import AlphaEntry, AlphaEntryStatus
from app.services.alpha import AlphaService
from app.services.alpha.schemas import AlphaEntryCreate, AlphaEntryUpdate


def serialize_alpha_entry(entry: AlphaEntry) -> dict[str, object]:
    return {
        "id": entry.id,
        "title": entry.title,
        "body_short": entry.body_short,
        "body_long": entry.body_long,
        "source_links_json": entry.source_links_json,
        "event_id": entry.event_id,
        "priority_rank": entry.priority_rank,
        "publish_date": entry.publish_date.isoformat(),
        "status": entry.status.value,
        "created_by": entry.created_by,
        "created_at": entry.created_at.isoformat() if entry.created_at else None,
        "updated_at": entry.updated_at.isoformat() if entry.updated_at else None,
    }


def register_internal_alpha_routes(app: FastAPI, alpha_service: AlphaService) -> None:
    @app.get("/internal/alpha")
    async def list_alpha(status: str | None = None, date: str | None = None, limit: int = 20) -> dict[str, list[dict[str, object]]]:
        parsed_status = AlphaEntryStatus(status) if status else None
        parsed_date = date and __import__("datetime").date.fromisoformat(date)
        entries = await alpha_service.list_entries(status=parsed_status, publish_date=parsed_date, limit=max(1, min(limit, 100)))
        return {"items": [serialize_alpha_entry(entry) for entry in entries]}

    @app.get("/internal/alpha/{entry_id}")
    async def get_alpha(entry_id: int) -> dict[str, object]:
        entry = await alpha_service.get_entry(entry_id)
        if entry is None:
            raise HTTPException(status_code=404, detail="alpha entry not found")
        return {"item": serialize_alpha_entry(entry)}

    @app.post("/internal/alpha")
    async def create_alpha(payload: dict[str, object]) -> dict[str, object]:
        entry = await alpha_service.create_entry(
            AlphaEntryCreate(
                title=str(payload["title"]),
                body_short=str(payload["body_short"]),
                body_long=str(payload.get("body_long")) if payload.get("body_long") is not None else None,
                source_links_json=list(payload.get("source_links_json", [])),
                event_id=int(payload["event_id"]) if payload.get("event_id") is not None else None,
                priority_rank=int(payload.get("priority_rank", 100)),
                publish_date=date.fromisoformat(str(payload["publish_date"])),
                status=AlphaEntryStatus(str(payload.get("status", AlphaEntryStatus.DRAFT.value))),
                created_by=str(payload.get("created_by")) if payload.get("created_by") is not None else None,
            )
        )
        return {"item": serialize_alpha_entry(entry)}

    @app.patch("/internal/alpha/{entry_id}")
    async def patch_alpha(entry_id: int, payload: dict[str, object]) -> dict[str, object]:
        entry = await alpha_service.update_entry(
            entry_id,
            AlphaEntryUpdate(
                title=str(payload["title"]) if payload.get("title") is not None else None,
                body_short=str(payload["body_short"]) if payload.get("body_short") is not None else None,
                body_long=str(payload["body_long"]) if payload.get("body_long") is not None else None,
                source_links_json=list(payload["source_links_json"]) if payload.get("source_links_json") is not None else None,
                event_id=int(payload["event_id"]) if payload.get("event_id") is not None else None,
                priority_rank=int(payload["priority_rank"]) if payload.get("priority_rank") is not None else None,
                publish_date=date.fromisoformat(str(payload["publish_date"])) if payload.get("publish_date") is not None else None,
                status=AlphaEntryStatus(str(payload["status"])) if payload.get("status") is not None else None,
                created_by=str(payload["created_by"]) if payload.get("created_by") is not None else None,
            ),
        )
        if entry is None:
            raise HTTPException(status_code=404, detail="alpha entry not found")
        return {"item": serialize_alpha_entry(entry)}

    @app.post("/internal/alpha/{entry_id}/publish")
    async def publish_alpha(entry_id: int) -> dict[str, object]:
        entry = await alpha_service.publish_entry(entry_id)
        if entry is None:
            raise HTTPException(status_code=404, detail="alpha entry not found")
        return {"item": serialize_alpha_entry(entry)}
