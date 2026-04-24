# Roadmap: надёжный ежедневный pipeline публикации статей

Дата: 2026-04-20
Проект: `malakhov-ai-digest`
Статус: рабочий черновик для внедрения

---

## 1. Цель

Сделать так, чтобы поиск, валидация, обогащение и публикация статей работали каждый день без ручного вмешательства и без зависания пайплайна на отдельных ошибках.

Итоговое состояние:

- новые статьи стабильно попадают в Supabase;
- enrichment не зависает на лимитах Claude, fetch-ошибках и временных сбоях;
- backlog не накапливается незаметно;
- по каждому этапу есть статус, лог и алерт;
- сайт показывает только корректно опубликованные материалы;
- Telegram-дайджест не уходит в пустоту и не маскирует проблему пайплайна;
- ручной `scripts/wait-and-reenrich.sh` перестаёт быть operational dependency.

---

## 2. Что есть сейчас

Текущий контур:

- `rss-parse.yml` каждые 30 минут запускает `npm run ingest`
- `enrich.yml` каждые 2 часа запускает `npm run enrich`
- `tg-digest.yml` раз в день запускает `npm run tg-digest`
- сайт читает статьи напрямую из Supabase по `published=true AND quality_ok=true`

Текущие сильные стороны:

- ingest и enrich уже разделены;
- есть дедуп по `dedup_hash`;
- сайт не показывает сырые статьи;
- Vercel/Supabase-контур уже живой.

Текущие слабые места:

- временные ошибки не отделены от финального reject;
- нет отдельного retry-контура;
- нет source health monitor;
- нет run-логов по ingest/enrich;
- нет alerting;
- нет защиты от stuck processing;
- нет post-publish verification;
- `scripts/wait-and-reenrich.sh` закрывает сбои вручную, а не системно.

---

## 3. Зачем был нужен `scripts/wait-and-reenrich.sh`

Этот скрипт нужен только как ручная recovery-кнопка.

Он:

- ждёт, пока снова появятся кредиты/доступность Anthropic;
- запускает `scripts/reenrich-all.ts`;
- потом форсит `bot/daily-digest.ts`.

Это не часть нормального ежедневного контура. Если для ежедневной работы нужен такой скрипт, значит не хватает автоматического retry, мониторинга и статусов обработки.

Вывод:

- оставить как временный ops-helper можно;
- считать его решением нельзя;
- после внедрения roadmap ниже он должен стать запасным инструментом, а не рабочей нормой.

---

## 4. Как должен выглядеть целевой pipeline

### 4.1 Этапы

1. Source discovery / fetch
2. Feed parsing / item normalization
3. Deduplication
4. Raw ingest в БД
5. Claim статьи в enrichment worker
6. Fetch full content
7. Score / editorial enrichment
8. Persist результата
9. Publish eligibility check
10. Live verification
11. Попадание в сайт / sitemap / Telegram
12. Monitoring / alerts / retries

### 4.2 Ключевой принцип

Любой шаг должен заканчиваться одним из статусов:

- `success`
- `retryable_error`
- `permanent_reject`
- `stuck`

Сейчас часть этих исходов смешана в `quality_ok=false` или `enriched=true`, из-за чего трудно понять, что реально сломалось.

---

## 5. Что добавить в Supabase

### 5.1 Новые поля в `articles`

Добавить в таблицу `articles`:

- `ingest_status text default 'ingested'`
- `enrich_status text default 'pending'`
- `publish_status text default 'draft'`
- `first_seen_at timestamptz default now()`
- `last_seen_at timestamptz default now()`
- `discover_count int default 1`
- `attempt_count int default 0`
- `processing_started_at timestamptz`
- `processing_finished_at timestamptz`
- `processing_by text`
- `claim_token uuid`
- `lease_expires_at timestamptz`
- `last_error text`
- `last_error_code text`
- `next_retry_at timestamptz`
- `publish_ready_at timestamptz`
- `verified_live boolean`
- `verified_live_at timestamptz`
- `live_check_error text`

Рекомендуемые значения:

- `ingest_status`: `ingested`, `ingest_failed`
- `enrich_status`: `pending`, `processing`, `retry_wait`, `enriched_ok`, `rejected`, `failed`, `stuck`
- `publish_status`: `draft`, `publish_ready`, `verifying`, `live`, `verification_failed`, `withdrawn`

Важное уточнение:

