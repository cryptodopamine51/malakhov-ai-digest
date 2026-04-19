from datetime import datetime

from sqlalchemy import DateTime, Enum, ForeignKey, Index, String, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.models.base import Base
from app.db.models.enums import DeliveryStatus, DeliveryType


class Delivery(Base):
    __tablename__ = "deliveries"
    __table_args__ = (
        Index("ix_deliveries_user_id", "user_id"),
        Index("ix_deliveries_delivery_type", "delivery_type"),
        Index("ix_deliveries_sent_at", "sent_at"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    issue_id: Mapped[int | None] = mapped_column(ForeignKey("digest_issues.id", ondelete="SET NULL"), nullable=True)
    telegram_message_id: Mapped[int | None] = mapped_column(nullable=True)
    delivery_type: Mapped[DeliveryType] = mapped_column(
        Enum(DeliveryType, name="delivery_type", native_enum=False),
        nullable=False,
    )
    section: Mapped[str | None] = mapped_column(String(100), nullable=True)
    sent_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    status: Mapped[DeliveryStatus] = mapped_column(
        Enum(DeliveryStatus, name="delivery_status", native_enum=False),
        default=DeliveryStatus.SENT,
        nullable=False,
    )

    user = relationship("User", back_populates="deliveries")
    issue = relationship("DigestIssue")
