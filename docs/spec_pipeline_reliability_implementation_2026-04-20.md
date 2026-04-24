# Spec: реализация надёжного pipeline публикации

**Дата:** 2026-04-20  
**Проект:** `malakhov-ai-digest`  
**Статус:** implementation spec для разработки

## 1. Цель

Сделать так, чтобы ingest, enrichment, publish verification и Telegram-digest работали как согласованный stateful pipeline, а не как набор независимых cron-job с ручным recovery.

## 2. Негласные ограничения текущего репо

- публичные выборки сайта сейчас читают `published=true AND quality_ok=true`
- Telegram digest уже пишет `digest_runs`
- `pipeline/enricher.ts` выбирает `enriched=false`, то есть сейчас нет защиты от race condition
- `pipeline/rss-parser.ts` и `pipeline/ingest.ts` не держат source-level operational state

## 3. Целевая архитектура

Контур должен работать так:

1. `rss-parse.yml` запускает ingest.
2. ingest записывает run-log и source-level результат.
3. новые статьи попадают в `articles` со статусом `pending`.
4. `enrich.yml` или `retry-failed.yml` atomically claim'ит статьи.
5. enrichment переводит статью в `enriched_ok`, `retry_wait`, `rejected` или `failed`.
6. publish verify подтверждает live-доступность.
7. только verified-live статьи участвуют в сайте, sitemap, image jobs и Telegram.
8. hourly health job следит за sources, backlog, stuck jobs и provider health.

## 4. State model

### 4.1 Поля

- `ingest_status`
- `enrich_status`
- `publish_status`
- `attempt_count`
- `next_retry_at`
- `processing_by`
- `claim_token`
- `lease_expires_at`
- `last_error`
- `last_error_code`
- `verified_live`

### 4.2 Допустимые значения

- `ingest_status`: `ingested`, `ingest_failed`
- `enrich_status`: `pending`, `processing`, `retry_wait`, `enriched_ok`, `rejected`, `failed`, `stuck`
- `publish_status`: `draft`, `publish_ready`, `verifying`, `live`, `verification_failed`, `withdrawn`

### 4.3 Разрешённые переходы

1. новая запись после ingest: `pending` + `draft`
2. worker claim: `pending|retry_wait -> processing`
3. enrichment success: `processing -> enriched_ok` и `draft -> publish_ready`
4. permanent content reject: `processing -> rejected`
5. retryable failure: `processing -> retry_wait`
6. exhausted retries: `retry_wait -> failed`
7. expired lease: `processing -> stuck -> retry_wait`
8. verify started: `publish_ready -> verifying`
9. verify success: `verifying -> live`
10. verify failure: `verifying -> verification_failed`

## 5. Модель данных

### 5.1 `articles`

Новые поля описаны в roadmap. Для реализации важно следующее:

- `first_seen_at/last_seen_at/discover_count` используются ingest-слоем
- `attempt_count/next_retry_at` используются enrichment-слоем
- `claim_token/lease_expires_at` используются для atomic claim/recovery
- `verified_live` используется как часть public gate

### 5.2 `ingest_runs`

Нужен итоговый run-log по cron-запуску ingest.

### 5.3 `source_runs`

Нужен per-source журнал, чтобы отличать:

- feed timeout
- upstream 404/403
- source alive but empty
- duplicates only

### 5.4 `enrich_runs`

Нужен агрегированный журнал запуска enrichment или retry-worker.

### 5.5 `pipeline_alerts`

Нужен один operational канал с dedupe и lifecycle.

### 5.6 `article_attempts`

Нужен immutable trail попыток по статье.

## 6. Поведение компонентов

### 6.1 `pipeline/ingest.ts`

Должен:

- canonicalize URL до dedup
- писать `ingest_runs`
- писать `source_runs`
- вставлять новые статьи как `pending`
- на дубле обновлять `last_seen_at` и `discover_count`
- не валить весь job из-за одного деградировавшего source

