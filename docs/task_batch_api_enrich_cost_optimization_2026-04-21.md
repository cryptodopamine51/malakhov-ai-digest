# Задача: перевод enrich на Anthropic Batch API

Дата: 2026-04-21
Статус: planned
Приоритет: high
Связанный execution plan: `docs/execution_plan_batch_api_enrich_cost_optimization_2026-04-21.md`

## Контекст

Текущий enrich вызывает Anthropic синхронно по одной статье через `messages.create`.
По фактическим логам `enrich_runs` расход уже близок к лимиту `$1/day`.

Наблюдения на 2026-04-21:
- к `10:48 MSK` дневной расход Claude уже составил около `$0.4474`;
- средний cost на одну article claim с логируемыми токенами — около `$0.043`;
- средний cost на одну успешно выпущенную статью — около `$0.050`;
- статьи по качеству пользователя устраивают, поэтому output contract и длину текста сейчас не режем.

## Цель

Снизить стоимость enrich без ухудшения текущего editorial quality за счёт перевода этапа генерации на Anthropic Batch API.

## Ожидаемый эффект

- уменьшить стоимость Claude примерно в 2 раза относительно текущего synchronous flow;
- сохранить тот же prompt, модель и формат editorial output;
- не ломать текущие статусы pipeline и public gate;
- удержать реальный дневной расход ближе к безопасному диапазону ниже `$1/day`.

## Обязательные уточнения для реализации

Чтобы задача была выполнена без скрытых operational дыр, ниже фиксируются решения,
которые считаются частью этой задачи, а не “деталями на месте”.

### 0. Источник истины для batch lifecycle

Принятое решение:

- не расширять текущий `articles.enrich_status` batch-специфичными значениями;
- сохранить `articles.enrich_status` как coarse pipeline state:
  - `pending`
  - `processing`
  - `retry_wait`
  - `enriched_ok`
  - `rejected`
  - `failed`
  - `stuck`
- source of truth для batch orchestration сделать в новых batch-таблицах;
- operational batch-state уровня item хранить в `anthropic_batch_items.status`.

Почему так:

- текущие SQL constraints и runtime уже завязаны на существующий enum `enrich_status`;
- `retry-failed`, `recover-stuck`, `claimBatch`, `publish-verify` и типы в TS уже
  используют текущую модель состояний;
- отдельный batch lifecycle проще сделать прозрачным и не ломать существующую
  pipeline semantics.

### 0.1 Ownership между submit и collect

Нужно зафиксировать ownership статьи по фазам:

1. `submit`-worker claim-ит статью стандартным lease-механизмом.
2. Пока готовится payload и создаётся provider batch, статья остаётся под claim.
3. После успешного `batch create` claim статьи должен быть снят.
4. После снятия claim статья остаётся в `articles.enrich_status='processing'`,
   но дальнейший ownership переходит batch-item записи, а не lease на статье.
5. `collector` не должен использовать article-level lease как источник права на apply;
   он должен работать через item-level idempotency/lock в batch-таблице.

Следствие:

- состояние “ждём результат от Anthropic” не должно зависеть от `lease_expires_at`;
- `recover-stuck.ts` в текущем виде недостаточен для batch-flow;
- нужен отдельный recovery-path для batch items / submitted batches.

### 0.2 Что считается stuck в batch-flow

Нужно явно различать минимум три stuck-сценария:

- статья застряла до `batch create` и всё ещё держит article lease;
- batch создан, но долго не меняет `processing_status`;
- batch завершился, но item/result не был импортирован или применён.

Для каждого сценария нужен отдельный recovery rule и timeout.

## Что должно измениться

### 1. Новый batch-flow для enrich

Нужен новый lifecycle вместо прямого `messages.create` на каждую статью:

1. выбрать claim-нутые статьи для enrich;
2. подготовить batch requests для Anthropic;
3. создать batch job;
4. сохранить в БД связь `article -> batch request -> batch job`;
5. отдельным polling/import шагом забрать результаты batch job;
6. применить к статье тот же post-processing, что сейчас делает `enricher.ts`:
   - parse JSON;
   - validate editorial output;
   - assign slug;
   - обновить `enrich_status`, `publish_status`, `quality_ok`, `published`, `summary`, `lead`, `editorial_body` и т.д.;
   - записать `article_attempts`;
   - учесть usage/cost.

Дополнительно фиксируется:

- `submit` и `collect/apply` — это разные ownership-зоны и разные failure domains;
- успешный `batch create` ещё не означает, что конкретный item валиден или будет успешен;
- результаты provider могут приходить не в порядке исходных requests;
- матчинг результата к статье делается только через `request_custom_id`.

### 2. Декомпозиция текущего `enricher.ts`

Текущий `pipeline/enricher.ts` надо разделить логически на три фазы:

- `prepare`:
  fetch статьи, scoring, fetch original text, claim/lease, подготовка request payload;

- `submit batch`:
  отправка пачки в Anthropic Batch API;

- `collect/apply`:
  импорт готовых результатов и финальное обновление статусов статьи.

