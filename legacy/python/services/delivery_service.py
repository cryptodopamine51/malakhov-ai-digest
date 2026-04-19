from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import Delivery, DeliveryStatus, DeliveryType


class DeliveryService:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def log_delivery(
        self,
        *,
        user_id: int,
        issue_id: int | None = None,
        delivery_type: DeliveryType,
        telegram_message_id: int | None,
        section: str | None = None,
        status: DeliveryStatus = DeliveryStatus.SENT,
    ) -> Delivery:
        delivery = Delivery(
            user_id=user_id,
            issue_id=issue_id,
            delivery_type=delivery_type,
            telegram_message_id=telegram_message_id,
            section=section,
            status=status,
        )
        self.session.add(delivery)
        await self.session.flush()
        return delivery
