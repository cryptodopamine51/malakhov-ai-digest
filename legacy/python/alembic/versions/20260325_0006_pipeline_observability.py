from __future__ import annotations

"""pipeline observability and continuity

Revision ID: 20260325_0006
Revises: 20260325_0005
Create Date: 2026-03-25 18:30:00

"""

from typing import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "20260325_0006"
down_revision: str | None = "20260325_0005"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None

process_run_status = sa.Enum("success", "partial", "failed", name="process_run_status", native_enum=False)


def upgrade() -> None:
    with op.batch_alter_table("events") as batch_op:
        batch_op.add_column(sa.Column("related_previous_event_id", sa.Integer(), nullable=True))
        batch_op.create_foreign_key(
            "fk_events_related_previous_event_id_events",
            "events",
            ["related_previous_event_id"],
            ["id"],
            ondelete="SET NULL",
        )

    with op.batch_alter_table("source_runs") as batch_op:
        batch_op.add_column(sa.Column("duplicate_count", sa.Integer(), nullable=False, server_default="0"))
        batch_op.add_column(sa.Column("failed_count", sa.Integer(), nullable=False, server_default="0"))
        batch_op.add_column(sa.Column("duration_ms", sa.Integer(), nullable=True))

    op.create_table(
        "process_runs",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("status", process_run_status, nullable=False),
        sa.Column("raw_items_considered", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("normalized_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("clustered_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("discarded_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_events", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("updated_events", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("clusters_merged", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("ambiguous_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("shortlist_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("llm_event_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("duration_ms", sa.Integer(), nullable=True),
        sa.Column("error_message", sa.String(length=2000), nullable=True),
    )
    op.create_index("ix_process_runs_started_at", "process_runs", ["started_at"], unique=False)
    op.create_index("ix_process_runs_status", "process_runs", ["status"], unique=False)

    op.create_table(
        "llm_usage_logs",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("pipeline_step", sa.String(length=128), nullable=False),
        sa.Column("model_name", sa.String(length=128), nullable=False),
        sa.Column("item_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("latency_ms", sa.Integer(), nullable=True),
        sa.Column("prompt_tokens", sa.Integer(), nullable=True),
        sa.Column("completion_tokens", sa.Integer(), nullable=True),
        sa.Column("total_tokens", sa.Integer(), nullable=True),
        sa.Column("success", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("error_message", sa.String(length=2000), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_llm_usage_logs_created_at", "llm_usage_logs", ["created_at"], unique=False)
    op.create_index("ix_llm_usage_logs_pipeline_step", "llm_usage_logs", ["pipeline_step"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_llm_usage_logs_pipeline_step", table_name="llm_usage_logs")
    op.drop_index("ix_llm_usage_logs_created_at", table_name="llm_usage_logs")
    op.drop_table("llm_usage_logs")

    op.drop_index("ix_process_runs_status", table_name="process_runs")
    op.drop_index("ix_process_runs_started_at", table_name="process_runs")
    op.drop_table("process_runs")
    process_run_status.drop(op.get_bind(), checkfirst=True)

    with op.batch_alter_table("source_runs") as batch_op:
        batch_op.drop_column("duration_ms")
        batch_op.drop_column("failed_count")
        batch_op.drop_column("duplicate_count")

    with op.batch_alter_table("events") as batch_op:
        batch_op.drop_constraint("fk_events_related_previous_event_id_events", type_="foreignkey")
        batch_op.drop_column("related_previous_event_id")
