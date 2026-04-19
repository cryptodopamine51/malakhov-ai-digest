from __future__ import annotations

"""add digest issues and issue items

Revision ID: 20260325_0004
Revises: 20260325_0003
Create Date: 2026-03-25 01:00:00

"""

from typing import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "20260325_0004"
down_revision: str | None = "20260325_0003"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


digest_issue_type = sa.Enum("daily", "weekly", name="digest_issue_type", native_enum=False)
digest_issue_status = sa.Enum("draft", "ready", "sent", name="digest_issue_status", native_enum=False)
digest_section = sa.Enum(
    "important",
    "ai_news",
    "coding",
    "investments",
    "alpha",
    "all",
    name="digest_section",
    native_enum=False,
)
delivery_type = sa.Enum(
    "onboarding",
    "settings_change",
    "about",
    "daily_main",
    "weekly_main",
    "section_open",
    "today_stub",
    "weekly_stub",
    name="delivery_type",
    native_enum=False,
)


def upgrade() -> None:
    op.create_table(
        "digest_issues",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("issue_type", digest_issue_type, nullable=False),
        sa.Column("issue_date", sa.Date(), nullable=False),
        sa.Column("period_start", sa.Date(), nullable=False),
        sa.Column("period_end", sa.Date(), nullable=False),
        sa.Column("title", sa.String(length=255), nullable=False),
        sa.Column("status", digest_issue_status, nullable=False, server_default="draft"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("issue_type", "issue_date", name="uq_digest_issues_type_date"),
    )
    op.create_index("ix_digest_issues_issue_type", "digest_issues", ["issue_type"], unique=False)
    op.create_index("ix_digest_issues_issue_date", "digest_issues", ["issue_date"], unique=False)
    op.create_index("ix_digest_issues_status", "digest_issues", ["status"], unique=False)

    op.create_table(
        "digest_issue_items",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("issue_id", sa.Integer(), sa.ForeignKey("digest_issues.id", ondelete="CASCADE"), nullable=False),
        sa.Column("section", digest_section, nullable=False),
        sa.Column("event_id", sa.Integer(), sa.ForeignKey("events.id", ondelete="SET NULL"), nullable=True),
        sa.Column("alpha_entry_id", sa.Integer(), nullable=True),
        sa.Column("rank_order", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("card_title", sa.String(length=1024), nullable=False),
        sa.Column("card_text", sa.Text(), nullable=False),
        sa.Column("card_links_json", sa.JSON(), nullable=False),
        sa.Column("is_primary_block", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.create_index("ix_digest_issue_items_issue_id", "digest_issue_items", ["issue_id"], unique=False)
    op.create_index("ix_digest_issue_items_section", "digest_issue_items", ["section"], unique=False)
    op.create_index("ix_digest_issue_items_rank_order", "digest_issue_items", ["rank_order"], unique=False)

    with op.batch_alter_table("deliveries") as batch_op:
        batch_op.add_column(sa.Column("issue_id_new", sa.Integer(), nullable=True))
        batch_op.create_foreign_key("fk_deliveries_issue_id_digest_issues", "digest_issues", ["issue_id_new"], ["id"], ondelete="SET NULL")

    connection = op.get_bind()
    connection.execute(sa.text("UPDATE deliveries SET issue_id_new = issue_id"))

    with op.batch_alter_table("deliveries") as batch_op:
        batch_op.drop_column("issue_id")
        batch_op.alter_column("issue_id_new", new_column_name="issue_id")
        batch_op.alter_column("delivery_type", existing_type=sa.String(length=50), type_=delivery_type)


def downgrade() -> None:
    old_delivery_type = sa.Enum(
        "onboarding",
        "settings_change",
        "about",
        "today_stub",
        "weekly_stub",
        name="delivery_type",
        native_enum=False,
    )

    with op.batch_alter_table("deliveries") as batch_op:
        batch_op.alter_column("delivery_type", existing_type=delivery_type, type_=old_delivery_type)
        batch_op.drop_constraint("fk_deliveries_issue_id_digest_issues", type_="foreignkey")
        batch_op.drop_column("issue_id")
        batch_op.add_column(sa.Column("issue_id", sa.Integer(), nullable=True))

    op.drop_index("ix_digest_issue_items_rank_order", table_name="digest_issue_items")
    op.drop_index("ix_digest_issue_items_section", table_name="digest_issue_items")
    op.drop_index("ix_digest_issue_items_issue_id", table_name="digest_issue_items")
    op.drop_table("digest_issue_items")

    op.drop_index("ix_digest_issues_status", table_name="digest_issues")
    op.drop_index("ix_digest_issues_issue_date", table_name="digest_issues")
    op.drop_index("ix_digest_issues_issue_type", table_name="digest_issues")
    op.drop_table("digest_issues")

    digest_section.drop(op.get_bind(), checkfirst=True)
    digest_issue_status.drop(op.get_bind(), checkfirst=True)
    digest_issue_type.drop(op.get_bind(), checkfirst=True)