- `duplicate_skipped` не должен жить в `articles`, потому что дубль обычно не создаёт новую строку;
- для дублей лучше обновлять у существующей статьи `last_seen_at` и `discover_count`;
- счётчики duplicate/new/fail должны жить в `source_runs` и `ingest_runs`.

### 5.2 Целевая state machine

Нужно зафиксировать разрешённые переходы состояний, чтобы не плодить невозможные комбинации.

Базовая логика:

- новая статья после ingest: `ingest_status='ingested'`, `enrich_status='pending'`, `publish_status='draft'`
- worker успешно взял статью: `enrich_status='processing'`
- enrichment успешно закончен и статья годна: `enrich_status='enriched_ok'`, `publish_status='publish_ready'`
- enrichment закончен и статья не годна по контенту: `enrich_status='rejected'`, `publish_status='draft'`
- enrichment временно упал: `enrich_status='retry_wait'`, `next_retry_at=...`
- enrichment окончательно сломан после лимита попыток: `enrich_status='failed'`
- зависшая обработка: `enrich_status='stuck'`, затем recovery переводит в `retry_wait`
- live verification начат: `publish_status='verifying'`
- live verification успешен: `publish_status='live'`, `verified_live=true`
- live verification неуспешен: `publish_status='verification_failed'`, `verified_live=false`

Принцип:

- `enrich_status` отвечает только за обработку статьи;
- `publish_status` отвечает только за вывод наружу;
- `published`, `enriched`, `quality_ok` остаются как совместимые legacy-флаги на переходный период, но не как единственный источник правды.

### 5.3 Run-лог таблицы

#### `ingest_runs`

Один лог на запуск ingest.

Поля:

- `id uuid`
- `started_at timestamptz`
- `finished_at timestamptz`
- `status text`
- `feeds_total int`
- `feeds_failed int`
- `items_seen int`
- `items_inserted int`
- `items_duplicates int`
- `items_failed int`
- `error_summary text`

#### `enrich_runs`

Поля:

- `id uuid`
- `started_at timestamptz`
- `finished_at timestamptz`
- `status text`
- `batch_size int`
- `articles_claimed int`
- `articles_enriched_ok int`
- `articles_rejected int`
- `articles_retryable int`
- `articles_failed int`
- `oldest_pending_age_minutes int`
- `error_summary text`

#### `source_runs`

Один лог на источник в каждом fetch-цикле.

Поля:

- `id uuid`
- `ingest_run_id uuid`
- `source_name text`
- `started_at timestamptz`
- `finished_at timestamptz`
- `status text`
- `items_seen int`
- `items_new int`
- `items_duplicates int`
- `http_status int`
- `error_message text`
- `response_time_ms int`

### 5.4 Таблица `pipeline_alerts`

Простого списка alerts мало. Нужна дедупликация и lifecycle.

Поля:

- `id uuid`
- `alert_type text`
- `severity text`
- `status text default 'open'`
- `entity_key text`
- `dedupe_key text`
- `message text`
- `payload jsonb`
- `occurrence_count int default 1`
- `first_seen_at timestamptz`
- `last_seen_at timestamptz`
- `cooldown_until timestamptz`
- `created_at timestamptz`
- `resolved_at timestamptz`

Примеры `alert_type`:

- `source_silent`
- `source_failing`
- `enrich_backlog_high`
- `enrich_zero_publish`
- `llm_provider_error_spike`
- `provider_circuit_open`
- `live_verification_failed`
- `digest_low_articles`

### 5.5 Таблица `article_attempts`

Одних полей `last_error` и `attempt_count` мало. Для нормальной диагностики нужна история попыток.

Поля:

- `id uuid`
- `article_id uuid`
- `stage text`
- `attempt_no int`
- `worker_id text`
- `claim_token uuid`
- `started_at timestamptz`
- `finished_at timestamptz`
- `duration_ms int`
- `result_status text`
- `error_code text`
- `error_message text`
- `payload jsonb`

Назначение:

- расследование инцидентов;
- статистика по retryable/permanent причинам;
- понимание, где именно ломается pipeline на реальных данных.

### 5.6 Индексы и ограничения

Нужно сразу заложить индексы под новую operational-логику:

- partial index на очередь enrichment: `(enrich_status, next_retry_at, created_at)` для `pending` и `retry_wait`
- index на зависшие lease: `(enrich_status, lease_expires_at)`
- index на public-выборки: `(published, quality_ok, verified_live, created_at desc)`
- index на `source_runs(source_name, started_at desc)`
- unique index на `slug`, если его ещё нет как уникального ограничения
- check constraints на допустимые значения `ingest_status`, `enrich_status`, `publish_status`

