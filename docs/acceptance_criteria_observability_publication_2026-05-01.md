# Acceptance Criteria: Observability и публикация

**Дата:** 2026-05-01
**Связанная спецификация:** `docs/spec_observability_publication_2026-05-01.md`
**Связанный orchestrator:** `docs/ORCHESTRATOR_observability_publication_2026-05-01.md`

Каждый раздел — Definition of Done для соответствующей волны / задачи. Любой пункт, не закрытый по факту, делает волну незавершённой.

## A. Схема и миграции

- A1. Файл `supabase/migrations/014_observability_publication.sql` существует и идемпотентен.
- A2. `enrich_runs.rejected_breakdown JSONB NOT NULL DEFAULT '{}'` присутствует в production БД.
- A3. `source_runs.fetch_errors_count`, `source_runs.fetch_errors_breakdown`, `source_runs.items_rejected_count`, `source_runs.items_rejected_breakdown` присутствуют.
- A4. `article_attempts.stage` CHECK включает `'fetch'` и `'media_sanitize'`.
- A5. `digest_runs.status` CHECK содержит все 6 значений из spec § 6.
- A6. RPC `public.publish_article(uuid, text)` существует и доступен `service_role`.
- A7. `articles.last_publish_verifier` присутствует.
- A8. Index `idx_articles_published_at WHERE publish_status='live'` создан.

## B. Логирование (источники истины)

- B1. На каждый запуск `pipeline/ingest.ts` в `ingest_runs` появляется ровно 1 row, на каждый source — 1 row в `source_runs`.
- B2. `source_runs.items_rejected_count` non-zero хотя бы для одного broad feed (vc.ru/RB.ru) за сутки.
- B3. `source_runs.fetch_errors_count` отражает реальные fetch failures за run (если они были).
- B4. На каждую failed попытку `fetch` в `article_attempts` есть row со `stage='fetch'`, `error_code` из нормализованного множества (`fetch_404`, `fetch_5xx`, `fetch_timeout`, `fetch_aborted`, `fetch_too_large`, `fetch_empty`, `fetch_blocked`, `fetch_unknown`).
- B5. На каждую media-санитизацию с непустым `rejects` есть row `stage='media_sanitize'`.
- B6. `enrich_runs.rejected_breakdown` за каждый run отражает все причины reject (pre-submit + post-collect).
- B7. `bot/daily-digest.ts::main()` не имеет ни одного выхода без записи в `digest_runs` (включая ранние return / catch).
- B8. `llm_usage_logs` пишется при каждом успешном collect-batch apply; при сбое insert-а поднимается алёрт `llm_usage_log_write_failed` (а не silent error).

## C. Алёрты

- C1. Каждый ключ из `pipeline/alerts.ts:COOLDOWN_HOURS` имеет минимум один реальный `fireAlert(...)` в кодовой базе (grep-test).
- C2. Алёрт `published_low_window` срабатывает при 0 переходов в live за 6h при активных feeds, и не срабатывает в quiet-window МСК.
- C3. Алёрт `publish_verify_failed_warn` срабатывает после 1-й failed verify; `publish_verify_failed` (critical) — после `MAX_VERIFY_ATTEMPTS`.
- C4. Алёрт `claude_parse_failed` срабатывает при non-empty `error_code='claude_parse_failed'` в `anthropic_batch_items`.
- C5. Алёрт `lease_expired_spike` срабатывает при `> 3` recovered articles в одном run `recover-stuck`.
- C6. Алёрт `backlog_high` срабатывает при `pending+retry_wait+processing > BACKLOG_HIGH_THRESHOLD`.
- C7. Алёрт `enrich_failed_spike` срабатывает при `failed_items / total_items >= 0.4` и `total_items >= 5`.
- C8. Все алёрты соблюдают cooldown (повторные не приходят в Telegram внутри окна).
- C9. Все алёрты имеют корректный `severity` (warning vs critical) согласно spec.
- C10. Resolve работает для алёртов с восстанавливающим состоянием (source_health, published_low_window, publish_verify_failed, backlog_high).
- C11. При установке `PUBLISH_RPC_DISABLED=1` поднимается алёрт `publish_rpc_bypass_active` (warning, cooldown 6h); resolve — после снятия флага и первого успешного RPC-перехода.

## D. Публикация (атомарность)

- D1. RPC `publish_article` возвращает все 5 кодов из spec, согласно входному состоянию.
- D2. Для `quality_ok=false` RPC возвращает `rejected_quality` и не меняет статус.
- D3. Для `publish_status='live'` RPC возвращает `already_live` (idempotent).
- D4. Lint-тест не находит прямых записей `publish_status: 'live'` нигде, кроме `pipeline/publish-verify.ts` и migration файлов.
- D5. `articles.last_publish_verifier` заполнен для всех статей, ставших live после релиза W4.
- D6. На неуспешный код RPC в `publish-verify` пишется `article_attempts` со stage `verify` и `result_status='failed'`.

