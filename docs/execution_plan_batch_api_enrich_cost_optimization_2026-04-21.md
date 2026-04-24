# Execution Plan: Anthropic Batch Enrich Cost Optimization

Дата: 2026-04-21
Статус: planned
Связанный документ: `docs/task_batch_api_enrich_cost_optimization_2026-04-21.md`

## Цель плана

Разложить внедрение Anthropic Batch API по реальным файлам репозитория так, чтобы:

- не ломать текущий pipeline reliability contour;
- не потерять idempotency на `collect/apply`;
- не строить batch-flow поверх long-lived article lease;
- получить понятный порядок реализации, тестов и релиза.

## Целевая архитектура

### Coarse article state

`articles.enrich_status` остаётся coarse pipeline state и не получает batch-specific значений:

- `pending`
- `processing`
- `retry_wait`
- `enriched_ok`
- `rejected`
- `failed`
- `stuck`

Смысл:

- `pending`: статья ещё не взята в enrich;
- `processing`: статья уже в enrich pipeline, но финальный outcome ещё не применён;
- `retry_wait`: нужен повторный enrich-path;
- terminal states: `enriched_ok`, `rejected`, `failed`.

### Source of truth для batch lifecycle

Batch lifecycle живёт в новых таблицах:

- `anthropic_batches`
- `anthropic_batch_items`

Item-level state:

- `queued_for_batch`
- `batch_submitted`
- `batch_processing`
- `batch_result_ready`
- `applying`
- `applied`
- `batch_failed`
- `apply_failed_retriable`
- `apply_failed_terminal`

### Ownership model

`submit`:

- claim-ит статью через текущий article lease;
- fetch/score/build payload;
- создаёт `anthropic_batch_items`;
- создаёт provider batch;
- пишет mapping `article -> batch item -> provider batch`;
- снимает article claim;
- оставляет `articles.enrich_status='processing'`.

`collect`:

- poll-ит provider batch;
- импортирует results в `anthropic_batch_items`;
- atomically apply-ит item result к статье;
- только после apply меняет статью в terminal state или `publish_ready`.

Следствие:

- ожидание batch result не зависит от `articles.lease_expires_at`;
- `recover-stuck.ts` закрывает только pre-submit lease problems;
- для post-submit нужен отдельный recovery script.

## Изменения по файлам

### 1. База данных и типы

#### `supabase/migrations/006_anthropic_batch_enrich.sql`

Новая миграция должна:

- создать `anthropic_batches`;
- создать `anthropic_batch_items`;
- добавить FK и unique/index constraints;
- при необходимости добавить `batch_item_id` в `article_attempts`;
- добавить RPC-функции для idempotent apply;
- добавить operational views для batch backlog.

Рекомендуемый состав миграции:

1. `anthropic_batches`
2. `anthropic_batch_items`
3. `alter table article_attempts add column if not exists batch_item_id uuid references anthropic_batch_items(id) on delete set null`
4. `create unique index if not exists idx_article_attempts_stage_batch_item_unique on article_attempts(stage, batch_item_id) where batch_item_id is not null`
5. `create index if not exists idx_batch_items_status_updated on anthropic_batch_items(status, updated_at desc)`
6. `create index if not exists idx_batch_items_article_created on anthropic_batch_items(article_id, created_at desc)`
7. `create index if not exists idx_batches_processing_status on anthropic_batches(processing_status, last_polled_at)`
8. RPC `apply_anthropic_batch_item_result(...)`
9. View `batch_enrich_operational_state`

Почему нужен RPC:

- в текущем Node runtime используется `supabase-js`;
- у него нет удобной app-side SQL transaction orchestration;
- apply должен атомарно обновлять item, article и `article_attempts`.

Минимум, что делает `apply_anthropic_batch_item_result(...)`:

- лочит `anthropic_batch_items` по `id`;
- если item уже `applied`, возвращает no-op;
- если item ещё не imported-ready, отклоняет apply;
- обновляет `articles`;
- вставляет запись в `article_attempts` с `batch_item_id`;
- помечает item как `applied` и ставит `applied_at`;
- возвращает applied/no-op/error.

#### Семантика attempts и retry accounting

Этот пункт должен быть зафиксирован в схеме и runtime, иначе batch-flow разойдётся с текущими
`retry-failed.ts`, `provider-guard.ts` и operational метриками.