### 5.7 Совместимость и миграция

Этот пункт критичен. Новый status-layer нельзя включать без плана перехода, потому что текущее приложение читает `published=true AND quality_ok=true`.

Нужно делать так:

1. Добавить новые поля и таблицы без изменения текущих чтений.
2. Включить dual-write в `ingest.ts` и `enricher.ts`: писать и legacy-флаги, и новые статусы.
3. Выполнить backfill старых записей.
4. Только потом перевести сайт/бота на новые правила публикации.

Рекомендуемый backfill:

- `enriched=false` -> `enrich_status='pending'`
- `published=true AND quality_ok=true` -> `enrich_status='enriched_ok'`, `publish_status='live'`
- `quality_reason in ('low_score', 'quality_reject')` -> `enrich_status='rejected'`
- `quality_reason in ('editorial_parse_failed', 'unhandled_error')` -> `enrich_status='failed'`
- legacy-публикациям проставить `verified_live=null`, потом прогнать отдельный verify-backfill

Важное решение до кода:

- для текущего репо practical-путь такой: сначала оставить `published` совместимым флагом, потом перевести публичные выборки на `verified_live=true`;
- если захочется делать `published=true` только после verification, для этого понадобится отдельный preview/internal-check путь, иначе live URL нечем будет проверять.

### 5.8 Публичный visibility gate

Нужно явно определить, когда статья считается видимой наружу.

Целевое правило:

- статья может участвовать в лентах сайта, sitemap и Telegram только если `quality_ok=true`, `published=true`, `verified_live=true`, `publish_status='live'`

Практический путь для текущего кода:

- сначала завести SQL view `public_articles`
- постепенно перевести сайт, sitemap, Telegram и image-jobs читать именно её
- после этого `published=true` перестанет означать “всё готово”, а станет одним из этапов

---

## 6. Какие модули добавить в код

### 6.1 `pipeline/source-health.ts`

Назначение:

- проверять, что каждый источник реально отвечает;
- писать `source_runs`;
- определять молчащие или деградировавшие источники;
- учитывать cadence источника, а не только глобальные пороги.

Что должен считать:

- сколько часов прошло с последнего успешного fetch;
- сколько запусков подряд источник падает;
- сколько новых items источник дал за 24 часа;
- насколько текущее молчание отклоняется от его обычной частоты.

Когда алертить:

- 3 подряд fetch-error;
- отсутствие новых items дольше, чем `expected_interval * multiplier` для этого source;
- 24+ часа полной тишины у high-priority источника.

### 6.2 `pipeline/retry-failed.ts`

Назначение:

- подбирать статьи со статусом `retry_wait`;
- повторно запускать enrichment только для retryable ошибок;
- уважать `next_retry_at`;
- не брать статьи, у которых активен чужой lease.

Retryable причины:

- `llm_rate_limited`
- `provider_5xx`
- `fetch_timeout`
- `transient_network_error`
- `source_unavailable`
- `editorial_parse_failed` только первые N раз, если есть шанс на transient-output

Не retryable:

- `low_score`
- `quality_reject`
- пустой/битый контент после нескольких попыток
- невалидный URL или permanently broken source page

Backoff:

- 1-я попытка: +15 минут
- 2-я: +1 час
- 3-я: +4 часа
- 4-я: +12 часов
- дальше `failed`

### 6.3 `pipeline/recover-stuck.ts`

Назначение:

- искать статьи, зависшие в `processing`;
- переводить просроченные lease из `processing` в `stuck`;
- потом переводить их в `retry_wait`.

Порог:

- если статья в `processing` > 45 минут или `lease_expires_at < now()`, считать stuck

### 6.4 `pipeline/publish-verify.ts`

Назначение:

- проверять статьи в `publish_ready` или уже `published`, в зависимости от выбранной visibility-strategy;
- подтверждать, что материал реально виден и не битый.

Что проверять:

- `HEAD` или `GET /articles/{slug}` = `200`
- URL присутствует в `sitemap.xml`
- canonical и базовые meta не пустые
- страница не отдаёт fallback/404-шаблон

Если не прошло:

- `publish_status='verification_failed'`
- `verified_live=false`
- сохранить `live_check_error`
- создать dedup-alert

Если прошло:

- `publish_status='live'`
- `verified_live=true`
- `verified_live_at=now()`

### 6.5 `pipeline/backlog-monitor.ts`

Назначение:

