from __future__ import annotations

"""event scoring foundation

Revision ID: 20260402_0009
Revises: 20260402_0008
Create Date: 2026-04-02 18:10:00

"""

from typing import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "20260402_0009"
down_revision: str | None = "20260402_0008"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("events") as batch_op:
        batch_op.add_column(sa.Column("ranking_score", sa.Float(), nullable=False, server_default="0"))
        batch_op.add_column(sa.Column("supporting_source_count", sa.Integer(), nullable=False, server_default="0"))
        batch_op.add_column(sa.Column("verification_source_count", sa.Integer(), nullable=False, server_default="0"))
        batch_op.add_column(sa.Column("has_verification_source", sa.Boolean(), nullable=False, server_default=sa.false()))
        batch_op.add_column(sa.Column("score_components_json", sa.JSON(), nullable=True))
        batch_op.create_index("ix_events_ranking_score", ["ranking_score"], unique=False)


def downgrade() -> None:
    with op.batch_alter_table("events") as batch_op:
        batch_op.drop_index("ix_events_ranking_score")
        batch_op.drop_column("score_components_json")
        batch_op.drop_column("has_verification_source")
        batch_op.drop_column("verification_source_count")
        batch_op.drop_column("supporting_source_count")
        batch_op.drop_column("ranking_score")