Правило:

- `articles.attempt_count` остаётся coarse счётчиком enrich-attempts уровня статьи;
- `article_attempts` остаётся audit log для всех terminal/retryable enrich outcomes;
- `stage='enrich'` сохраняется и для batch-flow, чтобы не ломать текущие выборки guard/alerts;
- `article_attempts.batch_item_id` используется как idempotency anchor для apply-originated attempts.

Когда увеличивать `attempt_count`:

- submit/fetch/scoring failure до provider batch create: да;
- `low_score` reject до batch submit: нет;
- provider item `errored` / `expired` / `canceled`, если статья уходит в retry/fail: да;
- successful apply с `enriched_ok` или `rejected`: нет;
- повторный collect/apply no-op: нет;
- interrupted apply resume того же item: нет.

Когда писать `article_attempts`:

- `low_score` reject до batch submit пишет обычный enrich-attempt без `batch_item_id`;
- submit-level retry/fail до provider batch create пишет обычный enrich-attempt без `batch_item_id`;
- terminal/retryable outcome конкретного batch item пишет enrich-attempt с `batch_item_id`;
- повторная обработка уже terminal item не пишет второй attempt.

Следствие:

- `retry-failed.ts` продолжает принимать решение по `articles.enrich_status`, `attempt_count` и `next_retry_at`;
- `provider-guard.ts` должен видеть и legacy sync attempts, и batch-originated enrich attempts в одной плоскости;
- duplicate import/apply не должен менять ни `attempt_count`, ни `attempt_no`.

#### `lib/supabase.ts`

Нужно обновить типы:

- добавить интерфейсы `AnthropicBatch`, `AnthropicBatchItem`;
- расширить `ArticleAttempt` полем `batch_item_id`;
- не менять `EnrichStatus`;
- при необходимости добавить helper-типы для item status/result type.

#### `supabase/schema.sql`

Файл legacy-only. Менять только если есть требование держать старый Supabase snapshot в документационном паритете.

Рекомендуемое решение:

- не считать этот файл source of truth;
- при желании добавить короткий комментарий, что batch enrich описан только в migration-layer.

### 2. Prompt и provider adapter

#### `pipeline/claude.ts`

Этот файл нужно не выбрасывать, а разрезать на reusable pieces:

- вынести pure builder:
  - `buildEditorialSystemPrompt()`
  - `buildEditorialUserMessage(...)`
- вынести parse/validate:
  - `parseEditorialJson(...)`
  - `validateEditorial(...)`
- сохранить synchronous call как fallback/helper:
  - `generateEditorialSync(...)`

Зачем:

- `submit` должен переиспользовать тот же prompt/model/input contract;
- `collect` должен переиспользовать тот же parse/validate;
- batch implementation не должна копировать prompt-логику во второй файл.

#### `pipeline/anthropic-batch.ts`

Новый provider adapter.

Ответственность:

- `createEditorialBatch(requests)`
- `retrieveBatch(batchId)`
- `streamBatchResults(batchId)` или `listBatchResults(batchId)`
- mapping provider response -> internal normalized shape

В этом файле держать:

- создание `custom_id`;
- сериализацию `params` для batch item;
- нормализацию provider statuses:
  - `succeeded`
  - `errored`
  - `expired`
  - `canceled`
- usage extraction из successful result.

Не держать здесь:

- article update;
- slug generation;
- `article_attempts`;
- retry policy.

Дополнительно зафиксировать:

- batch adapter принимает явный `maxRequestsPerBatch`;
- submit script режет кандидатов на provider-compatible chunks до вызова `createEditorialBatch(...)`;
- лимит должен быть configurable через runtime env/const, а не зашит только в workflow cron;
- при превышении локального лимита лишние статьи остаются не-claim-нутыми или возвращаются в очередь до следующего run.

### 3. Submit path

#### `pipeline/enrich-submit-batch.ts`

Новый основной runtime script для submit.

Ответственность:

- выбрать кандидатов через текущий claim flow;
- fetch original text;
- посчитать score;
- early-reject `low_score` без batch submit;
- построить payload для batch items;
- записать `anthropic_batch_items` в состоянии `queued_for_batch`;
- создать provider batch;
- записать `anthropic_batches` и привязать items;
- снять article lease и оставить статью в `processing`.

