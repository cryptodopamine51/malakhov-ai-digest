from sqlalchemy import Boolean, Enum, ForeignKey, Index, Integer, JSON, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.models.base import Base
from app.db.models.enums import DigestSection


class DigestIssueItem(Base):
    __tablename__ = "digest_issue_items"
    __table_args__ = (
        Index("ix_digest_issue_items_issue_id", "issue_id"),
        Index("ix_digest_issue_items_section", "section"),
        Index("ix_digest_issue_items_rank_order", "rank_order"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    issue_id: Mapped[int] = mapped_column(ForeignKey("digest_issues.id", ondelete="CASCADE"), nullable=False)
    section: Mapped[DigestSection] = mapped_column(
        Enum(DigestSection, name="digest_section", native_enum=False),
        nullable=False,
    )
    event_id: Mapped[int | None] = mapped_column(ForeignKey("events.id", ondelete="SET NULL"), nullable=True)
    alpha_entry_id: Mapped[int | None] = mapped_column(ForeignKey("alpha_entries.id", ondelete="SET NULL"), nullable=True)
    rank_order: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    card_title: Mapped[str] = mapped_column(String(1024), nullable=False)
    card_text: Mapped[str] = mapped_column(Text, nullable=False)
    card_links_json: Mapped[list] = mapped_column(JSON, nullable=False, default=list)
    is_primary_block: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    issue = relationship("DigestIssue", back_populates="items")
    event = relationship("Event")
    alpha_entry = relationship("AlphaEntry")
