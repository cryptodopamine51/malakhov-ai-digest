from sqlalchemy import Boolean, Enum, ForeignKey, Float, Index, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.models.base import Base
from app.db.models.enums import EventSection


class EventCategory(Base):
    __tablename__ = "event_categories"
    __table_args__ = (
        UniqueConstraint("event_id", "section", name="uq_event_categories_event_section"),
        Index("ix_event_categories_section", "section"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    event_id: Mapped[int] = mapped_column(ForeignKey("events.id", ondelete="CASCADE"), nullable=False)
    section: Mapped[EventSection] = mapped_column(
        Enum(EventSection, name="event_section", native_enum=False),
        nullable=False,
    )
    score: Mapped[float] = mapped_column(Float, nullable=False)
    is_primary_section: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    event = relationship("Event", back_populates="categories")
