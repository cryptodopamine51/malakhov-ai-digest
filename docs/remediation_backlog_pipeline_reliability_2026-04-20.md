# Remediation Backlog: pipeline reliability

**Дата:** 2026-04-20  
**Основание:** аудит реализации относительно `implementation_wave_pipeline_reliability_2026-04-20.md`  
**Цель:** довести волну надёжности pipeline до состояния, когда operational layer реально работает, а не только задекларирован в коде и миграциях.

## 1. Итоговая цель

После выполнения этого backlog должно быть верно:

- enrichment queue безопасна при параллельных воркерах;
- retryable ошибки реально попадают в retry/recovery контур;
- observability-таблицы и runtime совпадают по схеме;
- сайт и Telegram используют один и тот же корректный visibility gate;
- alerts дедуплицируются для source/backlog/provider/verify/digest;
- legacy-данные не получают ложный `verified_live=true` без реальной проверки.

## 2. Приоритеты

### P0 — blockers, без которых волну нельзя считать готовой

1. Починить race на release claim.
2. Развести retryable provider/fetch failures и content rejection.
3. Синхронизировать `enrich_runs` runtime с SQL-схемой.
4. Исправить duplicate-touch: обновлять `discover_count`, а не только `last_seen_at`.
5. Убрать ложный backfill `verified_live=true` для legacy-published.

### P1 — completion items для соответствия acceptance criteria

1. Довести `stuck` flow до реального `processing -> stuck -> retry_wait`.
2. Перевести low-articles digest alert на общий dedupe-слой.
3. Ужесточить public gate до явного `publish_status='live'`.
4. Убрать operational failure buckets из `quality_reason`.

### P2 — hardening и долговечность

1. Добавить тесты на claims/retry/recovery/verify/alerts.
2. Добавить smoke-check сценарии для operational scripts.
3. Уточнить error taxonomy: `claude_rate_limit`, `fetch_timeout`, `fetch_http_error`, `verify_http_error`.
4. Зафиксировать Node runtime для локального smoke-check.

## 3. План доработок

### Этап A. Queue correctness

Цель:
- исключить потерю или порчу результата статьи из-за просроченного worker lease.

Сделать:
- в `pipeline/claims.ts` менять `releaseClaim()` так, чтобы release/update шёл не только по `id`, но и по актуальному `claim_token`;
- передавать в release текущий claim token статьи;
- если release не затронул строку, логировать stale-claim ситуацию как operational warning, но не перетирать запись;
- проверить, что `recover-stuck.ts` не конфликтует с release path.

Файлы:
- `pipeline/claims.ts`
- `pipeline/enricher.ts`
- при необходимости `pipeline/recover-stuck.ts`

Критерий готовности:
- worker с устаревшим lease не может перезаписать статью, уже повторно взятую и завершённую другим worker.

### Этап B. Retry semantics

Цель:
- временные сбои провайдеров и fetch действительно ведут в `retry_wait`, а не в ложный `rejected`.

Сделать:
- привести `pipeline/fetcher.ts` к явному сигналу ошибок вместо “пустой успешный результат”;
- привести `pipeline/claude.ts` к явному различению parse failure, API failure, rate-limit и timeout;
- в `pipeline/enricher.ts` использовать эти сигналы для корректного `last_error_code`;
- исправить `nextRetryAt()` так, чтобы первая retry-пауза соответствовала policy;
- проверить, что `provider-guard.ts` реально видит provider spikes.

Файлы:
- `pipeline/fetcher.ts`
- `pipeline/claude.ts`
- `pipeline/enricher.ts`
- `pipeline/types.ts`
- `pipeline/provider-guard.ts`

Критерий готовности:
- outage Anthropic или HTTP-fetch больше не производит массовый `editorial_parse_failed`/`quality_reject`.

### Этап C. Schema/runtime parity

Цель:
- убрать расхождение между тем, что пишет runtime, и тем, что реально существует в БД.

Сделать:
- либо добавить missing cost/token колонки в `enrich_runs`, либо перестать писать их из runtime;
- проверить все insert/update в новые operational таблицы на фактическое соответствие migration 005;
- отдельно проверить snapshot-документацию по schema, чтобы она не вводила в заблуждение.

Файлы:
- `supabase/migrations/005_pipeline_reliability.sql`
- `pipeline/enricher.ts`
- при необходимости `supabase/schema.sql`