Логика ошибок:

- если batch create не удался до release claim, статья уходит в `retry_wait` или `failed` по текущей retry policy;
- если часть статей не прошла fetch/score до batch create, они завершаются отдельно и не должны блокировать submit для остальных;
- если provider batch создан, но локальная запись mapping не завершена, это P0 inconsistency и должна подниматься как alert.

#### `pipeline/enricher.ts`

Не держать здесь новую основную бизнес-логику.

Предпочтительный вариант:

- превратить в thin compatibility wrapper вокруг `enrich-submit-batch.ts`;
- оставить название `npm run enrich` рабочим, но фактически запускать submit-batch flow;
- synchronous per-article enrich из happy path убрать.

### 4. Collect/apply path

#### `pipeline/enrich-collect-batch.ts`

Новый runtime script для collect.

Ответственность:

- выбрать batches в `in_progress`/pending poll;
- забрать provider status;
- если batch ещё не `ended`, обновить polling metadata;
- если batch `ended`, импортировать все item results;
- для successful items вызвать idempotent apply RPC;
- для `errored` / `expired` / `canceled` items выбрать retry или terminal fail path;
- обновить aggregate counters в `anthropic_batches`.

Разделить внутри на три части:

1. `pollBatches()`
2. `importBatchResults()`
3. `applyReadyResults()`

Именно этот файл должен:

- использовать `request_custom_id` как единственный способ матчинга результата;
- быть безопасным к повторному запуску;
- быть безопасным к падению посреди цикла.

Apply path обязан сохранять тот же article contract, что сейчас пишет synchronous `enricher.ts`:

- editorial fields (`ru_title`, `lead`, `summary`, `card_teaser`, `tg_teaser`, `editorial_body`, `glossary`, `link_anchors`);
- `publish_status='publish_ready'` только после successful apply;
- legacy dual-write поля:
  - `enriched=true` для terminal enrich outcome;
  - `published=true` только для quality-approved article;
  - `quality_ok` / `quality_reason` в тех же semantics, что и сейчас.

Это важно, потому что текущие public queries и verify flow всё ещё используют legacy filters вместе с новым status model.

#### `pipeline/slug.ts`

Логику не менять концептуально, но она будет использоваться из collect/apply.

Проверить:

- что `ensureUniqueSlug(...)` безопасно вызывается только в apply path;
- что duplicate apply не доходит до второй slug assignment из-за item-level idempotency.

### 5. Recovery и retry

#### `pipeline/recover-stuck.ts`

Сузить ответственность до pre-submit stuck articles:

- `processing` + active article lease mechanics;
- не трогать статьи, у которых уже есть batch item в non-terminal состоянии;
- не пытаться “лечить” post-submit waiting state.

Иначе этот script начнёт конфликтовать с batch-managed items.

#### `pipeline/retry-failed.ts`

Расширить, чтобы он умел возвращать в `pending` не только текущие retryable статьи,
но и случаи, когда retry инициирован из batch item terminalization.

При этом retry decision должен приниматься не по голой статье, а с учётом последнего batch item outcome.

#### `pipeline/recover-batch-stuck.ts`

Новый script.

Ответственность:

- находить batches, которые слишком долго не меняют `processing_status`;
- находить items в `batch_result_ready` без `applied_at`;
- находить items в `applying`, где apply был прерван;
- переводить items в `apply_failed_retriable` или инициировать повторный apply;
- поднимать alerts на limbo states.

Нужные timeout-классы:

- `submit_stuck_before_provider_batch`
- `provider_batch_poll_stuck`
- `result_imported_not_applied`
- `apply_started_not_finished`

#### Cutover и mixed-state migration

План релиза должен явно учитывать, что на момент внедрения в проде уже могут существовать статьи в старом
`processing`, обработанные legacy sync worker.

Обязательный порядок cutover:

1. временно остановить старый `enrich.yml` cron или перевести его в manual-only режим;
2. дождаться, пока активные legacy article leases истекут или будут обработаны;
3. запустить `recover-stuck.ts` для cleanup только legacy pre-batch `processing` rows;
4. убедиться, что нет статей в `processing` без batch linkage и без активного lease;
5. только после этого включать batch submit/collect workflows.

