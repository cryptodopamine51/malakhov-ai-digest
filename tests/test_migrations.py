from __future__ import annotations

import asyncio
import os
from pathlib import Path

from alembic import command
from alembic.config import Config
from sqlalchemy import inspect
from sqlalchemy.ext.asyncio import create_async_engine

from app.core.config import get_settings


async def test_alembic_upgrade_head_creates_core_tables(tmp_path):
    db_path = tmp_path / "alembic_smoke.db"
    database_url = f"sqlite+aiosqlite:///{db_path}"

    previous_database_url = os.environ.get("DATABASE_URL")
    previous_bot_token = os.environ.get("BOT_TOKEN")
    os.environ["DATABASE_URL"] = database_url
    os.environ["BOT_TOKEN"] = "test-token"
    get_settings.cache_clear()

    project_root = Path(__file__).resolve().parents[1]
    config = Config(str(project_root / "alembic.ini"))
    config.set_main_option("script_location", str(project_root / "alembic"))
    config.set_main_option("sqlalchemy.url", database_url)

    try:
        await asyncio.to_thread(command.upgrade, config, "head")

        engine = create_async_engine(database_url)
        async with engine.begin() as conn:
            table_names = set(await conn.run_sync(lambda sync_conn: inspect(sync_conn).get_table_names()))
            source_columns = set(
                await conn.run_sync(lambda sync_conn: {column["name"] for column in inspect(sync_conn).get_columns("sources")})
            )
            process_run_columns = set(
                await conn.run_sync(lambda sync_conn: {column["name"] for column in inspect(sync_conn).get_columns("process_runs")})
            )
            event_columns = set(
                await conn.run_sync(lambda sync_conn: {column["name"] for column in inspect(sync_conn).get_columns("events")})
            )
        await engine.dispose()
    finally:
        if previous_database_url is None:
            os.environ.pop("DATABASE_URL", None)
        else:
            os.environ["DATABASE_URL"] = previous_database_url
        if previous_bot_token is None:
            os.environ.pop("BOT_TOKEN", None)
        else:
            os.environ["BOT_TOKEN"] = previous_bot_token
        get_settings.cache_clear()

    assert {
        "users",
        "deliveries",
        "sources",
        "raw_items",
        "source_runs",
        "events",
        "event_sources",
        "event_categories",
        "event_tags",
        "digest_issues",
        "digest_issue_items",
        "alpha_entries",
        "process_runs",
        "llm_usage_logs",
    }.issubset(table_names)
    assert {
        "role",
        "region",
        "status",
        "editorial_priority",
        "noise_score",
        "last_success_at",
        "last_http_status",
    }.issubset(source_columns)
    assert {
        "raw_shortlist_evaluated_count",
        "raw_shortlist_accepted_count",
        "raw_shortlist_rejected_count",
        "raw_shortlist_reject_breakdown_json",
    }.issubset(process_run_columns)
    assert {
        "ranking_score",
        "supporting_source_count",
        "verification_source_count",
        "has_verification_source",
        "score_components_json",
    }.issubset(event_columns)
