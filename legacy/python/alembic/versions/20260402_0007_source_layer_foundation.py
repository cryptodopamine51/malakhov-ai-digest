from __future__ import annotations

"""source layer foundation metadata

Revision ID: 20260402_0007
Revises: 20260325_0006
Create Date: 2026-04-02 12:30:00

"""

from typing import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "20260402_0007"
down_revision: str | None = "20260325_0006"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None

source_role = sa.Enum(
    "signal_feeder",
    "verification",
    "coding",
    "investments",
    "russia",
    name="source_role",
    native_enum=False,
)
source_region = sa.Enum("global", "russia", name="source_region", native_enum=False)
source_status = sa.Enum("active", "quarantine", "disabled", name="source_status", native_enum=False)


def upgrade() -> None:
    with op.batch_alter_table("sources") as batch_op:
        batch_op.add_column(
            sa.Column("role", source_role, nullable=False, server_default="signal_feeder")
        )
        batch_op.add_column(
            sa.Column("region", source_region, nullable=False, server_default="global")
        )
        batch_op.add_column(
            sa.Column("status", source_status, nullable=False, server_default="active")
        )
        batch_op.add_column(
            sa.Column("editorial_priority", sa.Integer(), nullable=False, server_default="100")
        )
        batch_op.add_column(
            sa.Column("noise_score", sa.Float(), nullable=False, server_default="0")
        )
        batch_op.add_column(sa.Column("last_success_at", sa.DateTime(timezone=True), nullable=True))
        batch_op.add_column(sa.Column("last_http_status", sa.Integer(), nullable=True))
        batch_op.create_index("ix_sources_role", ["role"], unique=False)
        batch_op.create_index("ix_sources_region", ["region"], unique=False)
        batch_op.create_index("ix_sources_status", ["status"], unique=False)
        batch_op.create_index("ix_sources_last_success_at", ["last_success_at"], unique=False)


def downgrade() -> None:
    with op.batch_alter_table("sources") as batch_op:
        batch_op.drop_index("ix_sources_last_success_at")
        batch_op.drop_index("ix_sources_status")
        batch_op.drop_index("ix_sources_region")
        batch_op.drop_index("ix_sources_role")
        batch_op.drop_column("last_http_status")
        batch_op.drop_column("last_success_at")
        batch_op.drop_column("noise_score")
        batch_op.drop_column("editorial_priority")
        batch_op.drop_column("status")
        batch_op.drop_column("region")
        batch_op.drop_column("role")

    source_status.drop(op.get_bind(), checkfirst=True)
    source_region.drop(op.get_bind(), checkfirst=True)
    source_role.drop(op.get_bind(), checkfirst=True)