Если чистый drain невозможен, нужен явный marker разделения legacy/batch ownership:

- либо `current_enrich_mode`;
- либо `current_batch_item_id` на `articles`;
- либо другой однозначный operational marker.

Нельзя выпускать cutover, где новый `recover-stuck.ts` и старый sync worker по-разному интерпретируют один и тот же `processing`.

### 6. Alerts и observability

#### `pipeline/provider-guard.ts`

Расширить метрики:

- добавить batch-specific provider failures;
- отличать synchronous legacy errors от batch errors;
- считать spikes по `anthropic_batch_items.error_code` и apply failures.

#### `pipeline/alerts.ts`

Добавить cooldown types:

- `batch_poll_stuck`
- `batch_apply_stuck`
- `batch_partial_failure_spike`

И привести dedupe key к сущностям:

- batch id;
- article id;
- aggregate queue alert.

#### `docs/` или SQL snippets для dashboard

Добавить operational query pack:

- batches in progress;
- items ready to apply;
- items failed/expired;
- average batch latency;
- cost per item / per enriched_ok / per live article.

Это можно оформить либо отдельным markdown, либо SQL-файлом рядом с migration docs.

#### `enrich_runs` и baseline continuity

Поскольку исходный baseline задачи считается по `enrich_runs`, execution plan должен сохранить
сопоставимость метрик до и после batch rollout.

Рекомендуемое решение:

- не удалять `enrich_runs` в этой волне;
- либо завести `enrich_runs.run_kind in ('sync', 'batch_submit', 'batch_collect')`,
- либо добавить отдельные `batch_submit_runs` / `batch_collect_runs`, но при этом оставить query pack,
  который умеет пересчитать старые и новые метрики в одной системе координат;
- в cost comparison явно определить, откуда берутся:
  - cost per claimed article;
  - cost per enriched_ok;
  - cost per live article.

Нельзя оставлять этот выбор “на месте”, потому что иначе baseline из task doc перестанет быть проверяемым.

### 7. Workflow и scripts

#### `package.json`

Добавить scripts:

- `enrich-submit-batch`
- `enrich-collect-batch`
- `recover-batch-stuck`
- `test:batch-enrich`

Сохранить:

- `enrich` как alias на submit step;
- текущие reliability tests.

#### `.github/workflows/enrich.yml`

Решение:

- либо оставить как compatibility workflow и перевести на `npm run enrich-submit-batch`;
- либо заменить новым `enrich-submit-batch.yml`.

Рекомендация:

- старый `enrich.yml` постепенно вывести из роли “всё делает сам”;
- явные batch workflows читаются и дебажатся лучше.

#### `.github/workflows/enrich-submit-batch.yml`

Новый cron:

- каждые `30` минут;
- `recover-stuck` перед submit только для pre-submit lease cases;
- запуск `npm run enrich-submit-batch`.
- submit run должен иметь верхнюю границу по количеству новых items за один запуск.

#### `.github/workflows/enrich-collect-batch.yml`

Новый cron:

- каждые `10–15` минут;
- запуск `npm run enrich-collect-batch`.

Зафиксировать run order:

- предпочтительно независимые workflows `collect`, `recover-batch-stuck`, `submit`;
- при одновременном срабатывании collector имеет приоритет над submit, чтобы не накапливать backlog готовых результатов;
- submit не должен зависеть от long-running collect job и наоборот.

#### `.github/workflows/recover-batch-stuck.yml`

Новый cron:

- каждые `30` минут;
- запуск `npm run recover-batch-stuck`.

#### `.github/workflows/publish-verify.yml`

Логика verify не меняется по смыслу, но нужно убедиться:

- новые batch-enriched статьи получают `publish_ready` только после apply;
- verify cadence остаётся совместим с более частым появлением `publish_ready`.

### 8. Тесты

#### `tests/node/pipeline-reliability.test.ts`

Подходит для части unit coverage, но для batch-flow станет перегруженным.

Рекомендация:

- оставить здесь базовые tests для claims/types/helpers;
- не запихивать весь batch lifecycle в один файл.

#### `tests/node/batch-enrich.test.ts`

Новый test file.

Покрыть:

