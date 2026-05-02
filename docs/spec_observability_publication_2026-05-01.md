# Spec: Observability и публикация — закрытие серых зон

**Дата:** 2026-05-01
**Тип:** временная спецификация (после реализации перенести итоги в `docs/OPERATIONS.md` и `docs/ARTICLE_SYSTEM.md`).
**Связанные документы:**
- `docs/file_map_observability_publication_2026-05-01.md`
- `docs/task_breakdown_observability_publication_2026-05-01.md`
- `docs/acceptance_criteria_observability_publication_2026-05-01.md`
- `docs/ORCHESTRATOR_observability_publication_2026-05-01.md`

## Контекст

Аудит pipeline (см. user-сессия 2026-05-01) выявил, что базовый журнал есть (`ingest_runs`, `source_runs`, `enrich_runs`, `article_attempts`, `anthropic_batches`, `anthropic_batch_items`, `llm_usage_logs`, `digest_runs`, `pipeline_alerts`, `source_health`), но имеется **девять конкретных серых зон**, в которых сбой может пройти молча или быть обнаружен слишком поздно. Эта спецификация фиксирует контракт изменений по каждой зоне, чтобы реализация была детерминированной.

## Принципы

1. **Никаких новых silent return.** Любая ветка, выходящая без записи в БД, обязана писать строку в журнал (`*_runs`, `article_attempts`, `pipeline_alerts`).
2. **Алёрт срабатывает раньше, чем замечает digest.** Дайджест — последний рубеж видимости, а не первый.
3. **Источник истины — БД.** `console.*` остаётся вспомогательным выводом для cron-логов, но не заменяет structured-журнал.
4. **Backward-compatible миграции.** Все DDL — `ADD COLUMN ... DEFAULT ... NOT NULL` либо новые таблицы; старые reads не должны ломаться до cutover.
5. **Каждое изменение — с тестом.** Покрытие через `tests/node/*.test.ts` (`tsx --test`).
6. **Atomic transitions.** Все изменения `publish_status` в код-пути проходят через RPC, защищающий инварианты `quality_ok` и `verified_live`.

## Задача 1 — Visibility rejected (W2.3)

**Зачем:** сейчас `quality_reason` живёт только в `articles`, агрегата нет; невозможно одним запросом ответить «почему за день мало вышло».

**Контракт:**
- В `enrich_runs` добавляется поле `rejected_breakdown JSONB NOT NULL DEFAULT '{}'::jsonb`.
- Формат: `{"rejected_low_visual": 4, "research_too_short:1240": 1, "scorer_below_threshold": 12, ...}`. Ключ — нормализованная причина, значение — счётчик за run.
- Запись в конце run в `pipeline/enrich-collect-batch.ts` (агрегат по items run-а) и `pipeline/enrich-submit-batch.ts` (для score/visual reject до submit).
- Совместимость: при чтении старых row отсутствие поля считается `{}`.

**Точки записи:**
- `pipeline/enrich-submit-batch.ts` — pre-submit reject (`rejected_low_visual`, `scorer_below_threshold`, `keyword_filter`).
- `pipeline/enrich-collect-batch.ts` — post-collect reject (`research_too_short:N`, прочие quality_reason).

## Задача 2 — Алёрт `published_low_window` (W2.1)

**Зачем:** `digest_low_articles` срабатывает в момент дайджеста, тревога приходит уже после факта простоя 6–18 часов.

**Контракт:**
- Новый алёрт-тип `published_low_window`, `severity='warning'`, cooldown 2 часа.
- Логика: каждые 2 часа (`pipeline-health.yml`) проверять количество переходов в `publish_status='live'` за последние 6 часов МСК. Если 0 (и при этом feed-источники активны: `ingest_runs.status='success'` за тот же период) — `fireAlert`.
- Resolve: при появлении хотя бы одной `live` за окно — `resolveAlert('published_low_window')`.
- Рантайм: новый файл `pipeline/published-window-monitor.ts`, экспорт `runPublishedWindowMonitor()`.

**Edge cases (обязательны):**
- Ночное окно по МСК (00:00–06:00 МСК = 21:00–03:00 UTC) — алёрт подавляется (низкая активность источников).
- Если все `ingest_runs` за окно — `failed`, тревога превращается в downstream-сигнал и не fire-ится (root cause виден через `source_down`).

**Cooldown в `pipeline/alerts.ts:COOLDOWN_HOURS`** — добавить ключ `published_low_window: 2`.

## Задача 3 — Publish-verify early warning (W2.2)

**Зачем:** сейчас `publish_verify_failed` поднимается только после `MAX_VERIFY_ATTEMPTS=3`; до 3 часов сетевые / SSG-проблемы видны только в `article_attempts`.

**Контракт:**
- В `pipeline/publish-verify.ts:24` оставить `MAX_VERIFY_ATTEMPTS=3`.
- Поведение алёрта:
  - после 1-й failed попытки — `severity='warning'`, dedup-key `publish_verify_failed:warn`, cooldown 1 час;
  - после `MAX_VERIFY_ATTEMPTS` — текущий `severity='critical'`, dedup-key `publish_verify_failed`, cooldown 6 часов.
