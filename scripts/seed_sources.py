from __future__ import annotations

import asyncio
import csv
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
from pathlib import Path
import argparse
import sys

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from sqlalchemy import select
from app.core.editorial import PUBLIC_SECTIONS
from app.db.models import Source, SourceType
from app.db.session import AsyncSessionLocal

DEFAULT_SEED_CSV_PATH = Path(__file__).resolve().parent / "data" / "seed_sources.csv"
SUPPORTED_SEED_SOURCE_TYPES = {
    SourceType.RSS_FEED,
    SourceType.OFFICIAL_BLOG,
}


@dataclass(frozen=True, slots=True)
class SourceSeedRow:
    title: str
    source_type: SourceType
    handle_or_url: str
    priority_weight: int
    language: str | None
    country_scope: str | None
    is_active: bool
    section_bias: str | None = None


def _parse_priority_weight(value: str) -> int:
    try:
        normalized = Decimal(value)
    except InvalidOperation as exc:
        raise ValueError(f"invalid priority_weight: {value}") from exc
    return int(normalized * 100)


def _parse_bool(value: str) -> bool:
    return value.strip() in {"1", "true", "True", "yes"}


def _sanitize_section_bias(section_bias: str | None) -> tuple[str | None, list[str]]:
    if section_bias is None:
        return None, []

    valid_sections: list[str] = []
    invalid_sections: list[str] = []
    for section in section_bias.split("|"):
        normalized = section.strip()
        if not normalized:
            continue
        if normalized in PUBLIC_SECTIONS:
            valid_sections.append(normalized)
        else:
            invalid_sections.append(normalized)
    return ("|".join(valid_sections) or None), invalid_sections


def load_source_seeds(csv_path: Path) -> tuple[list[SourceSeedRow], list[SourceSeedRow]]:
    supported_rows: list[SourceSeedRow] = []
    skipped_rows: list[SourceSeedRow] = []
    invalid_section_bias_warnings: list[str] = []

    with csv_path.open("r", encoding="utf-8", newline="") as file_obj:
        reader = csv.DictReader(file_obj)
        for row in reader:
            source_type = SourceType(row["source_type"])
            section_bias, invalid_sections = _sanitize_section_bias(row.get("section_bias", "").strip() or None)
            if invalid_sections:
                invalid_section_bias_warnings.append(
                    f"{row['title'].strip()}: dropped unsupported section_bias values [{', '.join(invalid_sections)}]"
                )
            seed_row = SourceSeedRow(
                title=row["title"].strip(),
                source_type=source_type,
                handle_or_url=row["handle_or_url"].strip(),
                priority_weight=_parse_priority_weight(row["priority_weight"]),
                language=row["language"].strip() or None,
                country_scope=row["country_scope"].strip() or None,
                is_active=_parse_bool(row["is_active"]),
                section_bias=section_bias,
            )
            if source_type in SUPPORTED_SEED_SOURCE_TYPES:
                supported_rows.append(seed_row)
            else:
                skipped_rows.append(seed_row)

    for warning in invalid_section_bias_warnings:
        print(f"warning: {warning}")
    return supported_rows, skipped_rows


async def seed_sources(csv_path: Path, *, deactivate_missing: bool = False) -> None:
    source_seeds, skipped_rows = load_source_seeds(csv_path)
    csv_handles = {row.handle_or_url for row in source_seeds}
    csv_handles.update(row.handle_or_url for row in skipped_rows)

    async with AsyncSessionLocal() as session:
        created_count = 0
        updated_count = 0
        deactivated_count = 0

        for source_seed in source_seeds:
            existing = await session.scalar(
                select(Source).where(Source.handle_or_url == source_seed.handle_or_url)
            )
            if existing is None:
                session.add(
                    Source(
                        source_type=source_seed.source_type,
                        title=source_seed.title,
                        handle_or_url=source_seed.handle_or_url,
                        priority_weight=source_seed.priority_weight,
                        is_active=source_seed.is_active,
                        language=source_seed.language,
                        country_scope=source_seed.country_scope,
                        section_bias=source_seed.section_bias,
                    )
                )
                created_count += 1
                continue

            existing.source_type = source_seed.source_type
            existing.title = source_seed.title
            existing.priority_weight = source_seed.priority_weight
            existing.language = source_seed.language
            existing.country_scope = source_seed.country_scope
            existing.section_bias = source_seed.section_bias
            existing.is_active = source_seed.is_active
            updated_count += 1

        if deactivate_missing:
            existing_sources = list((await session.scalars(select(Source))).all())
            for source in existing_sources:
                if source.handle_or_url not in csv_handles and source.is_active:
                    source.is_active = False
                    deactivated_count += 1

        await session.commit()

    skipped_count = len(skipped_rows)
    print(
        "seed completed: "
        f"csv={csv_path} "
        f"created={created_count} "
        f"updated={updated_count} "
        f"deactivated_missing={deactivated_count} "
        f"skipped_unsupported={skipped_count}"
    )
    if skipped_rows:
        print("skipped unsupported source types:")
        for row in skipped_rows:
            print(f"- {row.title} [{row.source_type.value}] {row.handle_or_url}")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Seed sources from CSV")
    parser.add_argument(
        "--csv-path",
        type=Path,
        default=DEFAULT_SEED_CSV_PATH,
        help=f"path to source seed csv (default: {DEFAULT_SEED_CSV_PATH})",
    )
    parser.add_argument(
        "--deactivate-missing",
        action="store_true",
        help="set is_active=false for sources not present in the CSV roster",
    )
    return parser.parse_args()


if __name__ == "__main__":
    args = parse_args()
    asyncio.run(seed_sources(csv_path=args.csv_path, deactivate_missing=args.deactivate_missing))
