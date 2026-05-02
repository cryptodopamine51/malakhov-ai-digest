# Task Breakdown: Observability и публикация

**Дата:** 2026-05-01
**Связанная спецификация:** `docs/spec_observability_publication_2026-05-01.md`
**Связанная карта файлов:** `docs/file_map_observability_publication_2026-05-01.md`

## Принципы исполнения

- Один блок задач = один git-commit / один PR (если работаем в branches).
- Каждая задача завершается прогоном связанного теста и `npm run docs:check`.
- Между волнами — обязательная контрольная точка (см. `docs/ORCHESTRATOR_observability_publication_2026-05-01.md`).
- Если задача блокирует следующую — это явно отмечено `Depends on`.

---

## Волна 1 — Visibility quick wins

**Цель:** в первые часы после деплоя оператор должен иметь полную картинку текущего состояния, без выкатки новой логики публикации.

### W1.0 — Подготовка миграции 014

**Файлы:** `supabase/migrations/014_observability_publication.sql` (см. file_map § 1).

**Шаги:**
1. Создать файл миграции с DDL ровно по spec.
2. Локально применить через Supabase CLI: `supabase db push` (если есть локальный) или ручной apply через psql.
3. Прогнать `tests/node/publish-rpc.test.ts` (упадёт по реализации, но проверит DDL).

**Depends on:** —
**Тесты:** существующие test:pipeline-reliability должен продолжать проходить.
**Контрольная точка:** все DDL-команды идемпотентны (`IF NOT EXISTS` / `DROP CONSTRAINT IF EXISTS`).

### W1.1 — Расширить `lib/supabase.ts` типами

**Файлы:** `lib/supabase.ts`.

**Шаги:**
1. Добавить `last_publish_verifier?: string | null` в `Article`.
2. Добавить `rejected_breakdown?: Record<string, number>` в `EnrichRun`.
3. Добавить `fetch_errors_count`, `fetch_errors_breakdown`, `items_rejected_count`, `items_rejected_breakdown` в `SourceRun`.

**Depends on:** W1.0
**Тесты:** `npm run build` проходит (типы).
**Контрольная точка:** TS-компиляция всего pipeline зелёная.

### W1.2 — Cleanup мёртвых alert types

**Файлы:** `pipeline/alerts.ts`, `pipeline/backlog-monitor.ts`, `pipeline/enrich-collect-batch.ts`.

**Шаги:**
1. В `pipeline/backlog-monitor.ts` реализовать `fireAlert('backlog_high', ...)` при превышении `BACKLOG_HIGH_THRESHOLD`. `resolveAlert` при возврате к норме.
2. В `pipeline/enrich-collect-batch.ts` финализаторе посчитать `failure_rate = failed_items / total_items` за run; при `total >= 5` и `rate >= 0.4` → `fireAlert('enrich_failed_spike', warning)`.
3. В `pipeline/alerts.ts:COOLDOWN_HOURS` оставить оба ключа.
4. Если на момент работы оказывается, что `backlog-monitor.ts` не вызывается из workflow — добавить step в `.github/workflows/pipeline-health.yml`.

**Depends on:** W1.0
**Тесты:** `tests/node/alert-cleanup.test.ts` (см. file_map § 9).
**Контрольная точка:** grep `fireAlert(.*'backlog_high'` и `'enrich_failed_spike'` находит вызовы.

### W1.3 — Расширенный `/api/health`

**Файлы:** `lib/health-summary.ts` (новый), `app/api/health/route.ts`.

**Шаги:**
1. Создать `lib/health-summary.ts`, экспорт `getHealthSummary(supabase): Promise<HealthSummary>`.
2. Реализовать запросы (см. spec § 7) с одним `Promise.all`.
3. Обновить `app/api/health/route.ts` — теперь это тонкий wrapper над `lib/health-summary.ts`.
4. Покрыть `tests/node/health-endpoint.test.ts`: контрактный shape.

**Depends on:** W1.0, W1.1
**Тесты:** `tests/node/health-endpoint.test.ts`.
**Контрольная точка:** `curl https://news.malakhovai.ru/api/health?token=…` возвращает все поля; latency на проде < 300ms.

### Контрольная точка волны 1

- Миграция 014 применена в production.
- `/api/health` отдаёт новые поля.
- В `pipeline_alerts` появляются (тестово) алёрты `backlog_high`/`enrich_failed_spike`, если условия достигнуты.
- `npm run test:pipeline-reliability` зелёный.
- `npm run docs:check` без ошибок.
- `docs/OPERATIONS.md` обновлён в части health и алёртов.

---

## Волна 2 — Закрытие критичных пробелов в публикации

