from __future__ import annotations

"""add events tables and source section bias

Revision ID: 20260325_0003
Revises: 20260324_0002
Create Date: 2026-03-25 00:00:00

"""

from typing import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "20260325_0003"
down_revision: str | None = "20260324_0002"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


event_source_role = sa.Enum("primary", "supporting", "reaction", name="event_source_role", native_enum=False)
event_section = sa.Enum(
    "important",
    "ai_news",
    "coding",
    "investments",
    "alpha",
    name="event_section",
    native_enum=False,
)
event_tag_type = sa.Enum("theme", "entity", "market", "tech", name="event_tag_type", native_enum=False)


def upgrade() -> None:
    op.add_column("sources", sa.Column("section_bias", sa.String(length=255), nullable=True))

    op.create_table(
        "events",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("event_date", sa.Date(), nullable=False),
        sa.Column("title", sa.String(length=1024), nullable=False),
        sa.Column("short_summary", sa.Text(), nullable=True),
        sa.Column("long_summary", sa.Text(), nullable=True),
        sa.Column("primary_source_id", sa.Integer(), sa.ForeignKey("sources.id", ondelete="SET NULL"), nullable=True),
        sa.Column("primary_source_url", sa.String(length=1024), nullable=True),
        sa.Column("importance_score", sa.Float(), nullable=False, server_default="0"),
        sa.Column("market_impact_score", sa.Float(), nullable=False, server_default="0"),
        sa.Column("ai_news_score", sa.Float(), nullable=False, server_default="0"),
        sa.Column("coding_score", sa.Float(), nullable=False, server_default="0"),
        sa.Column("investment_score", sa.Float(), nullable=False, server_default="0"),
        sa.Column("confidence_score", sa.Float(), nullable=False, server_default="0"),
        sa.Column("is_highlight", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_events_event_date", "events", ["event_date"], unique=False)
    op.create_index("ix_events_importance_score", "events", ["importance_score"], unique=False)
    op.create_index("ix_events_is_highlight", "events", ["is_highlight"], unique=False)

    op.create_table(
        "event_sources",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("event_id", sa.Integer(), sa.ForeignKey("events.id", ondelete="CASCADE"), nullable=False),
        sa.Column("raw_item_id", sa.Integer(), sa.ForeignKey("raw_items.id", ondelete="CASCADE"), nullable=False),
        sa.Column("source_id", sa.Integer(), sa.ForeignKey("sources.id", ondelete="CASCADE"), nullable=False),
        sa.Column("role", event_source_role, nullable=False),
        sa.Column("citation_url", sa.String(length=1024), nullable=False),
        sa.UniqueConstraint("raw_item_id", name="uq_event_sources_raw_item_id"),
        sa.UniqueConstraint("event_id", "raw_item_id", name="uq_event_sources_event_raw_item"),
    )
    op.create_index("ix_event_sources_event_id", "event_sources", ["event_id"], unique=False)
    op.create_index("ix_event_sources_source_id", "event_sources", ["source_id"], unique=False)
    op.create_index("ix_event_sources_role", "event_sources", ["role"], unique=False)

    op.create_table(
        "event_categories",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("event_id", sa.Integer(), sa.ForeignKey("events.id", ondelete="CASCADE"), nullable=False),
        sa.Column("section", event_section, nullable=False),
        sa.Column("score", sa.Float(), nullable=False),
        sa.Column("is_primary_section", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.UniqueConstraint("event_id", "section", name="uq_event_categories_event_section"),
    )
    op.create_index("ix_event_categories_section", "event_categories", ["section"], unique=False)

    op.create_table(
        "event_tags",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("event_id", sa.Integer(), sa.ForeignKey("events.id", ondelete="CASCADE"), nullable=False),
        sa.Column("tag", sa.String(length=255), nullable=False),
        sa.Column("tag_type", event_tag_type, nullable=False),
        sa.UniqueConstraint("event_id", "tag", "tag_type", name="uq_event_tags_event_tag_type"),
    )
    op.create_index("ix_event_tags_tag", "event_tags", ["tag"], unique=False)
    op.create_index("ix_event_tags_tag_type", "event_tags", ["tag_type"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_event_tags_tag_type", table_name="event_tags")
    op.drop_index("ix_event_tags_tag", table_name="event_tags")
    op.drop_table("event_tags")

    op.drop_index("ix_event_categories_section", table_name="event_categories")
    op.drop_table("event_categories")

    op.drop_index("ix_event_sources_role", table_name="event_sources")
    op.drop_index("ix_event_sources_source_id", table_name="event_sources")
    op.drop_index("ix_event_sources_event_id", table_name="event_sources")
    op.drop_table("event_sources")

    op.drop_index("ix_events_is_highlight", table_name="events")
    op.drop_index("ix_events_importance_score", table_name="events")
    op.drop_index("ix_events_event_date", table_name="events")
    op.drop_table("events")

    op.drop_column("sources", "section_bias")

    event_tag_type.drop(op.get_bind(), checkfirst=True)
    event_section.drop(op.get_bind(), checkfirst=True)
    event_source_role.drop(op.get_bind(), checkfirst=True)
