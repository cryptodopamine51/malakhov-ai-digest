# Malakhov AI Digest

Текущая версия проекта: `FastAPI + PostgreSQL + event-layer + Telegram delivery + HTML site shell`.

В репозитории также остался legacy-слой на `Next.js + Supabase articles + Node pipeline`, но он больше не является основной архитектурой проекта.

Сводный review и карта расхождений: [docs/architecture_review_2026-04-16.md](docs/architecture_review_2026-04-16.md)

## Текущее состояние

Основной runtime:

- `app/api/` — FastAPI API и HTML-страницы сайта
- `app/services/` — ingestion, normalization, clustering, scoring, digest, alpha, quality
- `app/db/` — SQLAlchemy-модели и сессии
- `app/jobs/` — scheduler и фоновые jobs
- `app/bot/` — Telegram bot/runtime
- `alembic/` — миграции

Legacy-слой:

- `pipeline/`
- `bot/*.ts`
- `lib/articles.ts`
- `src/app/` и часть `app/*.tsx`
- `supabase/schema.sql`
- старые workflow `rss-parse.yml`, `enrich.yml`, `tg-digest.yml`

## Требования

- Python `3.12+`
- Node `20+`
- Docker / Docker Compose для локального Postgres

Репозиторий сейчас не ориентирован на системный Python `3.9` и старый Node `18.15`.

## Быстрый старт

### 1. Поднять PostgreSQL

```bash
docker compose up -d postgres
```

По умолчанию локальная БД:

- host: `127.0.0.1`
- port: `5432`
- db: `malakhov_ai_digest`
- user: `postgres`
- password: `postgres`

### 2. Подготовить Python-окружение

Пример через `venv`:

```bash
python3.12 -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"
```

### 3. Подготовить `.env`

```bash
cp .env.example .env
```

Минимально для локального backend нужны:

- `DATABASE_URL`
- `BOT_TOKEN`

Если Telegram-бот пока не нужен, можно оставить тестовый placeholder `BOT_TOKEN`, но полноценная отправка сообщений и часть runtime-функций без рабочего токена не будут валидироваться.

### 4. Применить миграции

```bash
alembic upgrade head
```

### 5. Засидировать источники

```bash
python scripts/seed_sources.py
```

### 6. Запустить API

```bash
bash scripts/run_api.sh
```

API по умолчанию поднимается на `http://127.0.0.1:8000`.

Проверки:

```bash
curl http://127.0.0.1:8000/health
curl http://127.0.0.1:8000/health/db
```

## Локальные команды

### Backend

```bash
alembic upgrade head
python scripts/seed_sources.py
bash scripts/run_api.sh
bash scripts/run_scheduler.sh
bash scripts/run_bot.sh
pytest -q
```

### Frontend / legacy Node-слой

```bash
npm install
npm run build
npm run ingest
npm run enrich
npm run tg-digest
```

Этот слой не считается текущим каноническим runtime и должен использоваться только осознанно как legacy/transition часть проекта.

## Переменные окружения

Актуальные backend env берутся из `app/core/config.py`.

Ключевые:

- `APP_ENV`
- `APP_HOST`
- `APP_PORT`
- `DATABASE_URL`
- `BOT_TOKEN`
- `BOT_POLLING_ENABLED`
- `OPENAI_API_KEY`
- `OPENAI_SUMMARY_ENABLED`
- `OPENAI_SUMMARY_MODEL`
- `DEFAULT_TIMEZONE`
- `INGESTION_SCHEDULER_ENABLED`
- `PROCESS_EVENTS_SCHEDULER_ENABLED`
- `DAILY_DIGEST_HOUR`
- `DAILY_DIGEST_MINUTE`
- `WEEKLY_DIGEST_WEEKDAY`
- `WEEKLY_DIGEST_HOUR`
- `WEEKLY_DIGEST_MINUTE`
- `SITE_LEADS_CHAT_ID`
- `RESEND_API_KEY`
- `SMTP_HOST`
- `SMTP_PORT`
- `SMTP_USER`
- `SMTP_PASS`
- `LEADS_EMAIL_TO`
- `LEADS_EMAIL_FROM`

Legacy Node env:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_KEY`
- `DEEPL_API_KEY`
- `ANTHROPIC_API_KEY`
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_CHANNEL_ID`
- `NEXT_PUBLIC_SITE_URL`

## Миграции и БД

Для актуального backend единственный корректный путь инициализации схемы — `Alembic`.

`supabase/schema.sql` описывает только legacy-таблицу `articles` и не подходит как bootstrap для текущего Python runtime.

## Workflow и деплой

В репозитории сейчас есть два поколения workflow:

- current: `daily_digest.yml`, `weekly_digest.yml`
- legacy: `rss-parse.yml`, `enrich.yml`, `tg-digest.yml`

Перед изменениями в CI/CD сначала проверь, какой контур реально используется в проде.

Production compose и ops-скрипты лежат в:

- `deploy/compose.production.yml`
- `scripts/ops/`

## Тесты

Основной тестовый контур:

```bash
pytest -q
```

Есть покрытие для:

- API
- миграций
- ingestion/source policy
- shortlist/scoring
- digest builder/delivery
- public site shell

## Что стоит сделать дальше

- окончательно зафиксировать `Python/FastAPI/event-layer` как каноническую архитектуру
- архивировать или удалить дубли legacy Next/Supabase слоя
- развести current и legacy workflow по явным статусам
- вынести deployment-specific значения в env/config
