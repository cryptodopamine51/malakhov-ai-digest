from __future__ import annotations

"""add sources raw_items source_runs

Revision ID: 20260324_0002
Revises: 20260324_0001
Create Date: 2026-03-24 00:30:00

"""

from typing import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "20260324_0002"
down_revision: str | None = "20260324_0001"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


source_type = sa.Enum("rss_feed", "website", "official_blog", name="source_type", native_enum=False)
raw_item_status = sa.Enum(
    "fetched",
    "normalized",
    "clustered",
    "discarded",
    name="raw_item_status",
    native_enum=False,
)
source_run_status = sa.Enum("success", "partial", "failed", name="source_run_status", native_enum=False)


def upgrade() -> None:
    op.create_table(
        "sources",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("source_type", source_type, nullable=False),
        sa.Column("title", sa.String(length=255), nullable=False),
        sa.Column("handle_or_url", sa.String(length=1024), nullable=False),
        sa.Column("priority_weight", sa.Integer(), nullable=False, server_default="100"),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("language", sa.String(length=32), nullable=True),
        sa.Column("country_scope", sa.String(length=32), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("handle_or_url", name="uq_sources_handle_or_url"),
    )
    op.create_index("ix_sources_source_type", "sources", ["source_type"], unique=False)
    op.create_index("ix_sources_is_active", "sources", ["is_active"], unique=False)

    op.create_table(
        "raw_items",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("source_id", sa.Integer(), sa.ForeignKey("sources.id", ondelete="CASCADE"), nullable=False),
        sa.Column("external_id", sa.String(length=512), nullable=False),
        sa.Column("source_type", source_type, nullable=False),
        sa.Column("author_name", sa.String(length=255), nullable=True),
        sa.Column("published_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("fetched_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("canonical_url", sa.String(length=1024), nullable=False),
        sa.Column("raw_title", sa.String(length=1024), nullable=False),
        sa.Column("raw_text", sa.Text(), nullable=True),
        sa.Column("raw_payload_json", sa.JSON(), nullable=False),
        sa.Column("language", sa.String(length=32), nullable=True),
        sa.Column("status", raw_item_status, nullable=False, server_default="fetched"),
        sa.Column("normalized_title", sa.String(length=1024), nullable=True),
        sa.Column("normalized_text", sa.Text(), nullable=True),
        sa.Column("entities_json", sa.JSON(), nullable=True),
        sa.Column("outbound_links_json", sa.JSON(), nullable=True),
        sa.UniqueConstraint("source_id", "external_id", name="uq_raw_items_source_external_id"),
    )
    op.create_index("ix_raw_items_source_id", "raw_items", ["source_id"], unique=False)
    op.create_index("ix_raw_items_published_at", "raw_items", ["published_at"], unique=False)
    op.create_index("ix_raw_items_status", "raw_items", ["status"], unique=False)

    op.create_table(
        "source_runs",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("source_id", sa.Integer(), sa.ForeignKey("sources.id", ondelete="CASCADE"), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("status", source_run_status, nullable=False),
        sa.Column("fetched_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("inserted_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("error_message", sa.String(length=2000), nullable=True),
    )
    op.create_index("ix_source_runs_source_id", "source_runs", ["source_id"], unique=False)
    op.create_index("ix_source_runs_started_at", "source_runs", ["started_at"], unique=False)
    op.create_index("ix_source_runs_status", "source_runs", ["status"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_source_runs_status", table_name="source_runs")
    op.drop_index("ix_source_runs_started_at", table_name="source_runs")
    op.drop_index("ix_source_runs_source_id", table_name="source_runs")
    op.drop_table("source_runs")

    op.drop_index("ix_raw_items_status", table_name="raw_items")
    op.drop_index("ix_raw_items_published_at", table_name="raw_items")
    op.drop_index("ix_raw_items_source_id", table_name="raw_items")
    op.drop_table("raw_items")

    op.drop_index("ix_sources_is_active", table_name="sources")
    op.drop_index("ix_sources_source_type", table_name="sources")
    op.drop_table("sources")

    source_run_status.drop(op.get_bind(), checkfirst=True)
    raw_item_status.drop(op.get_bind(), checkfirst=True)
    source_type.drop(op.get_bind(), checkfirst=True)
