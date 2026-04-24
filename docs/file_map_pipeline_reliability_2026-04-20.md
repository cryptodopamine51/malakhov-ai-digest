# File Map: pipeline reliability

**Дата:** 2026-04-20  
**Статус:** точная карта файлов и функций для реализации

## 1. Файлы, которые менять обязательно

### `lib/supabase.ts`

Что менять:

- интерфейс `Article`
- возможно, дополнительные type aliases для статусов

Что добавить:

- `ingest_status`
- `enrich_status`
- `publish_status`
- `first_seen_at`
- `last_seen_at`
- `discover_count`
- `attempt_count`
- `processing_started_at`
- `processing_finished_at`
- `processing_by`
- `claim_token`
- `lease_expires_at`
- `last_error`
- `last_error_code`
- `next_retry_at`
- `publish_ready_at`
- `verified_live`
- `verified_live_at`
- `live_check_error`

### `pipeline/enricher.ts`

Что менять:

- `enrichArticle(...)`
- `enrichBatch()`

Что менять по смыслу:

- убрать выборку по `enriched=false`
- внедрить atomic claim
- ввести lease
- писать `article_attempts`
- писать `enrich_runs`
- развести retry/permanent/provider errors

### `pipeline/ingest.ts`

Что менять:

- `insertArticle(...)`
- `main()`

Что менять по смыслу:

- `ingest_runs`
- `source_runs`
- duplicate-touch logic
- запись новых status fields

### `pipeline/rss-parser.ts`

Что менять:

- `buildDedupHash(...)`
- `fetchAllFeeds(...)`
- возможно, `parseFeed(...)`

Что менять по смыслу:

- canonicalization URL
- stronger dedup input
- richer source-level outcome data

### `bot/daily-digest.ts`

Что менять:

- основной select статей для digest
- `sendHealthReport(...)`
- `logDigestRun(...)` только если надо расширять payload

Что менять по смыслу:

- перейти на verified-live выборку
- не дублировать `digest_runs`

### `lib/articles.ts`

Что менять:

- `getLatestArticles(...)`
- `getArticleBySlug(...)`
- `getArticlesByTopic(...)`
- `getAllSlugs()`
- `getTopTodayArticles(...)`
- `getArticlesFeed(...)`
- `getRelatedArticles(...)`
- `getSourcesStats()`
- `getArticlesBySource(...)`
- `getArticlesByDate(...)`

Что менять по смыслу:

- перевести public reads на `public_articles` или на новый gate

## 2. Новые файлы

### `pipeline/retry-failed.ts`

Ответственность:

- выбирать `retry_wait`
- уважать `next_retry_at`
- перезапускать enrichment safely

### `pipeline/recover-stuck.ts`

Ответственность:

- искать expired lease
- переводить `processing -> stuck -> retry_wait`

### `pipeline/source-health.ts`

Ответственность:

- health check по источникам
- source silence/failure thresholds

### `pipeline/backlog-monitor.ts`

Ответственность:

- age and backlog metrics
- backlog alerts

### `pipeline/provider-guard.ts`

Ответственность:

- provider outage detection
- circuit breaker logic

### `pipeline/alerts.ts`

Ответственность:

- open/touch/resolve alert
- dedupe_key semantics

### `pipeline/status.ts`

Рекомендуемый helper-файл для:

- констант статусов
- retryable error buckets
- backoff policy
- shared transition helpers

## 3. Workflow files

### `.github/workflows/enrich.yml`

Нужно:

- `concurrency`
- `timeout-minutes`
- новый запуск `npm run enrich` уже с claim/lease логикой

### `.github/workflows/rss-parse.yml`

Нужно:

- сохранить cadence
- поддержать partial success

### `.github/workflows/tg-digest.yml`

Нужно:

- убедиться, что job использует новый visibility gate косвенно через код

### `.github/workflows/retry-failed.yml`

Новый файл.

### `.github/workflows/pipeline-health.yml`

Новый файл.

### `.github/workflows/publish-verify.yml`

Новый файл.

## 4. Файлы, которые затронуть желательно, но не в first slice

### `pipeline/generate-images.ts`

Причина:

- сейчас читает `published=true` и `quality_ok=true`
- после visibility switch должен читать только public/verified-live статьи

### `scripts/reenrich-all.ts`

Причина:

- сейчас жёстко опирается на `enriched=false`
- после status-layer должен либо использовать новые transitions, либо быть явно помечен как legacy recovery script

### `scripts/reenrich-topic-slices.ts`

Причина:

- та же legacy-зависимость на старые флаги и прямые update-переходы

### `scripts/check-db.ts`

Причина:

- стоит обновить diagnostic output под новые статусы

## 5. Файлы, которые лучше пока не трогать

- `pipeline/claude.ts`, если нет изменения prompt contract
- `pipeline/scorer.ts`, если reliability-волна не смешивается с editorial-логикой
- UI-компоненты сайта, кроме слоя data reads

## 6. Рекомендуемое распределение ответственности по коду

### Data model / schema

- `supabase/migrations/*`
- `lib/supabase.ts`

### Queue and worker semantics

- `pipeline/enricher.ts`
- `pipeline/retry-failed.ts`
- `pipeline/recover-stuck.ts`
- `pipeline/status.ts`

### Source observability

- `pipeline/rss-parser.ts`
- `pipeline/ingest.ts`
- `pipeline/source-health.ts`

### Public visibility

- `pipeline/publish-verify.ts`
- `lib/articles.ts`
- `bot/daily-digest.ts`
- `pipeline/generate-images.ts`