- считать backlog и throughput;
- выявлять деградацию по age и error-rate, а не только по абсолютным числам.

Метрики:

- `pending_count`
- `retry_wait_count`
- `failed_count`
- `stuck_count`
- oldest pending age
- oldest retry_wait age
- live verified last 24h
- rejected last 24h
- retryable error rate last 24h

### 6.6 `pipeline/alerts.ts`

Назначение:

- единый helper для записи alerts;
- дедуплицировать одинаковые события;
- эскалировать только при повторении или превышении порога;
- опционально отправлять в Telegram admin chat.

Каналы:

- запись в `pipeline_alerts`
- Telegram admin

### 6.7 `pipeline/provider-guard.ts`

Нужен отдельный guard для LLM-провайдера.

Что делает:

- считает rate limit / 5xx по окну времени;
- открывает circuit breaker при spike ошибок;
- на время cooldown не даёт claim'ить слишком много новых статей;
- пишет provider-level alert, а не только article-level ошибки.

Зачем:

- чтобы частые workflow не усиливали outage Anthropic;
- чтобы retry не превращался в self-DDoS по провайдеру.

---

## 7. Какие workflow обновить

Общий принцип для всех workflow:

- задать `concurrency`, чтобы одинаковые job не накладывались бесконтрольно;
- ограничить `timeout-minutes`;
- всегда писать run-log даже при частичном фейле;
- критические оповещения отправлять только после дедупликации.

### 7.1 `rss-parse.yml`

Оставить каждые 30 минут, но добавить:

- запись `ingest_runs`
- source-level logging
- частичный success, если упали не все источники
- alert только при полном провале job или деградации high-priority sources

### 7.2 `enrich.yml`

Изменить:

- запуск чаще, например каждые 30 минут вместо раз в 2 часа;
- внутри ограничивать batch size и provider budget;
- использовать claim/lease, а не `select enriched=false`;
- писать `enrich_runs`;
- включить concurrency guard.

Причина:

- маленькие, частые батчи лучше переживают временные сбои;
- backlog снижается быстрее;
- менее болезненно, если один запуск упал.

### 7.3 Новый workflow `retry-failed.yml`

Запуск:

- каждые 30 минут

Задача:

- запускать `pipeline/retry-failed.ts`

### 7.4 Новый workflow `pipeline-health.yml`

Запуск:

- каждый час

Задача:

- `source-health.ts`
- `backlog-monitor.ts`
- `recover-stuck.ts`
- `provider-guard.ts`

### 7.5 Новый workflow `publish-verify.yml`

Варианты:

- hourly batch verify последних `publish_ready`/recently published статей;
- либо verify после деплоя сайта.

Предпочтительно:

- hourly batch verify, чтобы не дублировать сетевые проверки в hot path;
- если будут ложные 404 из-за лага деплоя, добавить небольшой grace period между publish и verify.

---

## 8. Что поменять в `pipeline/enricher.ts`

### 8.1 Ввести atomic claim/lease

Сейчас worker просто выбирает `enriched=false`.

Проблема:

- при наложении запусков две джобы могут взять один и тот же набор.

Что нужно:

- claim делать атомарно на стороне БД;
- claim должен возвращать только реально захваченные строки;
- при claim записывать `processing_by`, `claim_token`, `processing_started_at`, `lease_expires_at`

Практическая реализация:

- либо SQL `update ... where id in (...) and enrich_status in (...) returning *`
- либо RPC-функция Supabase вида `claim_articles_for_enrichment(worker_id, batch_size)`

### 8.2 Развести reject, retry и provider outage

Нужно разделить:

- `low_score` -> permanent reject
- `quality_reject` -> permanent reject
- `editorial_parse_failed` -> retryable первые N раз, потом permanent
- `fetch_timeout` -> retryable
- `llm_rate_limited` -> retryable + учёт в provider guard
- `provider_5xx` -> retryable + provider alert
- `unhandled_error` -> не сразу reject, а `retry_wait` первые попытки, потом `failed`

### 8.3 Увеличить прозрачность логирования

По каждой статье фиксировать:

- статус до обработки
- статус после обработки
- причина retry/reject
- номер попытки
- длительность обработки
- worker id
- claim token

### 8.4 Схема записи success-path

Для хорошей статьи pipeline должен делать так:

1. `enrich_status='processing'`
2. после успешного editorial: `quality_ok=true`, `enrich_status='enriched_ok'`
3. `publish_status='publish_ready'`
4. legacy-флаг `enriched=true`
5. перевод в `published=true` и `verified_live=true` только по выбранной visibility-strategy

