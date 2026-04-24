# Execution Plan: pipeline reliability

**Дата:** 2026-04-20  
**Статус:** practical execution plan для первой реализации

## 1. Цель этого документа

Свести roadmap и spec к реальному порядку коммитов, чтобы разработка шла короткими безопасными срезами, а не одним большим risky diff.

## 2. Принцип разбиения

Каждый коммит или маленькая серия коммитов должна:

- оставлять репо в рабочем состоянии
- не ломать существующие workflow
- не требовать мгновенного переключения публичных чтений
- давать наблюдаемый промежуточный результат

## 3. Рекомендуемый порядок коммитов

### Commit 1. Schema scaffolding

Содержимое:

- новая миграция с status/lease/error полями в `articles`
- новые таблицы `ingest_runs`, `source_runs`, `enrich_runs`, `pipeline_alerts`, `article_attempts`
- индексы и check constraints

Файлы:

- `supabase/migrations/005_pipeline_reliability.sql`
- при необходимости обновление `supabase/schema.sql` как snapshot документации

Результат:

- схема готова, но runtime ещё не зависит от новых полей

### Commit 2. Types and constants

Содержимое:

- расширение `Article` в `lib/supabase.ts`
- типы статусов и error codes
- базовые helper-константы для retry/lease

Файлы:

- `lib/supabase.ts`
- новый `pipeline/types.ts` или `pipeline/status.ts`

Результат:

- код может безопасно начать dual-write и читать новые поля

### Commit 3. Enricher dual-write + atomic claim

Содержимое:

- переписать `pipeline/enricher.ts` на claim/lease
- перестать читать `enriched=false`
- писать `enrich_runs` и `article_attempts`
- поддерживать legacy `enriched/published/quality_ok`

Файлы:

- `pipeline/enricher.ts`
- опционально новый helper `pipeline/claims.ts`

Результат:

- главная гонка в пайплайне закрыта

### Commit 4. Retry and stuck recovery

Содержимое:

- новый `pipeline/retry-failed.ts`
- новый `pipeline/recover-stuck.ts`
- общие helper для backoff и state transitions

Файлы:

- `pipeline/retry-failed.ts`
- `pipeline/recover-stuck.ts`
- `pipeline/status.ts`

Результат:

- transient failures перестают превращаться в ручной recovery

### Commit 5. Ingest observability and stronger dedup

Содержимое:

- `pipeline/rss-parser.ts`: canonicalization и stronger dedup input
- `pipeline/ingest.ts`: `ingest_runs`, `source_runs`, duplicate-touch logic

Файлы:

- `pipeline/rss-parser.ts`
- `pipeline/ingest.ts`

Результат:

- discovery становится наблюдаемым

### Commit 6. Alerts and health monitoring

Содержимое:

- `pipeline/alerts.ts`
- `pipeline/source-health.ts`
- `pipeline/backlog-monitor.ts`
- `pipeline/provider-guard.ts`

Файлы:

- новые `pipeline/*.ts`

Результат:

- hourly health job уже может давать полезный сигнал без спама

### Commit 7. Workflow rollout

Содержимое:

- обновить `rss-parse.yml`
- обновить `enrich.yml`
- добавить `retry-failed.yml`
- добавить `pipeline-health.yml`

Файлы:

- `.github/workflows/rss-parse.yml`
- `.github/workflows/enrich.yml`
- `.github/workflows/retry-failed.yml`
- `.github/workflows/pipeline-health.yml`

Результат:

- новый operational контур начинает работать, но public reads ещё не переключены

### Commit 8. Publish verify

Содержимое:

- `pipeline/publish-verify.ts`
- `publish-verify.yml`

Результат:

- verified-live сигнал появляется в данных

### Commit 9. Visibility gate switch

Содержимое:

- SQL view `public_articles` или эквивалент
- `lib/articles.ts` переводится на новый gate
- `bot/daily-digest.ts` переводится на verified-live выборку
- проверить `pipeline/generate-images.ts`

Результат:

- сайт и Telegram читают одно и то же определение public article

## 4. Первая реализация без лишнего scope

Если брать самый pragmatic first slice, то делать только это:

1. Commit 1.
2. Commit 2.
3. Commit 3.
4. Commit 4.
5. минимальный workflow rollout для `enrich.yml` и `retry-failed.yml`.

В этот first slice не включать:

- `public_articles`
- полный source health
- publish verify
- перевод Telegram

Смысл:

- сначала стабилизировать самое больное место: enrichment queue и ручной recovery

## 5. Рекомендуемые PR-срезы

### PR 1. Schema + types + enricher claim

Содержит:

- миграцию
- типы
- переписанный `enricher.ts`

### PR 2. Retry + stuck recovery + workflows

Содержит:

- retry worker
- stuck recovery
- обновлённые enrich/retry workflows

### PR 3. Ingest observability + source health

Содержит:

- ingest logs
- source logs
- source health
- backlog monitor

### PR 4. Verify + visibility gate

Содержит:

- publish verify
- `public_articles`
- Telegram/site switch

## 6. Что обязательно проверить после каждого большого коммита

- `npm run ingest`
- `npm run enrich`
- типы `Article` не ломают текущие селекты
- новые nullable-поля не ломают сериализацию
- workflow env vars не требуют новых secret до того, как код начнёт их читать

## 7. Stop conditions

Нужно остановиться и не мёржить дальше, если:

- claim по факту не атомарен
- `retry_wait` можно получить без `next_retry_at`
- новый код начал трактовать `quality_reason` как operational error bucket
- visibility gate ещё не внедрён, а публичные чтения уже завязаны на `verified_live`

