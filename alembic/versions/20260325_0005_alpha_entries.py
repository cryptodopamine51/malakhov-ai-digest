from __future__ import annotations

"""add alpha entries

Revision ID: 20260325_0005
Revises: 20260325_0004
Create Date: 2026-03-25 02:00:00

"""

from typing import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "20260325_0005"
down_revision: str | None = "20260325_0004"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None

alpha_entry_status = sa.Enum("draft", "ready", "published", name="alpha_entry_status", native_enum=False)


def upgrade() -> None:
    op.create_table(
        "alpha_entries",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("title", sa.String(length=255), nullable=False),
        sa.Column("body_short", sa.Text(), nullable=False),
        sa.Column("body_long", sa.Text(), nullable=True),
        sa.Column("source_links_json", sa.JSON(), nullable=False),
        sa.Column("event_id", sa.Integer(), sa.ForeignKey("events.id", ondelete="SET NULL"), nullable=True),
        sa.Column("priority_rank", sa.Integer(), nullable=False, server_default="100"),
        sa.Column("publish_date", sa.Date(), nullable=False),
        sa.Column("status", alpha_entry_status, nullable=False, server_default="draft"),
        sa.Column("created_by", sa.String(length=255), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_alpha_entries_publish_date", "alpha_entries", ["publish_date"], unique=False)
    op.create_index("ix_alpha_entries_status", "alpha_entries", ["status"], unique=False)
    op.create_index("ix_alpha_entries_priority_rank", "alpha_entries", ["priority_rank"], unique=False)

    with op.batch_alter_table("digest_issue_items") as batch_op:
        batch_op.add_column(sa.Column("alpha_entry_id_new", sa.Integer(), nullable=True))
        batch_op.create_foreign_key(
            "fk_digest_issue_items_alpha_entry_id_alpha_entries",
            "alpha_entries",
            ["alpha_entry_id_new"],
            ["id"],
            ondelete="SET NULL",
        )

    op.execute(sa.text("UPDATE digest_issue_items SET alpha_entry_id_new = alpha_entry_id"))

    with op.batch_alter_table("digest_issue_items") as batch_op:
        batch_op.drop_column("alpha_entry_id")
        batch_op.alter_column("alpha_entry_id_new", new_column_name="alpha_entry_id")


def downgrade() -> None:
    with op.batch_alter_table("digest_issue_items") as batch_op:
        batch_op.drop_constraint("fk_digest_issue_items_alpha_entry_id_alpha_entries", type_="foreignkey")
        batch_op.drop_column("alpha_entry_id")
        batch_op.add_column(sa.Column("alpha_entry_id", sa.Integer(), nullable=True))

    op.drop_index("ix_alpha_entries_priority_rank", table_name="alpha_entries")
    op.drop_index("ix_alpha_entries_status", table_name="alpha_entries")
    op.drop_index("ix_alpha_entries_publish_date", table_name="alpha_entries")
    op.drop_table("alpha_entries")
    alpha_entry_status.drop(op.get_bind(), checkfirst=True)