### 8.5 Не терять контекст ошибки

Нельзя каждый раз затирать всё в `quality_reason='unhandled_error'`.

Нужно:

- отделить `quality_reason` как editorial/business outcome
- от `last_error_code`/`last_error` как operational outcome

---

## 9. Что поменять в `pipeline/ingest.ts`

### 9.1 Логировать по каждому источнику отдельно

Сейчас итоговый отчёт общий. Нужно хранить:

- source success/fail
- response time
- число новых items
- число duplicate items
- число items, отфильтрованных policy-правилами

### 9.2 Канонизировать URL и усилить дедуп

Текущий dedup на “нормализованный title + длина URL” слишком слабый для production.

Нужно:

- canonicalize URL перед дедупом
- строить hash хотя бы от `normalized_title + canonical_host + canonical_path`
- желательно перейти на SHA-256/MD5, а не на эвристику длины строки

### 9.3 Ввести source degradation policy

Если источник 3+ раза подряд не отвечает:

- не ломать весь ingest job;
- поднимать alert;
- продолжать парсить остальные источники;
- для high-priority sources помечать это как отдельный operational риск.

### 9.4 Отдельно считать “источник жив, но пуст”

Пустой результат и техническая ошибка — это разные состояния.

### 9.5 Обновлять duplicate-сигналы у существующей статьи

Если статья уже есть:

- не создавать новую строку;
- обновить `last_seen_at`
- увеличить `discover_count`

Это поможет отличать реально умерший source от source, который крутит одни и те же ссылки.

---

## 10. Что предусмотреть для discovery новых статей

Сейчас discovery почти полностью RSS-driven. Для устойчивости этого недостаточно.

Нужно предусмотреть второй контур:

- fallback scraper/listing parser для важных источников без нормального RSS;
- manual allowlist критичных источников;
- keyword-filter policy per source;
- cadence/priority policy per source;
- periodic review неработающих feed endpoints.

Минимальный приоритетный набор:

- восстановить/заменить broken feeds (`Axios Pro Rata`, `a16z`, части `vc.ru`);
- для ключевых официальных блогов хранить fallback listing parser;
- держать health-таблицу по всем источникам;
- завести quarantine policy для источников, которые шумят дублями или системно ломаются.

---

## 11. Что предусмотреть для валидации статей

### 11.1 До LLM

Нужны deterministic checks:

- title не пустой
- URL валиден и канонизирован
- публикация свежая
- текст страницы не пустой
- не дубль
- источник активен
- HTML/markdown очищен до безопасного и предсказуемого текста

### 11.2 После LLM

Нужны policy checks:

- есть `ru_title`
- есть `editorial_body`
- `quality_ok` корректно выставлен
- slug сгенерирован
- нет пустых карточек / пустых описаний
- JSON/структура ответа провайдера проходит schema validation

### 11.3 После публикации

Нужны live checks:

- URL живой
- статья видна в публичном контуре
- страница статьи не 404
- canonical/meta не пустые
- sitemap обновился

---

## 12. Что предусмотреть для Telegram

Telegram не должен быть единственным индикатором, что всё ок.

Нужно:

- перед daily send проверять, что за последние 24 часа опубликовано не меньше порога;
- для выбора использовать только `verified_live=true`;
- если опубликовано слишком мало, слать admin alert;
- логировать причину, если дайджест не отправился.

Важное уточнение:

- `digest_runs` уже есть в репо и это надо использовать, а не заводить вторую parallel-сущность;
- если логов будет не хватать, надо расширить текущую таблицу, а не дублировать её смысл.

Отдельно:

- `FORCE_DIGEST` должен оставаться аварийной опцией, а не регулярным способом эксплуатации.

---

## 13. Минимальный MVP внедрения за 1 вечер

Если делать быстро и с максимальным ROI, порядок такой:

### Фаза A

- добавить поля status/lease/error в `articles`
- добавить `ingest_runs`, `enrich_runs`, `source_runs`, `pipeline_alerts`, `article_attempts`
- внедрить atomic claim/lease в `enricher.ts`
- включить dual-write с legacy-флагами

### Фаза B

- сделать `retry-failed.ts`
- сделать `recover-stuck.ts`
- сделать `alerts.ts` с dedupe
- сделать Telegram admin alert helper

### Фаза C

- сделать `source-health.ts`
- сделать `backlog-monitor.ts`
- сделать `provider-guard.ts`
- добавить workflow `pipeline-health.yml`

