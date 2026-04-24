# Task Breakdown: внедрение надёжного pipeline публикации

**Дата:** 2026-04-20  
**Статус:** рабочий breakdown для разработки

## Блок 1. Схема БД и типы

- Добавить migration file под status/lease/error поля в `articles`.
- Добавить таблицы `ingest_runs`, `source_runs`, `enrich_runs`, `pipeline_alerts`, `article_attempts`.
- Добавить индексы и check constraints.
- Обновить `lib/supabase.ts` под новые поля.

## Блок 2. Ingest observability

- Обновить `pipeline/rss-parser.ts` для canonicalization и улучшенного dedup input.
- Обновить `pipeline/ingest.ts` под `ingest_runs` и `source_runs`.
- На duplicate обновлять `last_seen_at` и `discover_count`.
- Развести source empty и source technical failure.

## Блок 3. Atomic enrichment

- Переписать `pipeline/enricher.ts` на atomic claim/lease.
- Добавить `processing_by`, `claim_token`, `lease_expires_at`.
- Включить dual-write в новые статусы и legacy-флаги.
- Начать писать `article_attempts` и `enrich_runs`.

## Блок 4. Retry и stuck recovery

- Создать `pipeline/retry-failed.ts`.
- Создать `pipeline/recover-stuck.ts`.
- Настроить retry policy и backoff.
- Проверить, что exhausted retries попадают в `failed`, а не циклятся бесконечно.

## Блок 5. Monitoring и alerts

- Создать `pipeline/source-health.ts`.
- Создать `pipeline/backlog-monitor.ts`.
- Создать `pipeline/provider-guard.ts`.
- Создать `pipeline/alerts.ts` с dedupe.

## Блок 6. Publish verification

- Создать `pipeline/publish-verify.ts`.
- Определить, как именно verify работает при текущем смысле `published`.
- Добавить `verified_live` и `publish_status='live'`.

## Блок 7. Переключение чтений

- Обновить `bot/daily-digest.ts` на verified-live выборку.
- Обновить `lib/articles.ts` на visibility gate.
- При необходимости создать SQL view `public_articles`.
- Проверить image/job контур на ту же выборку.

## Блок 8. Workflows

- Обновить `.github/workflows/rss-parse.yml`.
- Обновить `.github/workflows/enrich.yml`.
- Создать `.github/workflows/retry-failed.yml`.
- Создать `.github/workflows/pipeline-health.yml`.
- Создать `.github/workflows/publish-verify.yml`.

## Блок 9. Миграция и rollout

- Сделать backfill старых `articles`.
- Включить новые jobs по очереди, не все сразу.
- Сначала перевести Telegram.
- Потом перевести сайт и остальные public reads.

## Предлагаемый порядок разработки

1. Блок 1.
2. Блок 3.
3. Блок 4.
4. Блок 2.
5. Блок 5.
6. Блок 6.
7. Блок 8.
8. Блок 9.
9. Блок 7.

## Результат этого breakdown

После выполнения всех блоков у команды должен быть не просто “улучшенный enricher”, а полный operational контур с диагностикой, recovery и безопасным visibility gate.