**Цель:** ранний сигнал о простое публикации; full-coverage лога для дайджеста и rejected.

### W2.1 — Алёрт `published_low_window`

**Файлы:** `pipeline/published-window-monitor.ts` (новый), `pipeline/alerts.ts`, `.github/workflows/pipeline-health.yml`.

**Шаги:**
1. Создать `pipeline/published-window-monitor.ts` со следующими полями: `runPublishedWindowMonitor()`, `checkLiveWindow(supabase, hours)`, `isQuietWindow(now)`.
2. Логика: считаем `count(*)` из `articles WHERE publish_status='live' AND published_at >= NOW() - interval '6h'`. Если 0 — проверяем, что последний `ingest_runs` за окно success. Если да — fire, если нет — skip.
3. В `pipeline/alerts.ts:COOLDOWN_HOURS` ключ `published_low_window: 2`.
4. Параметризовать через env: `PUBLISHED_LOW_WINDOW_HOURS` (default 6), `PUBLISHED_LOW_WINDOW_QUIET_START_MSK` (default 0), `PUBLISHED_LOW_WINDOW_QUIET_END_MSK` (default 6).
5. Step в `.github/workflows/pipeline-health.yml`.
6. Тесты: `tests/node/published-window-monitor.test.ts` со 4 кейсами из spec.

**Depends on:** W1.0
**Тесты:** `tests/node/published-window-monitor.test.ts`.
**Контрольная точка:** искусственно создав окно простоя в staging, увидеть алёрт в Telegram через ≤ 2ч.

### W2.2 — Publish-verify early warning

**Файлы:** `pipeline/publish-verify.ts`, `pipeline/alerts.ts`.

**Шаги:**
1. В `verifyChunk` после получения failure (1-я попытка для article) — `fireAlert('publish_verify_failed_warn', warning, entityKey=article.id, cooldown 1h)`.
2. На 3-й попытке — текущее поведение (critical), но добавить `entityKey=article.id`, чтобы дедуп шёл per-article.
3. На success — `resolveAlert('publish_verify_failed_warn', article.id)` и `resolveAlert('publish_verify_failed', article.id)`.
4. В `COOLDOWN_HOURS` добавить `publish_verify_failed_warn: 1`.

**Depends on:** W1.0
**Тесты:** `tests/node/publish-verify-warn.test.ts`.
**Контрольная точка:** искусственный 503 на одной статье — warn в течение часа, не critical.

### W2.3 — Rejected breakdown в `enrich_runs`

**Файлы:** `pipeline/enrich-submit-batch.ts`, `pipeline/enrich-collect-batch.ts`.

**Шаги:**
1. Завести в-памяти `Map<string, number>` для счётчиков, обновлять при каждом reject в submit-batch / collect-batch.
2. При финализации run — записывать в `enrich_runs.rejected_breakdown`.
3. Нормализация ключей: `quality_reason` → префикс до `:` (например `research_too_short:1240` → `research_too_short`). Полная форма с длиной — отдельный ключ для подробной диагностики (агрегируется в health endpoint по префиксу).

**Depends on:** W1.0
**Тесты:** `tests/node/observability-rejected-breakdown.test.ts`.
**Контрольная точка:** на staging-данных за день видеть в `enrich_runs.rejected_breakdown` ≥ 3 разных причин.

### W2.4 — Дайджест всегда пишет `digest_runs`

**Файлы:** `bot/daily-digest.ts`.

**Шаги:**
1. Аудит всех `return` в `main()` — для каждой ветки определить status из enum.
2. Завести helper `recordDigestRun(supabase, status, payload)`.
3. Удалить silent return в районе текущей строки 181–186 — заменить на `recordDigestRun('skipped_no_articles', { reason: 'article_not_live' })` (или подобное).
4. UNIQUE-конфликт: если slot уже занят — `status='skipped_already_claimed'`.

**Depends on:** W1.0
**Тесты:** `tests/node/digest-runs-completeness.test.ts`.
**Контрольная точка:** запустить локально с подменёнными выборками — увидеть row для каждого пути.

### Контрольная точка волны 2

- За сутки в `digest_runs` по 1 row на запуск, без NULL в `error_summary` для skipped/failed.
- В `enrich_runs.rejected_breakdown` — реальные причины.
- `published_low_window` тестово срабатывал хотя бы раз (можно симулировать пустой 6h).
- `publish_verify_failed_warn` хоть раз появился в `pipeline_alerts` (если были транзиентные сети).
- `docs/ARTICLE_SYSTEM.md` и `docs/OPERATIONS.md` обновлены.

---

## Волна 3 — Полнота журнала