- При success-verify — `resolveAlert('publish_verify_failed', ...)` для обоих ключей.
- В `COOLDOWN_HOURS` добавить `publish_verify_failed_warn: 1` и оставить `publish_verify_failed: 6`.

## Задача 4 — Fetch failures в `article_attempts` (W3.1)

**Зачем:** 404/timeout/too-large HTML в `pipeline/fetcher.ts` сейчас уходят только в `console`, не учитываются как операционные failures.

**Контракт:**
- Расширить `article_attempts.stage` enumeration: добавить `'fetch'`. Уже есть CHECK constraint в миграции 005 — обновить в новой миграции `014_observability_publication.sql`.
- В `pipeline/fetcher.ts::fetchArticle()` (или там, где централизуется HTTP) — wrapper, который при ошибке вызывает `writeFetchAttempt(supabase, articleId, attemptNo, resultStatus, errorCode, errorMessage)`.
- Коды ошибок (нормализованные):
  - `fetch_404`, `fetch_5xx`, `fetch_timeout`, `fetch_aborted`, `fetch_too_large`, `fetch_empty`, `fetch_blocked` (cloudflare/перехват), `fetch_unknown`.
- Метрика идёт также в `source_runs.fetch_errors_count INT` и `source_runs.fetch_errors_breakdown JSONB`.

## Задача 5 — Атомарный `publish_ready → live` через RPC (W4.1)

**Зачем:** сейчас переход к `publish_status='live'` пишется через клиентский update, без инварианта «нельзя `live` если `quality_ok=false` или `verified_live=false`». Возможен рассинхрон.

**Контракт:**
- Новая Postgres функция `public.publish_article(p_article_id uuid, p_verifier text)` returns enum `publish_transition_result`.
  - Допустимые исходы: `published_live`, `rejected_quality`, `rejected_unverified`, `already_live`, `not_eligible`.
  - Внутри: `UPDATE articles SET publish_status='live', verified_live=true, published=true, published_at=NOW() WHERE id=p_article_id AND quality_ok=true AND publish_status IN ('publish_ready','verifying') AND verified_live IN (true, false)` (логика проверки во включающем CTE).
  - Контрольно: запрещён прямой `UPDATE articles SET publish_status='live'` вне RPC — закрепляем grant на колонку для service-role + linter в `tests/node/publish-rpc.test.ts`, который ищет в коде вне `pipeline/publish-verify.ts` запись `publish_status: 'live'`.
- Обратный путь — `withdraw_article(p_article_id, p_reason text)` (опц., backlog).
- Миграция: `supabase/migrations/014_observability_publication.sql`.
- **Emergency bypass:** env-флаг `PUBLISH_RPC_DISABLED=1` отключает RPC-путь и временно возвращает прямой `UPDATE` (только для аварии, требует фиксации в `docs/DECISIONS.md` и связанного incident-доклада). Реализация — в `pipeline/publish-verify.ts`: если флаг установлен, идти legacy-путём и записывать `pipeline_alerts` уровня `warning` (`publish_rpc_bypass_active`).

## Задача 6 — `digest_runs` всегда пишется (W2.4)

**Зачем:** silent `return` в `bot/daily-digest.ts:181–186` приводит к тому, что неотправленный дайджест не оставляет следа в `digest_runs`.

**Контракт:**
- Любая ветвь `bot/daily-digest.ts::main()` обязана завершиться вызовом `writeDigestRun(supabase, { status, ... })`.
- Допустимые `status`: `success`, `skipped_already_claimed`, `skipped_no_articles`, `skipped_outside_window`, `failed_send`, `failed_pipeline_stalled`.
- `error_summary` обязателен для всех `failed_*` и `skipped_no_articles`.
- Existing UNIQUE на `(digest_date, channel_id)` сохраняется; для skipped используется `ON CONFLICT DO UPDATE` (только если статус прежний — `skipped_*`), иначе — `ON CONFLICT DO NOTHING` (success-claim ранее уже занят).

## Задача 7 — Расширенный `/api/health` (W1.3)

**Зачем:** текущий health показывает last-run, но не отвечает на «всё ли в порядке прямо сейчас».

**Контракт ответа** (`app/api/health/route.ts`):
```json
{
  "server_time": "...",
  "ingest": { "finished_at": "...", "status": "..." },
  "enrich": { "finished_at": "...", "status": "...", "run_kind": "..." },
  "digest": { "digest_date": "...", "status": "...", "sent_at": "..." },
  "alerts_open": 3,
  "batches_open": 1,
  "oldest_pending_age_minutes": 47,
  "articles_published_today": 12,
  "articles_rejected_today_by_reason": { "rejected_low_visual": 4, "scorer_below_threshold": 12 },
  "cost_today_usd": 0.42,
  "live_window_6h_count": 8,
  "top_open_alerts": [
    { "alert_type": "...", "severity": "...", "first_seen_at": "...", "occurrence_count": 5 }
  ]
}
```

