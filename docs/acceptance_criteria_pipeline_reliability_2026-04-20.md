# Acceptance Criteria: надёжность pipeline публикации

**Дата:** 2026-04-20  
**Статус:** критерии приёмки для разработки и smoke-check

## 1. Схема и данные

- В `articles` есть новые status/lease/error поля.
- В БД есть `ingest_runs`, `source_runs`, `enrich_runs`, `pipeline_alerts`, `article_attempts`.
- На новые status-поля стоят check constraints.
- Старые строки в `articles` получили backfill без `null` в обязательных operational местах.

## 2. Ingest

- Один упавший source не валит весь ingest.
- После каждого запуска есть одна запись в `ingest_runs`.
- После каждого source fetch есть запись в `source_runs`.
- Duplicate item не создаёт новую строку статьи, а обновляет `last_seen_at` и `discover_count`.

## 3. Enrichment

- Два параллельных запуска `enrich.yml` не обрабатывают одну и ту же статью.
- У каждой взятой в работу статьи есть `processing_by`, `claim_token`, `processing_started_at`, `lease_expires_at`.
- Retryable и permanent ошибки расходятся по разным статусам.
- `quality_reason` не используется как замена operational error code.

## 4. Retry и stuck recovery

- Статья с retryable ошибкой получает `retry_wait` и `next_retry_at`.
- После превышения retry лимита статья становится `failed`.
- Просроченный `processing` lease переводится в `stuck`, затем в `retry_wait`.
- stuck recovery не трогает статьи с живым lease.

## 5. Monitoring и alerts

- Есть source health alert при реальной деградации high-priority source.
- Есть backlog alert при превышении agreed threshold.
- Есть provider-level alert при spike `429/5xx`.
- Одинаковые alerts не спамят admin chat на каждом запуске.

## 6. Publish verify и visibility gate

- Статья не считается fully public, пока не стала `verified_live=true`.
- Успешная verify переводит статью в `publish_status='live'`.
- Неуспешная verify переводит статью в `verification_failed` и пишет alert.
- Публичные чтения сайта используют тот же gate, что и Telegram.

## 7. Telegram

- `digest_runs` продолжает использоваться как единый журнал запусков.
- В digest попадают только verified-live статьи.
- Если статей ниже порога, админ получает alert, а не молчаливый success.
- `FORCE_DIGEST` остаётся аварийной опцией и не ломает журналирование.

## 8. Smoke tests перед приёмкой

- `npm run ingest` завершает run и пишет logs.
- `npm run enrich` берёт статьи через claim, а не по `enriched=false`.
- retry-worker подбирает только готовые к retry записи.
- publish-verify подтверждает live URL хотя бы на тестовом наборе недавно опубликованных статей.
- Telegram digest не выбирает статью с `verified_live=false`.

## 9. Operational definition of done

- `scripts/wait-and-reenrich.sh` больше не нужен для ежедневной эксплуатации.
- по любой проблемной статье можно ответить: что случилось, на каком этапе, сколько было попыток и почему она не вышла
- по любому дню можно быстро увидеть, где просел контур: sources, enrich, verify или Telegram

