from __future__ import annotations

"""init users and deliveries

Revision ID: 20260324_0001
Revises: None
Create Date: 2026-03-24 00:00:00

"""

from typing import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "20260324_0001"
down_revision: str | None = None
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


subscription_mode = sa.Enum("daily", "weekly", name="subscription_mode", native_enum=False)
delivery_type = sa.Enum(
    "onboarding",
    "settings_change",
    "about",
    "today_stub",
    "weekly_stub",
    name="delivery_type",
    native_enum=False,
)
delivery_status = sa.Enum("queued", "sent", "failed", name="delivery_status", native_enum=False)


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("telegram_user_id", sa.BigInteger(), nullable=False, unique=True),
        sa.Column("telegram_chat_id", sa.BigInteger(), nullable=False),
        sa.Column("subscription_mode", subscription_mode, nullable=False, server_default="daily"),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )
    op.create_index("ix_users_telegram_user_id", "users", ["telegram_user_id"], unique=False)

    op.create_table(
        "deliveries",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("issue_id", sa.Integer(), nullable=True),
        sa.Column("telegram_message_id", sa.Integer(), nullable=True),
        sa.Column("delivery_type", delivery_type, nullable=False),
        sa.Column("section", sa.String(length=100), nullable=True),
        sa.Column("sent_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("status", delivery_status, nullable=False, server_default="sent"),
    )
    op.create_index("ix_deliveries_user_id", "deliveries", ["user_id"], unique=False)
    op.create_index("ix_deliveries_delivery_type", "deliveries", ["delivery_type"], unique=False)
    op.create_index("ix_deliveries_sent_at", "deliveries", ["sent_at"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_deliveries_sent_at", table_name="deliveries")
    op.drop_index("ix_deliveries_delivery_type", table_name="deliveries")
    op.drop_index("ix_deliveries_user_id", table_name="deliveries")
    op.drop_table("deliveries")

    op.drop_index("ix_users_telegram_user_id", table_name="users")
    op.drop_table("users")

    delivery_status.drop(op.get_bind(), checkfirst=True)
    delivery_type.drop(op.get_bind(), checkfirst=True)
    subscription_mode.drop(op.get_bind(), checkfirst=True)
