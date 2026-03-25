from datetime import date

from sqlalchemy import Boolean, Date, Float, ForeignKey, Index, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.models.base import Base, TimestampMixin


class Event(TimestampMixin, Base):
    __tablename__ = "events"
    __table_args__ = (
        Index("ix_events_event_date", "event_date"),
        Index("ix_events_importance_score", "importance_score"),
        Index("ix_events_is_highlight", "is_highlight"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    event_date: Mapped[date] = mapped_column(Date, nullable=False)
    title: Mapped[str] = mapped_column(String(1024), nullable=False)
    short_summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    long_summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    primary_source_id: Mapped[int | None] = mapped_column(ForeignKey("sources.id", ondelete="SET NULL"), nullable=True)
    primary_source_url: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    importance_score: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    market_impact_score: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    ai_news_score: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    coding_score: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    investment_score: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    confidence_score: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    is_highlight: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    primary_source = relationship("Source", back_populates="primary_events")
    event_sources = relationship("EventSource", back_populates="event", cascade="all, delete-orphan")
    categories = relationship("EventCategory", back_populates="event", cascade="all, delete-orphan")
    tags = relationship("EventTag", back_populates="event", cascade="all, delete-orphan")
