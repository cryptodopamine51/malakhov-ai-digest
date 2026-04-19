from sqlalchemy import Boolean, Index, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.models.base import Base, TimestampMixin


class LlmUsageLog(TimestampMixin, Base):
    __tablename__ = "llm_usage_logs"
    __table_args__ = (
        Index("ix_llm_usage_logs_pipeline_step", "pipeline_step"),
        Index("ix_llm_usage_logs_created_at", "created_at"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    pipeline_step: Mapped[str] = mapped_column(String(128), nullable=False)
    model_name: Mapped[str] = mapped_column(String(128), nullable=False)
    item_count: Mapped[int] = mapped_column(nullable=False, default=0)
    latency_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    prompt_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    completion_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    total_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    success: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    error_message: Mapped[str | None] = mapped_column(String(2000), nullable=True)