- prompt/model/output parity между sync prepare contract и batch payload;
- deterministic `custom_id`;
- import dedupe;
- apply dedupe;
- partial batch success;
- `errored` / `expired` item handling;
- collector resume после падения между `response_payload` persist и article update;
- no-op on repeated collector run.

#### `tests/node/batch-apply-rpc.test.ts` или SQL-level smoke

Если RPC сложно полноценно тестировать в node unit harness, минимум нужен smoke на staging DB.

Нельзя выпускать без проверки:

- один и тот же item не создаёт второй `article_attempts`;
- один и тот же item не меняет статью второй раз;
- interrupted apply resume ведёт к корректному final state.
- есть smoke, где статья проходит `submit -> collect/apply -> publish_ready -> publish-verify -> live`.

## Порядок внедрения

### Wave 1. Schema и pure extraction

Файлы:

- `supabase/migrations/006_anthropic_batch_enrich.sql`
- `lib/supabase.ts`
- `pipeline/claude.ts`

Exit criteria:

- есть batch tables, indexes, RPC;
- semantics `attempt_count` / `article_attempts` зафиксированы и не конфликтуют с текущим retry/guard;
- prompt builder/validator отделены от sync call;
- типы компилируются.

### Wave 2. Submit path

Файлы:

- `pipeline/anthropic-batch.ts`
- `pipeline/enrich-submit-batch.ts`
- `pipeline/enricher.ts`
- `package.json`

Exit criteria:

- статьи успешно доходят до `processing` + batch item linkage;
- batch создаётся у провайдера;
- article lease снимается после submit;
- есть provider-compatible chunking и верхняя граница items per run;
- `low_score` продолжает отклоняться без batch cost.

### Wave 3. Collect/apply path

Файлы:

- `pipeline/enrich-collect-batch.ts`
- `pipeline/slug.ts`
- SQL RPC from migration

Exit criteria:

- successful batch result применяется к статье;
- `publish_ready` появляется только после apply;
- legacy dual-write (`enriched` / `published` / `quality_ok`) сохраняет текущую semantics;
- duplicate collect остаётся no-op.

### Wave 4. Recovery, alerts, workflows

Файлы:

- `pipeline/recover-stuck.ts`
- `pipeline/retry-failed.ts`
- `pipeline/recover-batch-stuck.ts`
- `pipeline/provider-guard.ts`
- `pipeline/alerts.ts`
- `.github/workflows/*.yml`

Exit criteria:

- limbo states восстанавливаются;
- есть alerts на stuck polling/apply;
- cutover не конфликтует со старым `processing` semantics;
- cron cadence соответствует SLA.

### Wave 5. Tests и rollout

Файлы:

- `tests/node/batch-enrich.test.ts`
- `tests/node/pipeline-reliability.test.ts`
- docs/query pack if needed

Exit criteria:

- unit/integration coverage закрывает idempotency и partial failure;
- есть e2e smoke до `publish-verify -> live`;
- staging smoke проходит;
- prod rollout делается на ограниченном объёме.

## Rollout strategy

### Stage 0. Cutover preparation

- перевести legacy sync `enrich.yml` в paused/manual mode;
- дочистить legacy `processing` через existing recovery contour;
- подтвердить, что нет смешанных `processing` rows без понятного ownership marker;
- только после этого включать batch submit/collect crons.

### Stage 1. Dark launch

- submit и collect работают на малом batch size;
- editorial output сравнивается вручную с текущим sync baseline;
- cost фиксируется отдельно по batch tables.

### Stage 2. Partial production

- ограничить количество submit items за run;
- следить за:
  - cost per claimed article;
  - cost per enriched_ok;
  - median `created_at -> publish_ready_at`;
  - median `created_at -> verified_live_at`;
  - percentage of `expired` / `errored` items.

### Stage 3. Remove sync happy path

- после подтверждения качества и стабильности убрать synchronous Claude generation из main path;
- fallback sync вызов оставить только как debug/manual tool, если он действительно нужен.

## Что не делать в этой волне

- не переносить весь enrich/retry/recovery pipeline на новый status model;
- не смешивать batch-state и article-state в одном enum;
- не строить apply как серию разрозненных app-side update calls без transaction boundary;
- не выпускать решение без idempotent `article_attempts` dedupe;
- не опираться на `supabase/schema.sql` как на источник истины для batch design.