### 6.2 `pipeline/enricher.ts`

Должен:

- делать claim только atomically
- брать статьи со статусом `pending` или готовые к retry
- уважать provider budget
- писать `article_attempts`
- различать business reject и operational error
- поддерживать dual-write в legacy-флаги

### 6.3 `pipeline/retry-failed.ts`

Должен:

- выбирать только `retry_wait`
- уважать `next_retry_at`
- увеличивать `attempt_count`
- после лимита попыток переводить в `failed`

### 6.4 `pipeline/recover-stuck.ts`

Должен:

- искать `processing` с просроченным lease
- переводить их в `stuck`
- затем возвращать в `retry_wait`
- не трогать записи с валидным активным lease

### 6.5 `pipeline/source-health.ts`

Должен:

- считать source silence относительно cadence source
- поднимать alerts только после threshold
- не путать “empty result” и “technical failure”

### 6.6 `pipeline/provider-guard.ts`

Должен:

- смотреть окно ошибок Anthropic
- открывать circuit breaker при spike `429/5xx`
- уменьшать claim volume во время деградации
- писать provider-level alert

### 6.7 `pipeline/publish-verify.ts`

Должен:

- проверять статьи в `publish_ready` или recent `published`
- подтверждать live page, sitemap и basic meta
- переводить только успешно проверенные статьи в `publish_status='live'`

### 6.8 `pipeline/alerts.ts`

Должен:

- уметь `open`, `touch`, `resolve`
- дедуплицировать по `dedupe_key`
- ограничивать повторные Telegram-уведомления по cooldown

## 7. Public visibility strategy

### 7.1 Целевое правило

Статья считается публичной только если:

- `quality_ok=true`
- `published=true`
- `verified_live=true`
- `publish_status='live'`

### 7.2 Practical path

Чтобы не сломать текущий сайт:

1. Сначала оставить `published` совместимым флагом.
2. Добавить SQL view `public_articles`.
3. Перевести `lib/articles.ts`, Telegram и image jobs на чтение из `public_articles`.
4. Только потом очищать legacy-чтения.

## 8. Workflows

### 8.1 `rss-parse.yml`

- schedule остаётся `*/30 * * * *`
- добавить `concurrency`
- писать `ingest_runs`
- не считать частичный source failure глобальным падением всего workflow

### 8.2 `enrich.yml`

- schedule можно перевести на каждые 30 минут
- добавить `concurrency`
- добавить `timeout-minutes`
- использовать только atomic claim

### 8.3 `retry-failed.yml`

- отдельный workflow для `retry_wait`
- schedule каждые 30 минут

### 8.4 `pipeline-health.yml`

- запуск каждый час
- вызывает `source-health.ts`, `backlog-monitor.ts`, `recover-stuck.ts`, `provider-guard.ts`

### 8.5 `publish-verify.yml`

- hourly batch verify с grace period

## 9. Файлы, которые придётся менять

- `pipeline/enricher.ts`
- `pipeline/ingest.ts`
- `pipeline/rss-parser.ts`
- `bot/daily-digest.ts`
- `lib/articles.ts`
- `lib/supabase.ts`
- `.github/workflows/enrich.yml`
- `.github/workflows/rss-parse.yml`
- `.github/workflows/tg-digest.yml`

## 10. Открытые решения, которые не надо оставлять “на потом”

1. Что именно означает `published` в переходный период: “готово к verify” или “уже live”.
2. Будет ли atomic claim через SQL update или через RPC Supabase.
3. Делаем ли `public_articles` как SQL view сразу в первой миграции или во второй.
4. Сколько retry для `editorial_parse_failed` реально допустимо до permanent failure.

## 11. Рекомендуемый порядок кодирования

1. Миграция БД.
2. Dual-write в ingest/enrich.
3. Atomic claim/lease.
4. Retry и stuck recovery.
5. Alerts + health monitor.
6. Publish verify.
7. Switch публичных чтений.

