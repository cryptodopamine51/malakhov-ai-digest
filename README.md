# Malakhov AI Digest

Backend foundation for Telegram bot, API, and MVP source ingestion.

## Stack
- Python 3.12
- FastAPI
- PostgreSQL
- SQLAlchemy 2.x
- Alembic
- aiogram 3
- APScheduler
- httpx
- pydantic-settings
- pytest

## Working rules

Project conventions are aligned with the local planning documents:
- keep the project bot-first, with a clean event-layer for future expansion;
- keep handler / service / persistence separation explicit;
- do not expand behavior beyond the current slice without an explicit request;
- prefer simple, testable code over abstraction-heavy code.

Editorial guidance already reflected in the ingestion foundation:
- official sources are preferred over secondary sources;
- source links must be preserved through the pipeline;
- one event should map to one future card after normalization/clustering;
- `section_bias` from source seeds is stored as advisory editorial metadata and used by the classification layer.

## Slice status

Implemented now:
- Slice 1 foundation:
  - FastAPI skeleton
  - PostgreSQL connection
  - Alembic
  - `users` and `deliveries`
  - Telegram bot skeleton with `/start`, settings, about
  - health endpoints
- Slice 2 ingestion foundation:
  - `sources`, `raw_items`, `source_runs`
  - source adapter registry
  - RSS/Atom ingestion
  - official blog feed discovery ingestion
  - dedup by `source_id + external_id`
  - ingestion scheduler job
  - internal preview endpoints
  - seed script for starter sources
- Slice 3 event pipeline:
  - raw item normalization
  - event clustering
  - rule-based classification
  - rule-based scoring
  - event/source/category/tag tables
  - process-events job
  - internal events preview endpoints
- Slice 4 digest delivery:
  - `digest_issues` and `digest_issue_items`
  - daily and weekly issue builders
  - Telegram message renderers
  - daily inline section buttons
  - callback delivery of section messages
  - delivery logging for main sends and section opens
  - internal issue preview/build/send endpoints
- Slice 5 alpha + hardening:
  - `alpha_entries`
  - internal alpha CRUD-lite endpoints
  - Alpha inclusion in daily and weekly issues
  - `/start` welcome UX with subscription choice
  - chunked Telegram-safe message rendering
  - resend existing issue from stored snapshot
  - duplicate mass-send protection for the same issue/user pair

Out of scope for this stage:
- public web frontend
- admin/editor UI

## Project structure

```text
malakhov-ai-digest/
├── app/
│   ├── api/
│   ├── bot/
│   ├── core/
│   ├── db/
│   │   └── models/
│   ├── jobs/
│   └── services/
│       ├── alpha/
│       ├── deliveries/
│       ├── digest/
│       ├── events/
│       ├── ingestion/
│       ├── issues/
│       ├── normalization/
│       ├── rendering/
│       └── sources/
├── alembic/
├── scripts/
├── tests/
├── docker-compose.yml
├── pyproject.toml
└── README.md
```

## Environment

Create `.env` with at least:

```env
APP_ENV=local
APP_HOST=0.0.0.0
APP_PORT=8000
DATABASE_URL=postgresql+asyncpg://postgres:postgres@localhost:5432/malakhov_ai_digest
BOT_TOKEN=replace_me
DEFAULT_TIMEZONE=Europe/Moscow
INGESTION_INTERVAL_MINUTES=30
INGESTION_SCHEDULER_ENABLED=true
INGESTION_HTTP_TIMEOUT_SECONDS=10
PROCESS_EVENTS_INTERVAL_MINUTES=15
PROCESS_EVENTS_SCHEDULER_ENABLED=true
DAILY_DIGEST_HOUR=9
WEEKLY_DIGEST_WEEKDAY=mon
WEEKLY_DIGEST_HOUR=9
```

Fast start:

```bash
cp .env.example .env
```

## Local run

1. Start PostgreSQL:

```bash
docker compose up -d
```

2. Create venv and install dependencies:

```bash
python3.12 -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"
```

3. Apply migrations:

```bash
alembic upgrade head
```

4. Seed starter sources:

```bash
python scripts/seed_sources.py
```

Optional custom CSV:

```bash
python scripts/seed_sources.py --csv-path /path/to/seed_sources.csv
```

5. Start API:

```bash
uvicorn app.api.main:app --host 0.0.0.0 --port 8000 --reload
```

6. Start bot in another terminal:

```bash
python -m app.bot.runner
```

## Database migrations

Current schema includes:
- `users`
- `deliveries`
- `sources`
- `raw_items`
- `source_runs`
- `events`
- `event_sources`
- `event_categories`
- `event_tags`
- `digest_issues`
- `digest_issue_items`
- `alpha_entries`