**Цель:** ни одна ошибка fetch/RSS/media/Claude не уходит без следа в БД.

### W3.1 — `article_attempts` со `stage='fetch'`

**Файлы:** `pipeline/fetcher.ts`, `pipeline/enrich-submit-batch.ts`, `pipeline/ingest.ts`, миграция 014.

**Шаги:**
1. Расширить `pipeline/fetcher.ts::fetchArticle` сигнатуру: возвращать `{ ok: boolean, text?: string, errorCode?: string, errorMessage?: string }`.
2. В `pipeline/enrich-submit-batch.ts` точка вызова: при `!ok` → `writeArticleAttempt(supabase, articleId, 'fetch', attemptNo, 'failed', errorCode, errorMessage)`.
3. На уровне ingest — для feeds, что фетчим напрямую (если такие есть), та же логика.
4. CHECK constraint обновлён в миграции 014 (W1.0).

**Depends on:** W1.0
**Тесты:** `tests/node/article-attempts-fetch.test.ts`.
**Контрольная точка:** искусственный 404 в staging — видим row в `article_attempts` со `stage='fetch'`.

### W3.2 — Счётчик отброшенных RSS items

**Файлы:** `pipeline/rss-parser.ts`, `pipeline/ingest.ts`.

**Шаги:**
1. `parseFeed` возвращает `{ items, rejected: { reason: string, count: number, examples: [] }[] }`.
2. ingest агрегирует и записывает в `source_runs.items_rejected_count`/`items_rejected_breakdown`.

**Depends on:** W1.0, W1.1
**Тесты:** unit на `parseFeed` (можно встроить в существующий `tests/node/rss-parser.test.ts` если есть, иначе — в новый файл).
**Контрольная точка:** в `source_runs` non-zero `items_rejected_count` для broad feeds (vc.ru, RB.ru).

### W3.3 — Media-sanitizer rejects → `article_attempts`

**Файлы:** `pipeline/media-sanitizer.ts`, `pipeline/enrich-submit-batch.ts`, `pipeline/enrich-collect-batch.ts`.

**Шаги:**
1. Уточнить, что `sanitizeArticleMedia` возвращает `rejects: Array<{ url, reason, source }>` (если уже возвращает — extend, иначе — добавить в return).
2. В точках вызова: если `rejects.length > 0` → `writeArticleAttempt(supabase, articleId, 'media_sanitize', attemptNo=1, 'ok', payload={ rejects })`. Если `rejects.length` приводит к pre-submit reject — отдельный row со `stage='media_sanitize'`, `result_status='rejected'`.

**Depends on:** W1.0
**Тесты:** добавить case в `tests/node/media-sanitizer.test.ts` — что rejects не теряются.
**Контрольная точка:** для problem-pages из spec видны attempts.

### W3.4 — Алёрт `claude_parse_failed`

**Файлы:** `pipeline/enrich-collect-batch.ts`, `pipeline/alerts.ts`.

**Шаги:**
1. После set `error_code='claude_parse_failed'` в строках 305–320 → `fireAlert('claude_parse_failed', warning, cooldown 4h, entityKey=batch_id)`.
2. В `COOLDOWN_HOURS` ключ `claude_parse_failed: 4`.

**Depends on:** W1.0
**Тесты:** unit на функцию агрегатора (smoke).
**Контрольная точка:** смотрим, что warning пришёл в админский TG если в течение 4ч был хоть один claude_parse_failed.

### W3.5 — Алёрт `lease_expired_spike`

**Файлы:** `pipeline/recover-stuck.ts`, `pipeline/alerts.ts`.

**Шаги:**
1. В конце run считать кол-во recovered articles. Если > 3 → `fireAlert('lease_expired_spike', warning, cooldown 2h)`.
2. `COOLDOWN_HOURS`: `lease_expired_spike: 2`.

**Depends on:** W1.0
**Тесты:** unit (mock supabase + 4 stuck articles).
**Контрольная точка:** алёрт виден после симуляции крэшнутого worker.

### W3.6 — Защита `writeLlmUsageLog`

**Файлы:** `pipeline/llm-usage.ts`, `pipeline/alerts.ts`.

**Шаги:**
1. Обернуть в try/catch.
2. На ошибку — `fireAlert('llm_usage_log_write_failed', warning, cooldown 4h)` и `console.error`.
3. Не throw наружу (cost-логирование не должно ронять collect-batch).

**Depends on:** W1.0
**Тесты:** unit с mock supabase, который throw на insert.
**Контрольная точка:** при сбое DB cost-метрики продолжают писаться в следующих run, алёрт пришёл.

### Контрольная точка волны 3

