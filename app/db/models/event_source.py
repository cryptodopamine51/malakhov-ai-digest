from sqlalchemy import Enum, ForeignKey, Index, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.models.base import Base
from app.db.models.enums import EventSourceRole


class EventSource(Base):
    __tablename__ = "event_sources"
    __table_args__ = (
        UniqueConstraint("raw_item_id", name="uq_event_sources_raw_item_id"),
        UniqueConstraint("event_id", "raw_item_id", name="uq_event_sources_event_raw_item"),
        Index("ix_event_sources_event_id", "event_id"),
        Index("ix_event_sources_source_id", "source_id"),
        Index("ix_event_sources_role", "role"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    event_id: Mapped[int] = mapped_column(ForeignKey("events.id", ondelete="CASCADE"), nullable=False)
    raw_item_id: Mapped[int] = mapped_column(ForeignKey("raw_items.id", ondelete="CASCADE"), nullable=False)
    source_id: Mapped[int] = mapped_column(ForeignKey("sources.id", ondelete="CASCADE"), nullable=False)
    role: Mapped[EventSourceRole] = mapped_column(
        Enum(EventSourceRole, name="event_source_role", native_enum=False),
        nullable=False,
    )
    citation_url: Mapped[str] = mapped_column(String(1024), nullable=False)

    event = relationship("Event", back_populates="event_sources")
    raw_item = relationship("RawItem", back_populates="event_links")
    source = relationship("Source", back_populates="event_links")
