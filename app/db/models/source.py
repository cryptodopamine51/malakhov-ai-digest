from sqlalchemy import Boolean, Enum, Index, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.models.base import Base, TimestampMixin
from app.db.models.enums import SourceType


class Source(TimestampMixin, Base):
    __tablename__ = "sources"
    __table_args__ = (
        Index("ix_sources_source_type", "source_type"),
        Index("ix_sources_is_active", "is_active"),
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

    raw_items = relationship("RawItem", back_populates="source", cascade="all, delete-orphan")
    runs = relationship("SourceRun", back_populates="source", cascade="all, delete-orphan")
    primary_events = relationship("Event", back_populates="primary_source")
    event_links = relationship("EventSource", back_populates="source")
