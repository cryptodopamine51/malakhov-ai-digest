from sqlalchemy import BigInteger, Boolean, Enum, Index
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.models.base import Base, TimestampMixin
from app.db.models.enums import SubscriptionMode


class User(TimestampMixin, Base):
    __tablename__ = "users"
    __table_args__ = (
        Index("ix_users_telegram_user_id", "telegram_user_id"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    telegram_user_id: Mapped[int] = mapped_column(BigInteger, unique=True, nullable=False)
    telegram_chat_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    subscription_mode: Mapped[SubscriptionMode] = mapped_column(
        Enum(SubscriptionMode, name="subscription_mode", native_enum=False),
        default=SubscriptionMode.DAILY,
        nullable=False,
    )
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    deliveries = relationship("Delivery", back_populates="user", cascade="all, delete-orphan")