### 3. Новые статусы / observability

Нужны явные operational состояния для batch lifecycle на уровне item. Минимум:

- `queued_for_batch`
- `batch_submitted`
- `batch_processing`
- `batch_result_ready`
- `batch_failed`

Принятое решение:

- эти состояния не добавляются в `articles.enrich_status`;
- они живут в `anthropic_batch_items.status`;
- `articles.enrich_status='processing'` в batch-flow означает:
  “статья находится в enrich pipeline, но финальный apply ещё не завершён”.

Также нужно логировать:
- batch id;
- request count;
- submit time;
- completion time;
- last poll time;
- batch processing status от провайдера;
- item apply status;
- per-article usage;
- total batch cost;
- fail reasons уровня batch и уровня article.

Также нужно видеть отдельно:

- сколько статей сейчас `processing`, но уже без article-level claim;
- сколько items в `batch_result_ready`, но ещё не `applied`;
- сколько items завершились `errored` / `expired` / `canceled`;
- сколько статей ждут retry именно из-за batch-level проблем.

## Изменения в БД

Нужна новая таблица или связка таблиц для batch orchestration.

Минимально:

### `anthropic_batches`

- `id`
- `provider_batch_id`
- `status`
- `processing_status`
- `created_at`
- `submitted_at`
- `finished_at`
- `expires_at`
- `archived_at`
- `results_url`
- `last_polled_at`
- `poll_attempts`
- `request_count`
- `success_count`
- `failed_count`
- `errored_count`
- `expired_count`
- `canceled_count`
- `error_summary`
- `total_input_tokens`
- `total_output_tokens`
- `total_cache_read_tokens`
- `total_cache_creation_tokens`
- `estimated_cost_usd`

### `anthropic_batch_items`

- `id`
- `batch_id`
- `article_id`
- `request_custom_id`
- `status`
- `result_type`
- `error_code`
- `error_message`
- `input_tokens`
- `output_tokens`
- `cache_read_tokens`
- `cache_creation_tokens`
- `estimated_cost_usd`
- `request_payload`
- `response_payload`
- `submitted_at`
- `result_imported_at`
- `applied_at`
- `apply_attempts`
- `last_apply_error`
- `last_apply_error_code`
- `created_at`
- `updated_at`

Допустима другая схема, если сохраняется:
- трассировка от batch к article;
- возможность безопасного retry;
- отсутствие повторной обработки одного и того же batch result.

Обязательные DB-инварианты:

- unique на `anthropic_batches.provider_batch_id`;
- unique на `(batch_id, request_custom_id)`;
- unique или эквивалентная защита от повторного apply одного и того же item result;
- индекс на `anthropic_batch_items(status, updated_at)`;
- индекс на `anthropic_batch_items(article_id, created_at desc)`;
- возможность быстро выбрать:
  - batches для poll;
  - items ready-to-apply;
  - items failed/expired for retry.

Дополнительно:

- если нужен прозрачный operational access без join-магии, допустимо добавить на `articles`
  ссылку на текущий `anthropic_batch_items.id` или current batch marker;
- но source of truth для lifecycle всё равно остаётся в batch-таблицах.

### Идемпотентность apply должна быть закреплена в схеме

Это обязательная часть задачи, не “деталь реализации”.

Нужно гарантировать:

- один и тот же provider result нельзя применить к статье дважды;
- повторный poll/import не создаёт второй `article_attempts` для того же финального apply;
- collector может быть безопасно перезапущен посреди импорта;
- item может находиться в состояниях:
  - result imported, but not applied;
  - applying;
  - applied;
  - apply_failed_retriable;
  - apply_failed_terminal.

Предпочтительный вариант:

- атомарный `apply` через SQL transaction / RPC, где в одной транзакции:
  - помечается item как applying/applied;
  - обновляется статья;
  - пишется `article_attempts`;
  - фиксируется usage/cost.

## Изменения в workflow

Скорее всего понадобятся отдельные workflow:

1. `enrich-submit-batch.yml`
   назначение: собрать кандидатов и отправить batch;

2. `enrich-collect-batch.yml`
   назначение: опрашивать Anthropic Batch API, импортировать готовые результаты.

Опционально:
- `recover-batch-stuck.yml` или включить recovery в existing health workflow.

Для `10/10` реализации cadence тоже должен быть зафиксирован:

- `submit` запускать чаще текущего `enrich`, ориентир: каждые `30` минут;
- `collect` запускать чаще submit, ориентир: каждые `10–15` минут;
- recovery stuck batches/items — минимум каждые `30` минут;
- один submit-run должен иметь верхнюю границу по количеству новых requests, чтобы
  не переполнять provider queue и не создавать uncontrollable cost burst.

Нужно определить run-order:

- либо `collect -> recover -> submit`;
- либо отдельные независимые workflows с понятным SLA и alerting.

Это решение должно быть зафиксировано до начала кодинга.

## Ограничения провайдера, которые нужно учесть в дизайне

Это не опциональная справка, а часть постановки:

- Batch API даёт экономию примерно `50%` относительно стандартного Messages API;
- каждый item должен иметь уникальный `custom_id`;
- результаты не гарантированы в исходном порядке — матчинг только по `custom_id`;
- `batch create` не гарантирует валидность каждого item: часть ошибок может всплыть
  только после завершения batch processing;
- batch может завершиться partial success;
- item может закончиться не только успехом, но и `errored`, `expired`, `canceled`;
- batch имеет provider-side expiration window, поэтому collector нельзя откладывать;
- у Batch API есть собственные queue/rate limits, отдельные от обычного `messages.create`.

## Ограничения

- Не ухудшать текущий editorial quality.
- Не менять текущий prompt contract, если это не требуется самим Batch API.
- Не ломать `publish_ready -> publish-verify -> live`.
- Не допускать повторного применения одного batch result к статье.
- Не допускать ситуации, когда статья навсегда застревает между `processing` и `batch_submitted`.
- Не размножать batch-state одновременно в нескольких равноправных местах без source of truth.
- Не вводить batch-flow, который зависит от long-lived article lease.
- Не считать `batch create success` эквивалентом `article enriched`.

## Основные риски

### 1. Рост latency

Batch API дешевле, но медленнее. Новые статьи могут появляться на сайте позже.

Нужно заранее принять SLA:
- например, не “статья за 5 минут”, а “статья в пределах 1–3 часов”.

### 2. Более сложный recovery

Появляются новые edge cases:
- batch accepted, но item не вернулся;
- batch completed partially;
- duplicate import;
- provider-side failure после submit.

Нужно отдельно закрыть сценарии:

- batch ended, result импортирован, но apply упал на валидации/slug/DB update;
- batch item success, но article уже был повторно обработан другим recovery path;
- collector упал после записи `response_payload`, но до обновления статьи;
- submit создал batch, но локально не успел записать mapping в БД.

### 3. Сложнее дебаг

Синхронный flow понятнее. Batch-flow требует отдельной observability и tooling.

## Acceptance Criteria

- `enrich` больше не вызывает Anthropic синхронно на каждую статью в основном happy path.
- Для новых batch-обработанных статей сохраняются те же editorial поля, что и сейчас.
- `publish_ready` выставляется только после успешного применения batch result.
- Повторный импорт одного и того же batch result не портит статью и не создаёт дубль attempt.
- Есть наблюдаемая стоимость batch jobs в БД.
- На тестовом наборе качество статей визуально не деградирует относительно текущего flow.
- На реальном трафике видно снижение cost/article относительно текущего baseline.
- `articles.enrich_status` остаётся согласован с существующим retry/recovery/public gate контуром.
- Есть явная operational выборка:
  - articles waiting for batch result;
  - batch items ready to apply;
  - batch items failed/expired;
  - batches stuck in polling.
- Duplicate collector run является no-op для уже импортированных и уже applied results.
- Partial batch completion не приводит к потере успешно завершённых items.
- `recover-batch-stuck` или эквивалентный flow умеет вытаскивать статьи из batch limbo.

## Обязательные тесты

Минимальный набор для этой задачи:

- unit test: prepare payload даёт тот же prompt/model/output contract, что current flow;
- unit test: `request_custom_id` детерминированно матчится к статье/attempt;
- integration test: повторный import того же batch result не меняет статью второй раз;
- integration test: повторный collect не создаёт второй `article_attempts`;
- integration test: partial batch success применяет успешные items и не теряет failed items;
- integration test: `expired` / `errored` item уходит в корректный retry/fail path;
- integration test: collector resume после падения между `response_payload` и article update;
- smoke test: статья проходит `submit -> collect/apply -> publish_ready -> publish-verify -> live`;
- smoke test: staging/prod limited rollout на малом объёме с ручным сравнением editorial quality.

## Baseline для сравнения

Текущий baseline перед внедрением:

- cost per claimed article: `~$0.043`
- cost per live article: `~$0.050`
- `2026-04-21` к `10:48 MSK`: `$0.4474`

После внедрения нужно сравнить новый baseline минимум по:
- cost per claimed article;
- cost per enriched_ok;
- cost per live article;
- median time `created_at -> verified_live_at`.

## Рекомендуемый порядок реализации

1. Зафиксировать lifecycle ownership и source of truth для batch-state.
2. Синхронизировать runtime и схему observability, чтобы не строить batch-flow поверх schema mismatch.
3. Добавить batch tables, constraints и migration.
4. Выделить из `enricher.ts` чистую функцию подготовки payload.
5. Реализовать submit step с записью article -> batch item mapping до release article claim.
6. Реализовать collector/import step.
7. Добавить idempotent apply для batch result.
8. Добавить recovery для stuck batches/items и apply-failed items.
9. Добавить cost dashboard/query и operational views для контроля после релиза.
10. Прогнать staging/prod smoke на ограниченном объёме.

## Out of Scope

Сейчас не делаем:
- урезание output contract;
- снижение `MAX_TEXT_LENGTH`;
- topical prefilter;
- смену модели на более дешёвую.

Это отдельные рычаги оптимизации, но не часть данной задачи.
