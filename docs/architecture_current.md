# Current Architecture

Дата фиксации: 2026-04-16

## Канонический runtime

Текущая рабочая архитектура проекта:

- `FastAPI` как основной HTTP runtime
- `PostgreSQL` как основная БД
- `SQLAlchemy + Alembic` как слой моделей и миграций
- `event-layer` вместо плоской таблицы `articles`
- `APScheduler` для локального scheduler/runtime
- `aiogram` для Telegram delivery
- HTML site shell, который отдается самим backend

## Основные слои

### Ingestion

- `sources`
- `source_runs`
- `raw_items`
- адаптеры RSS / website / official blog

### Event processing

- normalization
- shortlist
- clustering
- classification
- scoring
- summary building

Ключевые сущности:

- `events`
- `event_sources`
- `event_categories`
- `event_tags`
- `llm_usage_logs`
- `process_runs`

### Editorial / delivery

- `digest_issues`
- `digest_issue_items`
- `deliveries`
- `alpha_entries`

### Public surfaces

- `/`
- `/events`
- `/events/{slug}`
- `/issues`
- `/issues/{id}`
- `/russia`
- `/alpha`
- `/sitemap.xml`

Все эти маршруты сейчас живут в backend `app/api/main.py`.

## Источник истины

Для актуального продукта источником истины являются:

- SQLAlchemy models
- Alembic migrations
- сервисы из `app/services/`

Не являются источником истины для current runtime:

- `supabase/schema.sql`
- старый `articles`-pipeline на Node
- old Next pages, читающие `articles`

## Legacy-слой

В репозитории сохранён исторический слой MVP:

- `pipeline/*.ts`
- `bot/*.ts`
- `lib/articles.ts`
- `src/app/*`
- часть `app/*.tsx`
- `supabase/schema.sql`
- старые workflow `rss-parse.yml`, `enrich.yml`, `tg-digest.yml`

Этот слой не должен считаться канонической архитектурой без отдельного решения.
