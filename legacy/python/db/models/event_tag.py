from sqlalchemy import Enum, ForeignKey, Index, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.models.base import Base
from app.db.models.enums import EventTagType


class EventTag(Base):
    __tablename__ = "event_tags"
    __table_args__ = (
        UniqueConstraint("event_id", "tag", "tag_type", name="uq_event_tags_event_tag_type"),
        Index("ix_event_tags_tag", "tag"),
        Index("ix_event_tags_tag_type", "tag_type"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    event_id: Mapped[int] = mapped_column(ForeignKey("events.id", ondelete="CASCADE"), nullable=False)
    tag: Mapped[str] = mapped_column(String(255), nullable=False)
    tag_type: Mapped[EventTagType] = mapped_column(
        Enum(EventTagType, name="event_tag_type", native_enum=False),
        nullable=False,
    )

    event = relationship("Event", back_populates="tags")