- Все стадии (RSS → fetch → score → submit → collect → media → publish-verify → digest) имеют свой источник журнала.
- Любая статья — по `article_attempts` можно восстановить полную траекторию.
- Все объявленные `COOLDOWN_HOURS` ключи имеют реальные `fireAlert(...)` вызовы.

---

## Волна 4 — Атомарность и админка

**Цель:** убрать класс ошибок «частичный publish» и снять трение в день инцидента.

### W4.1 — RPC `publish_article` + переключение `publish-verify`

**Файлы:** миграция 014 (RPC уже создан в W1.0), `pipeline/publish-verify.ts`, `tests/node/publish-rpc.test.ts`.

**Шаги:**
1. Заменить в `pipeline/publish-verify.ts` все прямые `UPDATE articles SET publish_status='live'` на вызов RPC `publish_article(article_id, 'publish-verify')`.
2. Обработка возвращаемых кодов:
   - `published_live` → существующее поведение (alert resolve, log).
   - `already_live` → idempotent skip, info-level log.
   - `rejected_quality` → critical alert (внезапное `quality_ok=false` после publish_ready); article в `withdrawn`.
   - `rejected_unverified` / `not_eligible` → article-level investigation, write `article_attempts` с error_code.
3. Lint-тест: grep `publish_status: 'live'` или `publish_status:'live'` вне `pipeline/publish-verify.ts` и `supabase/migrations/` — должен возвращать пусто.
4. Реализовать emergency bypass: при `process.env.PUBLISH_RPC_DISABLED === '1'` — legacy-путь (`UPDATE articles SET publish_status='live'`) + `fireAlert('publish_rpc_bypass_active', 'warning', cooldown 6h)`. В `COOLDOWN_HOURS` добавить `publish_rpc_bypass_active: 6`.

**Depends on:** W1.0
**Тесты:** `tests/node/publish-rpc.test.ts` (4 кейса + lint).
**Контрольная точка:** на staging — переход к live идёт через RPC, audit в `last_publish_verifier='publish-verify'`.

### W4.2 — Admin dashboard `/internal/dashboard`

**Файлы:** см. file_map § 5.

**Шаги:**
1. Корневой `middleware.ts` — гард на `/internal/dashboard*`, без токена 404.
2. `app/internal/dashboard/page.tsx` — server component, получает `getHealthSummary()` + дополнительные queries (alerts, stuck batches, recent live, last digests).
3. UI блоки в `sections/`. Никакого client-side state — только server render.
4. Auto-refresh через meta refresh.
5. `robots.txt` уже запрещает `/internal/` — не трогаем.

**Depends on:** W1.3 (использует `lib/health-summary.ts`).
**Тесты:** `tests/node/internal-dashboard-auth.test.ts` (404 без токена, 200 с токеном).
**Контрольная точка:** dashboard грузится за < 1.5s; данные совпадают с `/api/health`; smoke-check в production.

### Контрольная точка волны 4

- Все переходы в `live` идут через RPC.
- Admin dashboard доступен оператору; защищён `HEALTH_TOKEN`.
- `docs/OPERATIONS.md` дополнен секцией «Admin Dashboard».
- `docs/ARTICLE_SYSTEM.md` дополнен секцией «Atomic publish transition».
- `docs/DECISIONS.md` фиксирует RPC-only path.

---

## Финальный rollup

После W4:
1. Перенести итоги из `spec_*` / `task_breakdown_*` / `acceptance_criteria_*` / `file_map_*` в канонические `docs/OPERATIONS.md` и `docs/ARTICLE_SYSTEM.md`.
2. Временные файлы 2026-05-01 не удалять — они остаются как execution-history.
3. Обновить `CLAUDE.md` (last update + ссылки).
4. Обновить `docs/INDEX.md`.
5. Прогнать на проде smoke-check: `npm run docs:check`, ручная проверка `/api/health` и `/internal/dashboard`.

## Откат (rollback) для каждой волны

| Волна | Что катится назад | Как |
|---|---|---|
| W1 | health endpoint расширен | git revert PR; миграция 014 — `ALTER TABLE ... DROP COLUMN` (поля nullable / default — безопасно) |
| W2 | алёрты | удалить ключи из `COOLDOWN_HOURS`; remove publish-verify warning код (revert PR) |
| W3 | новые stage в article_attempts | revert PR; CHECK constraint вернуть к старому набору stages |
| W4 | RPC | revert PR + восстановить прямой `UPDATE` (миграция оставляется — RPC сам по себе не мешает) |

Все откаты — без data loss: новые поля имеют DEFAULT, новые алёрты можно отключить через убирание COOLDOWN ключа.
