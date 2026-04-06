from datetime import datetime

from sqlalchemy import Boolean, DateTime, Enum, Float, Index, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.models.base import Base, TimestampMixin
from app.db.models.enums import SourceRegion, SourceRole, SourceStatus, SourceType


def _enum_values(enum_cls: type) -> list[str]:
    return [member.value for member in enum_cls]


class Source(TimestampMixin, Base):
    __tablename__ = "sources"
    __table_args__ = (
        Index("ix_sources_source_type", "source_type"),
        Index("ix_sources_is_active", "is_active"),
        Index("ix_sources_role", "role"),
        Index("ix_sources_region", "region"),
        Index("ix_sources_status", "status"),
        Index("ix_sources_last_success_at", "last_success_at"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    source_type: Mapped[SourceType] = mapped_column(
        Enum(SourceType, name="source_type", native_enum=False),
        nullable=False,
    )
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    handle_or_url: Mapped[str] = mapped_column(String(1024), nullable=False, unique=True)
    priority_weight: Mapped[int] = mapped_column(Integer, nullable=False, default=100)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    language: Mapped[str | None] = mapped_column(String(32), nullable=True)
    country_scope: Mapped[str | None] = mapped_column(String(32), nullable=True)
    section_bias: Mapped[str | None] = mapped_column(String(255), nullable=True)
    role: Mapped[SourceRole] = mapped_column(
        Enum(SourceRole, name="source_role", native_enum=False, values_callable=_enum_values),
        nullable=False,
        default=SourceRole.SIGNAL_FEEDER,
    )
    region: Mapped[SourceRegion] = mapped_column(
        Enum(SourceRegion, name="source_region", native_enum=False, values_callable=_enum_values),
        nullable=False,
        default=SourceRegion.GLOBAL,
    )
    status: Mapped[SourceStatus] = mapped_column(
        Enum(SourceStatus, name="source_status", native_enum=False, values_callable=_enum_values),
        nullable=False,
        default=SourceStatus.ACTIVE,
    )
    editorial_priority: Mapped[int] = mapped_column(Integer, nullable=False, default=100)
    noise_score: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    last_success_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_http_status: Mapped[int | None] = mapped_column(Integer, nullable=True)

    raw_items = relationship("RawItem", back_populates="source", cascade="all, delete-orphan")
    runs = relationship("SourceRun", back_populates="source", cascade="all, delete-orphan")
    primary_events = relationship("Event", back_populates="primary_source")
    event_links = relationship("EventSource", back_populates="source")
