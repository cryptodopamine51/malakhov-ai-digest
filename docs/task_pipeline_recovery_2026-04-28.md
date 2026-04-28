# Task: восстановить публикацию после Anthropic Batch outage

Дата: 2026-04-28

## Контекст

С 25 по 28 апреля новые статьи ingest-ились, но не доходили до `publish_ready` / `live`.
GitHub Actions при этом оставались зелёными, а Telegram digest завершался `success` на уровне
workflow, но внутри писал `Нет новых статей для дайджеста` и создавал
`digest_runs.status='skipped', articles_count=0`.

Проверка Supabase за период с `2026-04-25T00:00:00Z`:

- 102 article errors;
- 100 из них: `invalid_request_error`, `requests.0.custom_id: String should have at most 64 characters`;
- 0 совпадений по `credit`, `balance`, `billing`, `quota`, `insufficient`, `rate_limit`;
- оставшиеся 2 ошибки: fetch timeout.

Вывод: гипотеза про отсутствие денег на Anthropic API не подтверждается логами этого инцидента.
Запросы доходили до Anthropic и падали на валидации тела запроса.

## Root Cause

`pipeline/anthropic-batch.ts::buildBatchCustomId` строит id:

```text
article:<article_uuid>:attempt:<n>:item:<batch_item_uuid>
```

Для реальных UUID длина около 96 символов, а Anthropic Batch API принимает
`custom_id` длиной не более 64 символов.

## Сопутствующие косяки

1. `enrich-submit-batch` может завершиться exit 0 при `Submitted batches: 0`, если все ошибки
   обработаны как retryable/failed на уровне статей.
2. GitHub Actions показывает `success`, хотя публикационный pipeline не произвёл ни одной статьи.
3. `pipeline-health` увидел `error_rate=100%`, но admin Telegram alert упал с HTTP 400.
4. `pipeline/alerts.ts` логирует только статус Telegram API, без response body, поэтому причина 400
   не диагностируется из Actions logs.
5. `provider-guard` не выделяет `invalid_request_error` как отдельный deterministic config bug.
6. У тестов batch lifecycle нет проверки лимита `custom_id <= 64`.
7. Recovery после deterministic batch-submit bug не описан как отдельный runbook.

## Исправления

### 1. Batch custom_id

Файл: `pipeline/anthropic-batch.ts`

Сделать короткий deterministic `custom_id`:

```text
item_<compact-batch-item-uuid>_attempt_<attemptNo>
```

Требования:

- длина всегда `<= 64`;
- charset соответствует Anthropic pattern `^[a-zA-Z0-9_-]{1,64}$`;
- уникальность внутри batch;
- `parseBatchCustomId` продолжает возвращать `attemptNo`, `batchItemId` для новых ids;
- для старого формата parser остаётся backward-compatible, чтобы collector не ломался на уже созданных rows/results.

Практичный вариант: хранить полные UUID в `anthropic_batch_items.request_payload.article_context`
и в самой строке `anthropic_batch_items`, а `custom_id` использовать только как короткий ключ
для матчинга результата к item. Collector может искать item по `request_custom_id`.

### 2. Submit должен fail-fast при нуле provider batches

Файл: `pipeline/enrich-submit-batch.ts`

Если были staged items, но `submittedItems === 0`, процесс должен завершаться non-zero
после записи `enrich_runs` и alert. Исключение допустимо только если все staged items были
переведены в terminal rejected до попытки provider submit.

Acceptance:

- GitHub Actions `enrich.yml` краснеет при deterministic provider validation error;
- `enrich_runs.status` остаётся `failed` / `partial`;
- alert сохраняется в `pipeline_alerts`.

### 3. Error taxonomy

Файлы:

- `pipeline/types.ts`
- `pipeline/enrich-submit-batch.ts`
- `pipeline/provider-guard.ts`

Добавить отдельный код вроде `provider_invalid_request`.

Mapping:

- Anthropic HTTP 400 + `invalid_request_error` => `provider_invalid_request`;
- такой код terminal для текущей попытки, но не должен бесконечно гонять retry без code deploy.

### 4. Provider guard

Файл: `pipeline/provider-guard.ts`

Добавить отдельный critical alert:

- если за окно 2 часа появляется хотя бы один `provider_invalid_request`;
- для массовых `claude_api_error` оставить общий error-rate guard;
- текст alert должен явно говорить, что это provider validation/config bug, а не rate limit.

### 5. Telegram alert diagnostics

Файл: `pipeline/alerts.ts`

При `!res.ok` читать body и логировать безопасный diagnostic:

```text
[alerts] Telegram send failed: 400 <body up to 500 chars>
```

Плюс добавить preflight для `TELEGRAM_ADMIN_CHAT_ID`:

- пустой env => no-op с понятным логом;
- HTTP 400 => body в лог;
- отдельный smoke command/script для отправки тестового admin alert.

### 6. Тесты

Файл: `tests/node/batch-enrich.test.ts`

Добавить:

- `buildBatchCustomId` с двумя UUID возвращает строку `<= 64`;
- parser понимает новый формат;
- parser понимает legacy формат;
- chunk submit с provider validation error приводит к non-zero / thrown error;
- alert logger не теряет Telegram response body.

### 7. Recovery/backfill runbook

Файл: `docs/OPERATIONS.md`

Добавить раздел "Manual editorial backfill":

1. выбрать failed/retry_wait статьи за нужное московское окно;
2. извлечь source text через `pipeline/fetcher.ts`;
3. заполнить editorial fields без Anthropic API;
4. выставить `enrich_status='enriched_ok'`, `publish_status='publish_ready'`, `published=true`,
   `quality_ok=true`, `tg_sent=false`;
5. запустить `npm run publish-verify`;
6. проверить `publish_status='live'`, `verified_live=true`;
7. backdated Telegram digest отправлять только после ручного подтверждения владельца.

## Acceptance Criteria

- `npm run test:batch-enrich` проходит.
- `npm run test:pipeline-reliability` проходит.
- `npm run docs:check` проходит.
- На тестовом `createEditorialBatch` `custom_id.length <= 64`.
- При искусственной 400 validation error workflow падает, а не зелёный.
- Admin alert HTTP 400 показывает body в Actions logs.
- После deploy за 2 часа появляются новые `articles.publish_status='live'`.
- `digest_runs` следующего дня получает `success`, если в окне есть минимум 3 live articles.

## Recovery для текущего инцидента

Сделать ручной backfill за московские дни 2026-04-26 и 2026-04-27:

- 5 статей за 2026-04-26;
- 5 статей за 2026-04-27;
- модель в `editorial_model`: `codex-manual-backfill-2026-04-28`;
- записи в `article_attempts.payload.manual_backfill=true`;
- после `publish-verify` статьи должны стать `live`.

Backdated Telegram отправку не делать автоматически: это production-постинг в канал и требует
отдельного подтверждения.

## Факт восстановления 2026-04-28

- 10 manual backfill статей за 26-27 апреля доведены до `publish_status='live'`,
  `verified_live=true`.
- Отправлены backdated Telegram digest posts за 26 и 27 апреля после подтверждения владельца.
- Одна статья за 26 апреля была отсечена transient HEAD-check перед digest delivery; после
  повторной live-проверки отправлена отдельным recovery-post и помечена `tg_sent=true`.
- Первый production smoke после фикса выявил второе ограничение Anthropic: кроме длины,
  `custom_id` не допускает `:`. Финальный формат заменён на underscore-only.
