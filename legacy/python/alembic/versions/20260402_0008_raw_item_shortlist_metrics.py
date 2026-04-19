from __future__ import annotations

"""raw item shortlist metrics on process runs

Revision ID: 20260402_0008
Revises: 20260402_0007
Create Date: 2026-04-02 17:10:00

"""

from typing import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "20260402_0008"
down_revision: str | None = "20260402_0007"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("process_runs") as batch_op:
        batch_op.add_column(
            sa.Column("raw_shortlist_evaluated_count", sa.Integer(), nullable=False, server_default="0")
        )
        batch_op.add_column(
            sa.Column("raw_shortlist_accepted_count", sa.Integer(), nullable=False, server_default="0")
        )
        batch_op.add_column(
            sa.Column("raw_shortlist_rejected_count", sa.Integer(), nullable=False, server_default="0")
        )
        batch_op.add_column(
            sa.Column("raw_shortlist_reject_breakdown_json", sa.JSON(), nullable=True)
        )


def downgrade() -> None:
    with op.batch_alter_table("process_runs") as batch_op:
        batch_op.drop_column("raw_shortlist_reject_breakdown_json")
        batch_op.drop_column("raw_shortlist_rejected_count")
        batch_op.drop_column("raw_shortlist_accepted_count")
        batch_op.drop_column("raw_shortlist_evaluated_count")