## E. `/api/health` контракт

- E1. Endpoint защищён `HEALTH_TOKEN`. Без token — 401, с неверным — 401, с верным — 200.
- E2. JSON содержит все ключи: `server_time`, `ingest`, `enrich`, `digest`, `alerts_open`, `batches_open`, `oldest_pending_age_minutes`, `articles_published_today`, `articles_rejected_today_by_reason`, `cost_today_usd`, `live_window_6h_count`, `top_open_alerts`.
- E3. `cost_today_usd` использует МСК timezone для границ дня.
- E4. `articles_published_today` использует МСК timezone.
- E5. `top_open_alerts` — массив длины ≤ 5, упорядочен по `last_seen_at DESC`.
- E6. Время ответа эндпоинта на проде < 300ms (медиана).
- E7. Cache-Control: `no-store`.

## F. Admin Dashboard `/internal/dashboard`

- F1. Без `?token=...` — ответ 404.
- F2. С валидным `?token=HEALTH_TOKEN` — статус 200 и все блоки рендерятся.
- F3. На странице видны: health-cards, top-10 open alerts, top-10 stuck batches, recent 20 live publishes, last 5 digest_runs.
- F4. Auto-refresh каждые 60 секунд.
- F5. `robots.txt` запрещает `/internal/` (не регрессирует).
- F6. Время загрузки страницы < 1.5s на проде.
- F7. Никаких client-side state mutations; страница полностью server-rendered.

## G. Тесты

Каждый из перечисленных файлов существует и зелёный:

- G1. `tests/node/observability-rejected-breakdown.test.ts`
- G2. `tests/node/published-window-monitor.test.ts`
- G3. `tests/node/publish-verify-warn.test.ts`
- G4. `tests/node/digest-runs-completeness.test.ts`
- G5. `tests/node/article-attempts-fetch.test.ts`
- G6. `tests/node/publish-rpc.test.ts` (включая lint-проверку `publish_status: 'live'`)
- G7. `tests/node/health-endpoint.test.ts`
- G8. `tests/node/internal-dashboard-auth.test.ts`
- G9. `tests/node/alert-cleanup.test.ts`

Все существующие тесты:
- G10. `npm run test:pipeline-reliability` — green.
- G11. `npm run test:batch-enrich` — green.

## H. Документация

- H1. `docs/OPERATIONS.md` обновлён: новые алёрт-типы, расширенный health endpoint, admin dashboard, env variables.
- H2. `docs/ARTICLE_SYSTEM.md` обновлён: RPC `publish_article`, rejected_breakdown, новые stage `fetch`/`media_sanitize`.
- H3. `docs/DECISIONS.md` дополнен решением о RPC-only переходе и о судьбе `enrich_failed_spike`/`backlog_high`.
- H4. `docs/INDEX.md` дополнен ссылками на временные файлы 2026-05-01.
- H5. `CLAUDE.md` имеет обновлённую дату (2026-05-XX).
- H6. `npm run docs:check` зелёный.

## I. Smoke check на production

После полного rollout:

- I1. `curl https://news.malakhovai.ru/api/health?token=$HEALTH_TOKEN` отдаёт расширенный JSON.
- I2. Открыть `/internal/dashboard?token=$HEALTH_TOKEN` — все блоки заполнены.
- I3. Любая опубликованная сегодня статья видна в `articles_published_today`.
- I4. В `pipeline_alerts` нет «застрявших» open-алёртов с `last_seen_at < NOW() - 24h` без причины.
- I5. Telegram админ-чат получает алёрты с правильным severity.
- I6. RSS → ingest → submit → collect → live → digest для одной свежей статьи проходит без silent return; `article_attempts` показывает полную траекторию.
- I7. `digest_runs` за вчера и сегодня содержит row со status из enum (не NULL).

## J. Operational Definition of Done

- J1. На любой простой публикации > 6h оператор узнаёт через Telegram, а не через визуальную проверку сайта.
- J2. Любая статья — за 30 секунд можно ответить «что случилось» по `article_attempts` + `anthropic_batch_items`.
- J3. Любой день — за 30 секунд можно ответить «где просел контур» по `/api/health` или `/internal/dashboard`.
- J4. Отклонённые статьи (rejected) разбиты по причинам и видны в health.
- J5. Cost за день виден в health и совпадает с `cost:report` (расхождение < 1%).
- J6. Админ-дашборд используется командой как первая точка диагностики.
