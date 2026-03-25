from datetime import datetime

from sqlalchemy import DateTime, Enum, ForeignKey, Index, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.models.base import Base
from app.db.models.enums import SourceRunStatus


class SourceRun(Base):
    __tablename__ = "source_runs"
    __table_args__ = (
        Index("ix_source_runs_source_id", "source_id"),
        Index("ix_source_runs_started_at", "started_at"),
        Index("ix_source_runs_status", "status"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    source_id: Mapped[int] = mapped_column(ForeignKey("sources.id", ondelete="CASCADE"), nullable=False)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    status: Mapped[SourceRunStatus] = mapped_column(
        Enum(SourceRunStatus, name="source_run_status", native_enum=False),
        nullable=False,
    )
    fetched_count: Mapped[int] = mapped_column(nullable=False, default=0)
    inserted_count: Mapped[int] = mapped_column(nullable=False, default=0)
    duplicate_count: Mapped[int] = mapped_column(nullable=False, default=0)
    failed_count: Mapped[int] = mapped_column(nullable=False, default=0)
    duration_ms: Mapped[int | None] = mapped_column(nullable=True)
    error_message: Mapped[str | None] = mapped_column(String(2000), nullable=True)

    source = relationship("Source", back_populates="runs")