Run:

```bash
alembic upgrade head
```

## Ingestion flow

For each active source:
1. create `source_run`
2. fetch source payload through adapter
3. map fetched entries to unified raw item contract
4. deduplicate by `source_id + external_id`
5. insert new `raw_items`
6. finalize `source_run` with `success`, `partial`, or `failed`

## Event processing flow

For each `raw_item` with `status=fetched`:
1. normalize title/text/entities/outbound links
2. move valid items to `normalized`
3. cluster related normalized items into `events`
4. create `event_sources`
5. assign section categories and tags
6. calculate scores
7. move processed items to `clustered`

Statuses:
- `fetched`
- `normalized`
- `clustered`
- `discarded`

## Digest issue flow

Daily:
1. build daily issue from today events
2. persist snapshot into `digest_issues` and `digest_issue_items`
3. send daily main to daily users
4. users open section messages from inline buttons
5. section views are rendered from the stored issue snapshot

Weekly:
1. build weekly issue from the last 7 days
2. persist snapshot
3. send weekly main to weekly users

## Supported source types in Slice 2

- `rss_feed`
  - direct RSS or Atom feed URL
- `official_blog`
  - homepage/news page with discoverable RSS/Atom feed via `<link rel="alternate">`

Not supported yet:
- Telegram channels
- X/Twitter
- scraping-heavy websites
- generic `website` imports from the seed CSV

## Internal preview endpoints

Health:

```bash
curl http://localhost:8000/health
curl http://localhost:8000/health/db
```

Preview sources:

```bash
curl http://localhost:8000/internal/sources
```

Preview raw items:

```bash
curl "http://localhost:8000/internal/raw-items?limit=20"
curl "http://localhost:8000/internal/raw-items?source_id=1&limit=20"
```

Preview source runs:

```bash
curl http://localhost:8000/internal/source-runs
```

Run ingestion manually:

```bash
curl -X POST http://localhost:8000/internal/jobs/ingest
```

Run process-events manually:

```bash
curl -X POST http://localhost:8000/internal/jobs/process-events
```

Build daily issue manually:

```bash
curl -X POST "http://localhost:8000/internal/jobs/build-daily?date=2026-03-25"
```

Build weekly issue manually:

```bash
curl -X POST "http://localhost:8000/internal/jobs/build-weekly?date=2026-03-25"
```

Send daily issue manually:

```bash
curl -X POST http://localhost:8000/internal/jobs/send-daily
```

Send weekly issue manually:

```bash
curl -X POST http://localhost:8000/internal/jobs/send-weekly
```

List events:

```bash
curl "http://localhost:8000/internal/events?limit=20"
curl "http://localhost:8000/internal/events?section=ai_news&limit=20"
curl "http://localhost:8000/internal/events?date=2026-03-25&limit=20"
```

Event detail:

```bash
curl http://localhost:8000/internal/events/1
```

Day preview:

```bash
curl http://localhost:8000/internal/events/preview/day/2026-03-25
```

List issues:

```bash
curl "http://localhost:8000/internal/issues?limit=20"
curl "http://localhost:8000/internal/issues?issue_type=daily&date=2026-03-25"
```

Issue detail:

```bash
curl http://localhost:8000/internal/issues/1
curl http://localhost:8000/internal/issues/1/section/important
curl http://localhost:8000/internal/issues/1/section/ai_news
curl http://localhost:8000/internal/issues/1/section/coding
curl http://localhost:8000/internal/issues/1/section/investments
curl http://localhost:8000/internal/issues/1/section/alpha
curl http://localhost:8000/internal/issues/1/section/all
```

Resend an existing issue snapshot:

```bash
curl -X POST "http://localhost:8000/internal/issues/1/resend?telegram_user_id=123456789&telegram_chat_id=123456789"
```

Alpha entries:

```bash
curl "http://localhost:8000/internal/alpha?limit=20"
curl "http://localhost:8000/internal/alpha?status=published&date=2026-03-25"
curl http://localhost:8000/internal/alpha/1
```

Create Alpha entry:

```bash
curl -X POST http://localhost:8000/internal/alpha \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Alpha signal",
    "body_short": "Короткая авторская находка.",
    "body_long": "Более длинное описание сигнала или идеи.",
    "source_links_json": ["https://example.com/alpha"],
    "priority_rank": 1,
    "publish_date": "2026-03-25",
    "status": "ready",
    "created_by": "editor"
  }'
```

Publish Alpha entry:

```bash
curl -X POST http://localhost:8000/internal/alpha/1/publish
```

## Scheduler

- APScheduler runs a periodic ingestion job
- APScheduler also runs a periodic process-events job
- APScheduler also builds and sends daily/weekly digest issues
- interval is controlled by `INGESTION_INTERVAL_MINUTES`
- process-events interval is controlled by `PROCESS_EVENTS_INTERVAL_MINUTES`
- daily issue build/send hour is controlled by `DAILY_DIGEST_HOUR`
- weekly issue build/send schedule is controlled by `WEEKLY_DIGEST_WEEKDAY` and `WEEKLY_DIGEST_HOUR`
- scheduler can be disabled with `INGESTION_SCHEDULER_ENABLED=false`
- duplicate overlapping batch runs are blocked in-process by an async lock

## Seeded starter sources

`scripts/seed_sources.py` now loads starter sources from [scripts/data/seed_sources.csv](/Users/malast/malakhov-ai-digest/scripts/data/seed_sources.csv).

Behavior:
- upserts by `handle_or_url`
- converts CSV `priority_weight` values like `0.95` into integer weights for the current DB schema
- imports only source types currently supported by Slice 2: `rss_feed`, `official_blog`
- skips unsupported `website` rows and prints them explicitly
- accepts `section_bias` in the CSV as future-facing editorial metadata, but does not store it yet

This keeps the seed input aligned with editorial planning while avoiding schema creep inside Slice 2.

## Telegram behavior

Daily users:
- receive daily main message
- can request the same daily snapshot again from the menu without rebuilding it
- see inline buttons:
  - `Новости ИИ`
  - `Кодинг`
  - `Инвестиции`
  - `Альфа`
  - `Все за день`
  - `О боте`

Weekly users:
- receive weekly issue message
- can request the latest weekly snapshot again from the menu without rebuilding it

Section buttons:
- send a new Telegram message
- read from the stored issue snapshot
- log a `section_open` delivery record
- remain valid on repeated presses

Empty states:
- alpha renders a calm empty-state message when there are no published entries
- weak sections render a compact empty-state card instead of breaking layout

`/start` behavior:
- shows a normal welcome message instead of a technical stub
- offers `Каждый день`, `Только еженедельные сводки`, `О боте`
- preserves the current subscription mode for existing users and shows it in the welcome flow

Rendering hardening:
- all bot renderers return one or more Telegram-safe message chunks
- long messages are split before Telegram limits
- content text is HTML-escaped before sending
- digest resend and section opens reuse the stored issue snapshot instead of rebuilding content

## Tests

Run:

```bash
pytest -q
```

Coverage in current test suite:
- Alembic `upgrade head` smoke test from zero
- bot/user flow from Slice 1
- `/health` and `/health/db`
- source creation
- successful RSS ingestion
- dedup on repeated ingestion
- `source_runs` success logging
- `source_runs` failure logging
- official blog feed discovery path
- internal preview endpoints
- manual `POST /internal/jobs/ingest`
- raw item normalization
- entity extraction and outbound links extraction
- clustering similar raw items into one event
- separating different raw items into different events
- primary source selection
- category assignment for `ai_news`, `coding`, `investments`
- score calculation through process-events pipeline
- internal events preview endpoints
- repeated process-events run idempotency
- build daily issue
- build weekly issue
- section snapshot selection for `important`, `ai_news`, `coding`, `investments`
- all-section rendering
- empty alpha rendering
- alpha entry creation and publish flow
- published alpha inclusion in daily and weekly issues
- daily main renderer
- section renderer
- `/start` welcome rendering
- `/start` flow for new and existing users
- long message chunking and Telegram-safe rendering utilities
- callback handler sends a new message
- deliveries logging for main send
- deliveries logging for section open
- issue snapshot reuse
- resend existing issue from snapshot
- duplicate mass-send protection basic case
- manual issue build/send endpoints

## Notes for next slices

Slice 2 stores enough raw material for:
- normalization pipeline
- clustering/event detection
- scoring and digest composition
- future adapters for Telegram channels, X accounts, and other publisher sources

Slice 3 now adds the reusable event layer for:
- daily/weekly digest builders
- issue assembly
- manual editorial review
- richer ranking or optional LLM summarization in future slices

Slice 4 now adds:
- stable digest snapshots for Telegram delivery
- section-level follow-up messages from issue snapshots
- a clean base for future personalization, editorial controls, and web reuse

Slice 5 now adds:
- manual Alpha layer ready for future editorial workflows
- hardened Telegram rendering and resend behavior
- a cleaner first-run `/start` experience
- a better base for future web/admin/editor surfaces