**Источники:**
- `oldest_pending_age_minutes` — `articles WHERE enrich_status IN ('pending','retry_wait','processing')`, MIN из `pub_date` нормализованный.
- `articles_published_today` — `articles WHERE publish_status='live' AND published_at::date = CURRENT_DATE AT TIME ZONE 'Europe/Moscow'`.
- `articles_rejected_today_by_reason` — агрегат `enrich_runs.rejected_breakdown` за сегодня (МСК).
- `cost_today_usd` — `SUM(estimated_cost_usd) FROM llm_usage_logs WHERE date_msk = CURRENT_DATE AT TIME ZONE 'Europe/Moscow'`.
- `live_window_6h_count` — то же, что используется в `published_low_window`.
- `top_open_alerts` — top-5 by `last_seen_at DESC`, status='open'.

**Производительность:** `Promise.all` всех запросов параллельно; cache-control `no-store`. Latency target — < 300ms.

## Задача 8 — Admin dashboard `/internal/dashboard` (W4.2)

**Зачем:** Supabase Studio — высокое трение в день инцидента; нужно «one screen» для оператора.

**Контракт:**
- Маршрут: `app/internal/dashboard/page.tsx` (server component).
- Авторизация: middleware `app/internal/middleware.ts` (создать), требующий `?token=HEALTH_TOKEN` или header `x-health-token`. Без токена — 404 (не 401, чтобы не светить существование роута).
- `robots.txt` уже запрещает `/internal/` (см. `docs/OPERATIONS.md`).
- Содержание (одна страница, без интерактива):
  - Текущее состояние: те же поля, что и `/api/health`, но в человеко-читаемом виде.
  - Таблица последних 10 `pipeline_alerts` (status='open' first, потом recent resolved).
  - Таблица последних 10 stuck `anthropic_batch_items` (status NOT IN ('applied','batch_failed','apply_failed_terminal') и `created_at < NOW() - 30m`).
  - Таблица последних 20 переходов в `live` с `verified_live_at` и временем от `publish_ready_at` (lag).
  - Last 5 `digest_runs`.
- Auto-refresh: meta `<meta http-equiv="refresh" content="60">` (минимально достаточно).

## Задача 9 — Cleanup мёртвых alert types (W1.2)

**Зачем:** `enrich_failed_spike` и `backlog_high` объявлены в `pipeline/alerts.ts:14–24`, но не вызываются нигде. Это вводит в заблуждение оператора.

**Контракт:**
- `backlog_high` — реализовать `fireAlert` внутри `pipeline/backlog-monitor.ts` (триггер: `pending+retry_wait+processing > N`, где `N` берётся из env `BACKLOG_HIGH_THRESHOLD`, default 80). Resolve при возврате к норме.
- `enrich_failed_spike` — реализовать в `pipeline/enrich-collect-batch.ts` finalize: если `failure_rate = failed / total >= 0.4` и `total >= 5` за run → `fireAlert`.
- Если за реализацию какой-то задачи берёт > 1 дня — вместо реализации **удалить** соответствующий ключ из `COOLDOWN_HOURS` и поставить TODO в `docs/ORCHESTRATOR.md`. Решение фиксируется в `docs/DECISIONS.md`.

## Задача 10 — Дополнительные алёрты (volna 3 follow-up, опционально, W3.4–W3.6)

**`claude_parse_failed`:** в `pipeline/enrich-collect-batch.ts:305–320` после установки `error_code='claude_parse_failed'` поднимать алёрт уровня warning, cooldown 4 часа. Помогает увидеть регрессию формата ответа модели.

**`lease_expired_spike`:** в `pipeline/recover-stuck.ts` при `> 3` recovery за один run поднимать `severity='warning'`, cooldown 2 часа.

**`llm_usage_log_write_failed`:** обернуть `writeLlmUsageLog` в try/catch с `fireAlert` уровня warning, cooldown 4 часа. Само логирование cost — не должно падать тихо, иначе cost-guard работает на старых данных.

## Внеконтрактные изменения, запрещённые в этой инициативе

- Новые feature-флаги.
- Изменения схем `articles` помимо явно перечисленных.
- Затрагивание slug/URL/render логики.
- Любое изменение Telegram-бот-сценариев, кроме `bot/daily-digest.ts`.

## Источники истины и cross-cutting правила

- Все новые алёрт-типы регистрируются в `pipeline/alerts.ts:COOLDOWN_HOURS` в одном PR с реализацией.
- Новые stage в `article_attempts` сопровождаются миграцией `014_observability_publication.sql`.
- Любая запись через service-role; нигде не должен светиться `SUPABASE_SERVICE_KEY` в client-bundles.
- RLS на новые/изменённые таблицы остаётся существующим.

## Когда переносить в канонические доки

После прохождения всех wave 1–4:
- Изменения публикации и rejected breakdown → `docs/ARTICLE_SYSTEM.md`.
- Изменения health endpoint, dashboard, новые алёрт-типы и cron — `docs/OPERATIONS.md`.
- Решение по `enrich_failed_spike` / `backlog_high` (реализовано или отброшено) — `docs/DECISIONS.md`.
