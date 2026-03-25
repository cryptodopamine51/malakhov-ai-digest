# AGENTS.md — Malakhov AI Digest

## Project goal
Build a Telegram bot-first AI digest with a reusable event-layer and knowledge base.
Current priority: clean, testable MVP delivered in slices.

## Architecture rules
- Keep the project bot-first, but preserve a clean event-layer for future web expansion.
- Prefer simple, explicit code over abstraction-heavy code.
- Separate handler / service / persistence layers.
- Do not expand scope beyond the current slice.
- Do not silently change behavior outside the requested slice.

## Repo conventions
- Python 3.12
- FastAPI
- PostgreSQL
- SQLAlchemy 2.x
- Alembic
- aiogram 3
- APScheduler
- pytest

## Expected repo structure
- `app/api/` — HTTP entrypoints
- `app/bot/` — Telegram handlers, keyboards, renderers
- `app/core/` — config, constants, logging
- `app/db/` — models, migrations, sessions
- `app/services/` — business logic
- `app/jobs/` — schedulers/background jobs
- `tests/` — unit and integration tests
- `scripts/` — local utility scripts

## Done means
A slice is done only if:
1. Scope is complete.
2. Tests for the slice pass.
3. README is updated.
4. Migrations work locally.
5. Acceptance criteria from the prompt are closed.

## Coding rules
- Use type hints.
- Keep functions small and obvious.
- Keep bot texts centralized where practical.
- Prefer config-driven values over hardcoded magic values.
- Add comments only where they save real debugging time.

## Data and editorial rules
- One event should become one card later in the pipeline.
- Official sources are higher priority than secondary media.
- Source links must be preserved through the pipeline.
- `section_bias` from seed sources is advisory metadata, not final truth.

## Safety rules for secrets
- Never print secret values in logs.
- Never commit real `.env` values.
- Use `.env.example` for placeholders only.
- If a token or key is missing, fail with a clear error message.

## Review rules
Before finishing a slice:
- run tests,
- verify migrations,
- verify local startup instructions,
- verify no obvious scope creep.

## Local commands
- Apply migrations: `alembic upgrade head`
- Seed sources: `python scripts/seed_sources.py`
- Run API: `uvicorn app.api.main:app --host 0.0.0.0 --port 8000 --reload`
- Run bot: `python -m app.bot.runner`
- Run tests: `pytest -q`
