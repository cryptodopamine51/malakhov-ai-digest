from datetime import date

from sqlalchemy import Date, Enum, ForeignKey, Index, Integer, JSON, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.models.base import Base, TimestampMixin
from app.db.models.enums import AlphaEntryStatus


class AlphaEntry(TimestampMixin, Base):
    __tablename__ = "alpha_entries"
    __table_args__ = (
        Index("ix_alpha_entries_publish_date", "publish_date"),
        Index("ix_alpha_entries_status", "status"),
        Index("ix_alpha_entries_priority_rank", "priority_rank"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    body_short: Mapped[str] = mapped_column(Text, nullable=False)
    body_long: Mapped[str | None] = mapped_column(Text, nullable=True)
    source_links_json: Mapped[list] = mapped_column(JSON, nullable=False, default=list)
    event_id: Mapped[int | None] = mapped_column(ForeignKey("events.id", ondelete="SET NULL"), nullable=True)
    priority_rank: Mapped[int] = mapped_column(Integer, nullable=False, default=100)
    publish_date: Mapped[date] = mapped_column(Date, nullable=False)
    status: Mapped[AlphaEntryStatus] = mapped_column(
        Enum(AlphaEntryStatus, name="alpha_entry_status", native_enum=False),
        nullable=False,
        default=AlphaEntryStatus.DRAFT,
    )
    created_by: Mapped[str | None] = mapped_column(String(255), nullable=True)

    event = relationship("Event")