### Фаза D

- сделать `publish-verify.ts`
- перевести Telegram на `verified_live=true`
- перевести публичные выборки сайта на `public_articles` или эквивалентный gate

---

## 14. Полный целевой план внедрения

### Этап 1. Сделать пайплайн наблюдаемым

Сделать:

- run tables
- source run logs
- article attempt history
- alerts table с dedupe

Критерий готовности:

- по любому дню видно, сколько статей найдено, сколько обогащено, сколько опубликовано и где именно был сбой.

### Этап 2. Сделать пайплайн устойчивым к временным ошибкам

Сделать:

- retryable statuses
- backoff
- stuck recovery
- atomic claim/lease
- provider circuit breaker

Критерий готовности:

- временный сбой Claude/fetch не требует ручного вмешательства и не порождает гонки воркеров.

### Этап 3. Сделать discovery устойчивым

Сделать:

- source health monitor
- fallback discovery для важных источников
- quarantine policy для источников с деградацией
- stronger dedup/canonicalization

Критерий готовности:

- падение отдельных RSS не ломает весь контур, замечается автоматически и не маскируется дублями.

### Этап 4. Сделать publish-проверку и visibility gate

Сделать:

- post-publish verify
- `verified_live` как часть public gate
- alert на broken live article

Критерий готовности:

- статья считается “нормально опубликованной” только после live verification.

### Этап 5. Сделать Telegram dependent, but not blind

Сделать:

- использовать существующие `digest_runs`
- alert если published today слишком мало
- alert если digest skipped/error
- выборку только из verified-live статей

Критерий готовности:

- Telegram не скрывает проблему сайта, а помогает её заметить.

### Этап 6. Довести миграцию до конца

Сделать:

- перевести все публичные чтения на новый visibility gate
- оставить legacy-флаги как совместимость до стабилизации
- потом убрать из кода прямую зависимость от `enriched=false` и похожих старых условий

Критерий готовности:

- operational truth живёт в status-layer, а legacy-флаги больше не определяют поведение пайплайна.

---

## 15. Какие файлы создать в репо

Рекомендуемый список:

- `pipeline/source-health.ts`
- `pipeline/retry-failed.ts`
- `pipeline/recover-stuck.ts`
- `pipeline/publish-verify.ts`
- `pipeline/backlog-monitor.ts`
- `pipeline/alerts.ts`
- `pipeline/provider-guard.ts`
- `scripts/check-pipeline-health.ts` (опционально, ручной smoke-test)
- `.github/workflows/retry-failed.yml`
- `.github/workflows/pipeline-health.yml`
- `.github/workflows/publish-verify.yml`
- новая миграция в `supabase/migrations/`

Дополнительно:

- SQL view `public_articles`
- возможно, RPC-функция Supabase для atomic claim

---

## 16. Что НЕ стоит делать

- не сваливать временные provider errors в permanent reject;
- не считать `wait-and-reenrich.sh` нормальным способом эксплуатации;
- не делать Telegram единственной проверкой “всё ли вышло”;
- не обогащать статью повторно без atomic claim/lease;
- не держать source monitoring только в голове или по ощущениям;
- не смешивать `quality_reason` и operational error codes;
- не плодить одинаковые alerts без dedupe;
- не включать новый status-layer без migration/backfill плана.

---

## 17. Рекомендуемый следующий practical step

Следующий лучший шаг для этого репо:

1. Сделать миграцию Supabase под status/lease поля, run logs, alert dedupe и `article_attempts`.
2. Обновить `pipeline/enricher.ts` под atomic claim + retryable statuses + dual-write.
3. Добавить `pipeline/retry-failed.ts` и `pipeline/recover-stuck.ts`.
4. Добавить `pipeline-health.yml` с source health, provider guard и Telegram alert в admin chat.
5. После этого заняться `publish-verify.ts` и переводом public-чтений на `verified_live`.

Если делать только один самый полезный спринт, то делать именно это.

---

## 18. Итог

Чтобы статьи “нормально пушились каждый день”, нужен не ещё один ручной shell-script, а полноценный устойчивый operational layer:

- наблюдаемость,
- state machine,
- atomic claim/lease,
- retry и circuit breaker,
- health monitoring,
- alert dedupe,
- post-publish verification,
- visibility gate,
- защита от stuck jobs,
- fallback для discovery,
- совместимый план миграции.

После этого `scripts/wait-and-reenrich.sh` остаётся как запасной инструмент, но перестаёт быть частью нормальной эксплуатации проекта.
