# Architecture

## Верхний уровень

Система разделена на четыре слоя:

1. Web app: Next.js приложение в `app/` и `src/components/`, отрендеренное на Vercel.
2. Data layer: Supabase PostgreSQL как единый источник данных.
3. Content pipeline: TypeScript-скрипты в `pipeline/`, запускаемые по cron через GitHub Actions.
4. Delivery and observability: Telegram digest, publish verification, health checks, alerts.

## Runtime Boundaries

### 1. Публичный сайт

- Читает данные из Supabase.
- Не использует `SUPABASE_SERVICE_KEY` на клиентской стороне.
- Рендерит опубликованные статьи, topic pages, sources, archive и SEO-артефакты.

### 2. Pipeline

- `pipeline/ingest.ts` создаёт или обновляет сырьевые записи статей.
- `pipeline/enrich-submit-batch.ts` забирает pending-статьи, считает score, fetch-ит оригинал и создаёт Anthropic batch jobs.
- `pipeline/enrich-collect-batch.ts` импортирует provider results и apply-ит final editorial outcome к статье.
- `pipeline/enricher.ts` остаётся compatibility wrapper для `npm run enrich`.
- Вспомогательные pipeline-модули отвечают за scoring, fetch, slug, retries, verification и monitoring.

### 3. Data contracts

Основной объект системы — строка в `articles`.

High-level contract:
- ingest создаёт raw article с исходными метаданными;
- enrichment добавляет editorial fields и operational statuses;
- enrichment также сохраняет extracted media fields статьи, включая tables, images и videos;
- publish verification подтверждает, что материал доступен на сайте;
- Telegram использует уже опубликованные материалы.

RLS contract:
- public tables в схеме `public` работают с включённым RLS;
- единственная публичная policy на `articles` разрешает `SELECT` только для live-материалов (`published=true`, `quality_ok=true`, `verified_live=true`, `publish_status='live'`);
- `categories` имеет public read только для `is_active=true`; запись — только через `service_role`;
- operational tables (`article_attempts`, `ingest_runs`, `enrich_runs`, `digest_runs`, `pipeline_alerts`, `source_runs`) не имеют public policies и должны читаться/писаться только через `service_role`.

Модель категорий:
- одна основная категория на статью (`articles.primary_category`, FK на `categories.slug`, NOT NULL);
- до двух смежных (`articles.secondary_categories`, `text[]` с CHECK на длину ≤ 2);
- legacy `topics[]` остаётся read-only до полного cutover; canonical и URL опираются на `primary_category`.

Дополнительные operational tables используются для observability и retries:
- `ingest_runs`
- `enrich_runs`
- `llm_usage_logs`
- `anthropic_batches`
- `anthropic_batch_items`
- `source_runs`
- `digest_runs`
- `article_attempts`
- `pipeline_alerts`

Для batch enrich действует отдельная граница ответственности:

- coarse article state остаётся в `articles`;
- batch lifecycle и idempotent apply ownership живут в `anthropic_batches` / `anthropic_batch_items`;
- `articles.current_batch_item_id` связывает статью с активным batch-owned item, пока final apply не завершён.

Для cost observability действует отдельный инвариант:

- run-level totals по Claude должны писаться структурно в `enrich_runs.total_*` и `enrich_runs.estimated_cost_usd`, а не только в строковый `error_summary`;
- единый per-call/per-item audit trail должен писаться в `llm_usage_logs`;
- batch-level totals в `anthropic_batches` должны пересчитываться из `anthropic_batch_items`, чтобы dashboard и alerting не зависели от логов stdout.

## Основные модули

| Зона | Ответственность |
|---|---|
| `app/` | маршруты и серверный рендер |
| `src/components/` | UI-слой |
| `lib/articles.ts` | серверные выборки и резолвинг article data |
| `lib/supabase.ts` | типы и Supabase clients |
| `pipeline/` | ingest, enrich, scoring, fetch, verification, recovery |
| `bot/` | Telegram delivery |
| `.github/workflows/` | расписание и запуск фоновых процессов |

## Важные архитектурные правила

- Источник истины по статье — Supabase, а не кэш в приложении.
- Public web и background pipeline разделены: сайт не выполняет enrichment.
- Operational status fields важнее legacy boolean-флагов; legacy поля сохраняются только для обратной совместимости.
- Batch-specific states не должны размножаться в `articles.enrich_status`; source of truth для них — batch tables.
- `legacy/` изолирован и не участвует в текущем runtime.

## Когда обновлять этот файл

Обновлять при изменении:
- границ модулей;
- структуры данных и статусов;
- ролей Supabase/Next.js/pipeline;
- взаимодействия между публичным web и background jobs.