Критерий готовности:
- любой `enrich_runs` update проходит без schema mismatch.

### Этап D. Ingest correctness

Цель:
- duplicate discovery должна накапливать operational signal, а не терять его.

Сделать:
- на duplicate обновлять `last_seen_at`;
- увеличивать `discover_count = discover_count + 1`;
- при желании обновлять `first_seen_at` только при insert, без побочных эффектов;
- убедиться, что source-level counters совпадают с фактическим поведением.

Файлы:
- `pipeline/ingest.ts`
- при необходимости SQL helper/trigger, если выбран DB-side инкремент

Критерий готовности:
- повторное появление одного и того же item увеличивает `discover_count`.

### Этап E. Legacy verify migration

Цель:
- visibility gate не должен доверять legacy publish без реального verify.

Сделать:
- изменить backfill в migration/spec alignment: legacy published получают `publish_status='live'`, но `verified_live` остаётся `null` или `false` до verify-backfill;
- описать и, при необходимости, добавить отдельный verify-backfill runbook для ранее опубликованных статей;
- убедиться, что public reads не ломаются при отсутствии verify на legacy.

Файлы:
- `supabase/migrations/005_pipeline_reliability.sql`
- `docs/spec_pipeline_reliability_migration_2026-04-20.md`
- `pipeline/publish-verify.ts` или отдельный backfill script

Критерий готовности:
- `verified_live=true` означает только реальную проверку доступности.

### Этап F. Visibility gate and digest alerts

Цель:
- сайт, sitemap и Telegram используют одно и то же финальное определение public article;
- digest alerts не спамят.

Сделать:
- во всех public reads добавить `publish_status='live'`;
- проверить, что `publish-verify.ts` действительно ставит этот статус как финальный gate;
- перевести low-articles alert в `pipeline/alerts.ts` через `digest_low_articles`;
- сохранить `digest_runs` как единый run log без дублирования сущностей.

Файлы:
- `lib/articles.ts`
- `bot/daily-digest.ts`
- `pipeline/alerts.ts`

Критерий готовности:
- digest low-articles condition пишет `digest_runs` и шлёт дедуплицируемый alert.

### Этап G. Tests and smoke checks

Цель:
- зафиксировать корректность operational layer регрессионно.

Сделать:
- unit/integration tests на claim contention;
- tests на retry classification;
- tests на recover-stuck с expired vs active lease;
- tests на publish verify transitions;
- tests на alert dedupe;
- smoke-check checklist под Node 20.

Файлы:
- `tests/` под новые operational сценарии
- при необходимости `README.md` или `docs/`

Критерий готовности:
- ключевые state transitions покрыты тестами, а smoke-check воспроизводим локально и в CI.

## 4. Рекомендуемый порядок исполнения

1. Этап A — queue correctness.
2. Этап B — retry semantics.
3. Этап C — schema/runtime parity.
4. Этап D — ingest correctness.
5. Этап E — legacy verify migration.
6. Этап F — visibility gate and digest alerts.
7. Этап G — tests and smoke checks.

## 5. Stop conditions

Нельзя считать задачу закрытой, если остаётся хотя бы одно из ниже:

- release статьи всё ещё возможен без проверки `claim_token`;
- provider outage по-прежнему записывается как content reject;
- `enrich_runs` update не соответствует фактической SQL-схеме;
- duplicate item не увеличивает `discover_count`;
- legacy article получает `verified_live=true` без verify;
- digest low-articles alert идёт мимо dedupe-слоя;
- public reads не требуют `publish_status='live'`.

## 6. Минимальный definition of done для закрытия remediation

- `npm run build` и `npm run lint` проходят под Node 20;
- operational scripts не имеют очевидных schema mismatches;
- сайт и Telegram читают один и тот же public gate;
- retry/recovery контур позволяет пережить временный outage без ручного reenrich;
- ключевые переходы подтверждены тестами или воспроизводимым smoke-check.

## 7. Практический next slice

Если идти коротким безопасным срезом, следующий рабочий PR должен содержать только:

1. fix stale-claim race;
2. fix retry classification для fetch/Claude;
3. fix `enrich_runs` schema mismatch;
4. fix `discover_count` increment;
5. тесты на эти четыре пункта.

Это даст максимальный operational выигрыш при минимальном diff и уберёт самые опасные ложные сигналы в pipeline.
