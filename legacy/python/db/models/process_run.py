from datetime import datetime

from sqlalchemy import JSON, DateTime, Enum, Index, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.models.base import Base
from app.db.models.enums import ProcessRunStatus


class ProcessRun(Base):
    __tablename__ = "process_runs"
    __table_args__ = (
        Index("ix_process_runs_started_at", "started_at"),
        Index("ix_process_runs_status", "status"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    status: Mapped[ProcessRunStatus] = mapped_column(
        Enum(ProcessRunStatus, name="process_run_status", native_enum=False),
        nullable=False,
    )
    raw_items_considered: Mapped[int] = mapped_column(nullable=False, default=0)
    normalized_count: Mapped[int] = mapped_column(nullable=False, default=0)
    clustered_count: Mapped[int] = mapped_column(nullable=False, default=0)
    discarded_count: Mapped[int] = mapped_column(nullable=False, default=0)
    created_events: Mapped[int] = mapped_column(nullable=False, default=0)
    updated_events: Mapped[int] = mapped_column(nullable=False, default=0)
    clusters_merged: Mapped[int] = mapped_column(nullable=False, default=0)
    ambiguous_count: Mapped[int] = mapped_column(nullable=False, default=0)
    shortlist_count: Mapped[int] = mapped_column(nullable=False, default=0)
    llm_event_count: Mapped[int] = mapped_column(nullable=False, default=0)
    raw_shortlist_evaluated_count: Mapped[int] = mapped_column(nullable=False, default=0)
    raw_shortlist_accepted_count: Mapped[int] = mapped_column(nullable=False, default=0)
    raw_shortlist_rejected_count: Mapped[int] = mapped_column(nullable=False, default=0)
    raw_shortlist_reject_breakdown_json: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    duration_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    error_message: Mapped[str | None] = mapped_column(String(2000), nullable=True)
