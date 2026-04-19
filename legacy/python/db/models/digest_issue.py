from datetime import date

from sqlalchemy import Date, Enum, Index, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.models.base import Base, TimestampMixin
from app.db.models.enums import DigestIssueStatus, DigestIssueType


class DigestIssue(TimestampMixin, Base):
    __tablename__ = "digest_issues"
    __table_args__ = (
        UniqueConstraint("issue_type", "issue_date", name="uq_digest_issues_type_date"),
        Index("ix_digest_issues_issue_type", "issue_type"),
        Index("ix_digest_issues_issue_date", "issue_date"),
        Index("ix_digest_issues_status", "status"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    issue_type: Mapped[DigestIssueType] = mapped_column(
        Enum(DigestIssueType, name="digest_issue_type", native_enum=False),
        nullable=False,
    )
    issue_date: Mapped[date] = mapped_column(Date, nullable=False)
    period_start: Mapped[date] = mapped_column(Date, nullable=False)
    period_end: Mapped[date] = mapped_column(Date, nullable=False)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    status: Mapped[DigestIssueStatus] = mapped_column(
        Enum(DigestIssueStatus, name="digest_issue_status", native_enum=False),
        nullable=False,
        default=DigestIssueStatus.DRAFT,
    )

    items = relationship("DigestIssueItem", back_populates="issue", cascade="all, delete-orphan")
