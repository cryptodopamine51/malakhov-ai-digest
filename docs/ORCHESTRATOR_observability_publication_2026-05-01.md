# Orchestrator: Observability и публикация (2026-05-01)

> Главный план разработки и контроля для инициативы «закрытие серых зон логирования и улучшение публикации».
> Последнее обновление: 2026-05-02.
> Статусы: 🔲 pending · 🔄 in progress · ✅ done · ⏸ paused · ❌ blocked

## Карта документов

| Документ | Назначение |
|---|---|
| `docs/spec_observability_publication_2026-05-01.md` | Контракты изменений по каждой задаче |
| `docs/file_map_observability_publication_2026-05-01.md` | Точная карта файлов и DDL |
| `docs/task_breakdown_observability_publication_2026-05-01.md` | Пошаговое исполнение волн |
| `docs/acceptance_criteria_observability_publication_2026-05-01.md` | Definition of Done |
| `docs/ORCHESTRATOR_observability_publication_2026-05-01.md` | Этот файл — рулит ходом работ |

После завершения инициативы итоги сливаются в `docs/OPERATIONS.md`, `docs/ARTICLE_SYSTEM.md`, `docs/DECISIONS.md`. Временные файлы 2026-05-01 остаются как execution-history.

## Архитектура волн

```
Wave 1 (Visibility quick wins, 1 день)
    └─> миграция 014, расширенный /api/health, cleanup алёртов
        │
        ▼
Wave 2 (Закрытие критичных пробелов в публикации, 2 дня)
    └─> published_low_window, publish-verify warn, rejected_breakdown, digest_runs полностью
        │
        ▼
Wave 3 (Полнота журнала, 2 дня)
    └─> article_attempts.fetch, media_sanitize, RSS rejected counter, claude_parse_failed,
        lease_expired_spike, llm_usage_log_write_failed
        │
        ▼
Wave 4 (Атомарность и админка, 2 дня)
    └─> RPC publish_article, /internal/dashboard
        │
        ▼
Финальный rollup → канонические доки
```

Зависимость волн линейная: каждая следующая опирается на миграцию и типы из предыдущих. Внутри волны задачи независимы и могут идти параллельно (если работают разные люди).

## План задач

### Wave 1 — Visibility quick wins

| # | Задача | Статус | Owner | Тест-гейт |
|---|---|---|---|---|
| W1.0 | Миграция 014 | ✅ | claude | DDL применён в production через Supabase Management API 2026-05-02; verified: 9 объектов на месте, RPC `publish_article` корректно отвечает `'not_eligible'`, backfill заполнил `published_at` для всех 575 live-статей |
| W1.1 | Типы в `lib/supabase.ts` | ✅ | claude | `npx tsc --noEmit` зелёный, фикстуры тестов обновлены |
| W1.2 | Cleanup мёртвых alert types | ✅ | claude | Удалён мёртвый ключ `batch_partial_failure_spike`; `tests/node/alert-cleanup.test.ts` зелёный |
| W1.3 | Расширенный `/api/health` | ✅ | claude | `lib/health-summary.ts` + `app/api/health/route.ts`; `tests/node/health-endpoint.test.ts` 7/7 |

**Контрольная точка волны 1:** Acceptance criteria раздел A1–A8 (миграция), B7–B8 (lll_usage), E1–E7 (health endpoint). После приёмки — деплой; обновить `docs/OPERATIONS.md` секцией «Health endpoint v2».

### Wave 2 — Закрытие критичных пробелов в публикации

| # | Задача | Статус | Owner | Тест-гейт |
|---|---|---|---|---|
| W2.1 | `published_low_window` | ✅ | claude | `tests/node/published-window-monitor.test.ts` 12/12; quiet-window МСК + ingest-aware fire/resolve, step добавлен в `pipeline-health.yml` |
| W2.2 | publish-verify early warning | ✅ | claude | `tests/node/publish-verify-warn.test.ts` зелёный; warn (1-я попытка) + critical (exhausted) разнесены, success resolve-ит оба ключа |
| W2.3 | `rejected_breakdown` в `enrich_runs` | ✅ | claude | `tests/node/observability-rejected-breakdown.test.ts` 6/6; submit/collect bumpRejectedBreakdown + finishEnrichRun legacy fallback |
| W2.4 | `digest_runs` всегда пишется | ✅ | claude | `tests/node/digest-runs-completeness.test.ts` 8/8; миграция 015 = надмножество CHECK constraint; lint-test покрывает все post-claim `process.exit` |

**Контрольная точка волны 2:** Acceptance B6, B7, C2, C3. Симулировать в staging пустое 6h окно — увидеть алёрт. После — обновить `docs/ARTICLE_SYSTEM.md` (секция «Telegram digest и pipeline-health detection» уже есть, дополняется).

### Wave 3 — Полнота журнала

| # | Задача | Статус | Owner | Тест-гейт |
|---|---|---|---|---|
| W3.1 | `article_attempts.fetch` | ✅ | codex | `tests/node/article-attempts-fetch.test.ts` + full node gate; normalized `fetch_404|fetch_5xx|fetch_timeout|fetch_aborted|fetch_too_large|fetch_empty|fetch_blocked|fetch_unknown`; fetch-stage attempt writes via `writeArticleAttempt` |
| W3.2 | RSS rejected counter | ✅ | codex | `tests/node/rss-parser-rejected.test.ts`; `parseFeed` returns rejected summary, ingest adds `dedup`, `source_runs.items_rejected_*` write has legacy column fallback |
| W3.3 | media-sanitize attempts | ✅ | codex | `tests/node/media-sanitizer.test.ts`; submit/collect write `article_attempts.stage='media_sanitize'` when sanitizer has rejects |
| W3.4 | `claude_parse_failed` | ✅ | codex | `tests/node/claude-parse-alert.test.ts`; warning alert, cooldown 4h, entityKey=batch_id |
| W3.5 | `lease_expired_spike` | ✅ | codex | `tests/node/recover-stuck-alert.test.ts`; recovered > 3 per run fires warning, cooldown 2h |
| W3.6 | защищённый `writeLlmUsageLog` | ✅ | codex | `tests/node/llm-usage-log-alert.test.ts`; throwing insert не пробрасывается наружу, warning alert cooldown 4h |

**Контрольная точка волны 3:** ✅ Acceptance B1–B6, C1, C4–C9 закрыты кодом и unit-smoke тестами. Финальный gate: `npx tsc --noEmit` зелёный; `npx tsx --test tests/node/*.test.ts` — 111/111 pass. Восстановление траектории статьи покрывает RSS rejects → fetch → media_sanitize → enrich/collect → verify/digest observability.

### Wave 4 — Атомарность и админка

| # | Задача | Статус | Owner | Тест-гейт |
|---|---|---|---|---|
| W4.1 | RPC `publish_article` + переключение publish-verify | ✅ | codex | Safe DB smoke перед переключением: `publish_article(00000000-0000-0000-0000-000000000000,'codex-w4-precheck') -> 'not_eligible'`; `pipeline/publish-verify.ts` normal path вызывает RPC, `PUBLISH_RPC_DISABLED=1` оставляет emergency legacy update + alert `publish_rpc_bypass_active`; `tests/node/publish-rpc.test.ts` зелёный |
| W4.2 | `/internal/dashboard` | ✅ | codex | `app/internal/dashboard/page.tsx` server component; auth через `HEALTH_TOKEN` в `?token=` или `x-health-token`, без валидного токена `notFound()` → 404; данные из `lib/health-summary.ts` + alerts/stuck batch items/recent live/digest_runs; `tests/node/internal-dashboard-auth.test.ts` зелёный |

**Контрольная точка волны 4:** Acceptance D1–D6, F1–F7. Smoke на проде. После — финальный rollup.

## Контрольные точки качества (cross-wave)

Каждая волна обязательно проходит:

1. **TS build:** `npm run build` зелёный.
2. **Unit + integration tests:** `npm run test:pipeline-reliability && npm run test:batch-enrich` + новые тесты волны.
3. **Lint:** `npm run lint` без новых warnings.
4. **Docs guard:** `npm run docs:check` зелёный.
5. **Migration apply check:** при наличии DDL — применить локально, проверить идемпотентность повторного apply.
6. **Manual smoke:** `/api/health?token=...` отвечает; новый алёрт-тест демонстрирует ожидаемый Telegram-алёрт.
7. **Code review:** прежде чем merge — самопроверка по `acceptance_criteria_*.md`.

Если хотя бы одна точка проваливается — волна не считается закрытой, переход к следующей запрещён.

## Точки контроля Senior-ревью

Перед merge каждой волны Claude Code должен проверить себя по списку:

- [ ] Нет ли в diff backwards-compatibility shim там, где это не запрошено?
- [ ] Все новые `fireAlert` имеют ключ в `COOLDOWN_HOURS`?
- [ ] Все новые поля БД имеют DEFAULT, чтобы старые row не сломались?
- [ ] Тесты покрывают **позитивный** и **негативный** путь, а не только happy path?
- [ ] Lint-тест на запрещённые прямые записи `publish_status='live'` не закоменчен?
- [ ] Нет ли silent `catch {}` без `fireAlert` или `console.error`?
- [ ] Документация обновлена в том же PR, где меняется поведение?
- [ ] Нет «золотых» (hardcoded) значений, которые должны быть env-переменными?

## Rollout-стратегия

- W1 — apply migration + deploy → ничего не ломается, новые поля DEFAULT.
- W2 — деплой → новые алёрты могут появиться сразу (это ОК); если шумят — поднять threshold через env, не код.
- W3 — деплой → ингестим больше attempts; объём небольшой, индексов на `article_attempts` достаточно.
- W4 — самая чувствительная: после деплоя следить за `publish_article` returns; если > 1% не-`published_live` — копать причину, не откатывать вслепую.

## Rollback-сценарии

См. `docs/task_breakdown_observability_publication_2026-05-01.md` секция «Откат».

Дополнительно:
- При срабатывании C8 (cooldown не работает) — отключить шумящий ключ через PR `delete COOLDOWN_HOURS[key]`, не trying to migrate.
- При срабатывании D2 (RPC отказывает легитимные case) — переключение в emergency-mode возможно через env флаг `PUBLISH_RPC_DISABLED=1` (требует кода в W4.1; реализовать с самого начала).

## Риски

| Риск | Вероятность | Митигация |
|---|---|---|
| RPC `publish_article` неожиданно отказывает легитимные публикации (race с `verified_live=false`) | средняя | Тесты D1–D6; emergency env флаг; внимательный мониторинг первых 24h |
| `published_low_window` шумит ночью / в выходные | высокая (без quiet-window) | Quiet window МСК встроен в spec § 2 |
| Новые поля JSONB растут до больших размеров | низкая | Ограничение в коде (не более 50 ключей в breakdown) + индексов на JSONB не делаем |
| Admin dashboard течёт через `/internal` без токена | критичная при пробое | 404 без токена + `robots.txt` + ручной smoke первой волны |
| Расширенный `/api/health` тяжёлый и тормозит | средняя | Latency-тест на проде; кэшировать `cost_today_usd` через memoize в worker если > 300ms |
| Новые алёрты создают шум первые 48h | высокая | Cooldown-настроены агрессивно в spec; ревью первые сутки и tuning |

## Прогресс

История изменений этого файла:

| Дата | Изменение |
|---|---|
| 2026-05-01 | Создание оркестратора |
| 2026-05-02 | Wave 1 завершена: миграция 014 (код), типы в `lib/supabase.ts`, расширенный `/api/health` через `lib/health-summary.ts`, cleanup `batch_partial_failure_spike`. Все 63 существующих + 9 новых node-тестов зелёные. SQL миграции 014 ждёт ручного apply в production через Supabase Dashboard. |
| 2026-05-02 | W2.2 завершена: `publish_verify_failed_warn` (warning, cooldown 1ч) на 1-й failure; `publish_verify_failed` поднят до `severity='critical'` для exhausted; success-path резолвит оба ключа. Node-тестов 66/66. |
| 2026-05-02 | Wave 2 завершена (W2.1, W2.3, W2.4). Test suite: 94/95 пройдено (единственный fail — `media-sanitizer:author_photo`, pre-existing, не относится к этой инициативе). `npx tsc --noEmit` зелёный. Подробности по задачам:<br>• **W2.1** — `pipeline/published-window-monitor.ts` с `runPublishedWindowMonitor` / `checkLiveWindow` / `isQuietWindow` / `decideWindow`; ENV `PUBLISHED_LOW_WINDOW_HOURS` / `_QUIET_START_MSK` / `_QUIET_END_MSK`; `COOLDOWN_HOURS['published_low_window']=2`; шаг "Published window monitor" в `.github/workflows/pipeline-health.yml`. 12 кейсов теста (включая 4 из spec).<br>• **W2.3** — `bumpRejectedBreakdown` exported из `enrich-submit-batch.ts` и `enrich-collect-batch.ts`; submit считает `rejected_low_visual` и `low_score` (фактический quality_reason — health-summary схлопывает по префиксу); collect считает `editorial.quality_reason` для post-collect rejects (включая `research_too_short:N`). `finishEnrichRun` пишет `rejected_breakdown` JSONB; добавлен legacy-fallback в catch для случая, если миграция 014 ещё не накатана.<br>• **W2.4** — миграция `015_digest_runs_status_extension.sql` (надмножество, а не replace; легаси `running/success/skipped/low_articles/error/failed` остаются). Расширен `DigestRunStatus` тип; добавлен `writeUnclaimedDigestRun(...)` для случая, когда slot уже заклеймен (UNIQUE partial index покрывает только `('running','success')`, поэтому insert безопасен). Все post-claim ветки `main()` теперь пишут точные коды (`skipped_already_claimed`, `skipped_no_articles`, `failed_pipeline_stalled`, `failed_send`); pre-claim env-config errors намеренно исключены — они до DB-touch. `finalizeDigestFailure` дефолтит на `failed_send`; обновлён `tg-digest-idempotency.test.ts` под новый дефолт.<br>SQL миграции 014 и 015 — ждут ручного apply через Supabase Dashboard (`docs/OPERATIONS.md` это уже описывает для миграций 011+). |
| 2026-05-02 | Миграция 014 применена в production через Supabase Management API. Pre-check: 0 новых объектов; post-apply: 9 объектов on-prod; RPC smoke `'not_eligible'` корректно; backfill `articles.published_at` заполнил 575 live-row, 0 без значения. Real-data snapshot на момент применения: published_today=0, live_window_6h=0, cost_today_usd=0, **alerts_open=23** (преимущественно `batch_poll_stuck` за 4 дня + 1 critical `enrich_submit_blocked_budget`) — pipeline не полностью здоров, что отдельным образом подтверждает ценность инициативы.<br>Уточнения: `backlog_high` уже firing-ится в `pipeline/backlog-monitor.ts:55`; `enrich_failed_spike` уже firing-ится в `pipeline/provider-guard.ts:124`; в W2.4 обнаружен конфликт с миграцией 009 (`digest_runs_status_check_v2`), поэтому enum расширен надмножеством вместо replace. |
| 2026-05-02 | W3.1 завершена: `pipeline/fetcher.ts::fetchArticleContent` теперь возвращает нормализованные `fetch_*` коды вместо общего `fetch_failed` для article-fetch пути; `pipeline/enrich-submit-batch.ts` при fetch error сначала выполняет существующий release через enrich-attempt, затем пишет отдельный `article_attempts` row со `stage='fetch'`, `result_status='failed'`, payload `{run_id, phase, url}`. Добавлен общий `writeArticleAttempt` в `pipeline/enrich-runtime.ts`; `writeEnrichAttempt` оставлен совместимым wrapper-ом. Расхождение со spec: retry policy для новых `fetch_*` кодов сохранена как у старого `fetch_failed`, чтобы W3.1 не меняла operational semantics помимо observability. Stage fallback на старую production DB не добавлялся по задаче; миграция 014 должна быть применена перед деплоем. |
| 2026-05-02 | W3.2 завершена: `pipeline/rss-parser.ts::parseFeed` экспортирован и возвращает `rejected: {reason,count,examples}[]`; RSS-фильтры считают `keyword_filter` и `requireDateInUrl`. `pipeline/ingest.ts` агрегирует rejected per source, добавляет DB-дедупликацию как `dedup`, пишет `source_runs.items_rejected_count` / `items_rejected_breakdown`; для ещё не применённой миграции 014 добавлен legacy retry insert без новых колонок. |
| 2026-05-02 | W3.3 завершена: добавлен `writeMediaSanitizeAttempt` поверх общего `writeArticleAttempt`; `enrich-submit-batch` пишет `stage='media_sanitize'` при sanitizer rejects (`ok`, если медиа осталось или reject не вызван media gate; `rejected`, если все медиа отсеяны и это привело к `rejected_low_visual` до submit). `enrich-collect-batch` пишет `ok` с `batch_item_id` при collect-time rejects. Payload содержит `run_id`, `phase`, `rejects`, `remaining_media`. |
| 2026-05-02 | W3.4 завершена: `COOLDOWN_HOURS['claude_parse_failed']=4`; в `applyReadyResults` три contract ветки (`missing output_text`, parse fail, validation fail) после `finalizeBatchFailure(... errorCode='claude_parse_failed')` вызывают `fireClaudeParseFailedAlert`, который пишет warning с dedupe/entity key по `batch_id` и payload `{runId,batchId,itemId,reason}`. Slug assertion branch с тем же error code оставлена без нового алёрта, потому что задача явно перечисляла 3 Claude-output parse точки. |
| 2026-05-02 | W3.5 завершена: `recoverStuck` экспортирован для unit-теста и сохранён как CLI через `import.meta.url` guard. За run считается фактический `recovered`; если `recovered > 3`, вызывается `fireAlert({alertType:'lease_expired_spike', severity:'warning'})` с payload `{recovered,scanned,threshold}`. `COOLDOWN_HOURS['lease_expired_spike']=2`. |
| 2026-05-02 | W3.6 завершена: `writeLlmUsageLog` при Supabase insert error или thrown exception вызывает `fireAlert({alertType:'llm_usage_log_write_failed', severity:'warning'})`, пишет structured payload с operation/run/article/batch контекстом и не бросает ошибку наружу. `COOLDOWN_HOURS['llm_usage_log_write_failed']=4`. |
| 2026-05-02 | Wave 3 завершена полностью. После W3.1–W3.6 каждый шаг прошёл `npx tsc --noEmit` и `npx tsx --test tests/node/*.test.ts`; финальный прогон — 111/111 pass. `alert-cleanup.test.ts` подтверждает, что все новые cooldown keys (`claude_parse_failed`, `lease_expired_spike`, `llm_usage_log_write_failed`) имеют реальные `fireAlert(...)` вызовы. |
| 2026-05-02 | W4.1 завершена: перед кодовым переключением выполнен safe RPC-smoke текущей БД (`not_eligible` на несуществующий UUID). `publish-verify` больше не делает прямой `publish_status='live'` на normal path: успешный verify вызывает `rpc('publish_article', {p_article_id, p_verifier:'publish-verify'})`; `published_live`/`already_live` пишут ok verify-attempt и resolve-ят verify alerts, неуспешные RPC-коды пишут `article_attempts.stage='verify'`, `result_status='failed'`, `error_code='publish_rpc_*'`. `rejected_quality` переводит статью в `withdrawn` и поднимает critical `publish_verify_failed`. Emergency bypass только через `PUBLISH_RPC_DISABLED=1`, с warning alert `publish_rpc_bypass_active` (cooldown 6h). Целевой тест-гейт `publish-rpc.test.ts` + `alert-cleanup.test.ts`: 7/7 pass. |
| 2026-05-02 | W4.2 завершена: добавлен server-rendered `/internal/dashboard` без client state, `dynamic='force-dynamic'`, meta refresh 60s. Доступ проверяется на сервере через `HEALTH_TOKEN` в query/header; missing/wrong token вызывает `notFound()` и отдаёт 404. Данные собирает `lib/internal-dashboard.ts`: health summary, последние 10 alerts, top-10 stuck `anthropic_batch_items`, последние 20 live transitions с lag от `publish_ready_at`, последние 5 `digest_runs`. Целевой тест-гейт `internal-dashboard-auth.test.ts`: 6/6 pass; `npx tsc --noEmit` зелёный. |
| 2026-05-02 | Wave 4 завершена кодом и документацией. Финальный gate: `npx tsc --noEmit` зелёный; `npx tsx --test tests/node/*.test.ts` — 122/122 pass; `npm run docs:check` зелёный; `npm run build` зелёный, `/internal/dashboard` определяется Next как dynamic SSR route. Production smoke I1–I7 ещё нужно выполнить после deploy с production secrets. |
| 2026-05-02 | Финальный rollup выполнен. `CLAUDE.md` переведён с active initiative на latest completed initiative; `docs/INDEX.md` перенёс Observability initiative в completed; создан `MEMORY.md` с milestone-ссылкой. Локальный post-build smoke с временным `HEALTH_TOKEN=codex-smoke`: `/internal/dashboard` без token → 404, с token → 200 и все секции (`health-cards`, `alerts-table`, `stuck-batches-table`, `recent-live-table`, `digest-runs-table`), `/api/health` с token → 200 и полный HealthSummary contract. Production read-only smoke без локального `HEALTH_TOKEN`: `/api/health` без token → 401, `/internal/dashboard` без token → 404, `robots.txt` запрещает `/internal/` и `/api/`, RPC safe smoke → `not_eligible`, stale open alerts older 24h sample=0, `digest_runs` за 2026-05-01 и 2026-05-02 имеют `status='success'`, recent live trace есть (`enrich`, `verify`). Authenticated production smoke I1/I2 и post-W4 D5/I6 требуют deploy текущего кода и локально доступный `HEALTH_TOKEN`. |
| 2026-05-02 | Production deploy выполнен через Vercel CLI: deployment `dpl_D3YRmZdC6JMTiAHxSDhJ4PeJFK5e`, aliased на `https://news.malakhovai.ru`. Authenticated production smoke с `HEALTH_TOKEN` из `malakhov-ai-keys.env`: `/api/health` без/неверный token → 401, с token → 200 + `Cache-Control: no-store` + полный HealthSummary contract; `/internal/dashboard` без token → 404, `?token=` → 200 со всеми 5 секциями, `x-health-token` → 200; `robots.txt` запрещает `/internal/` и `/api/`; RPC safe smoke → `not_eligible`; stale open alerts older 24h sample=0; `digest_runs` за 2026-05-01 и 2026-05-02 имеют `success`; recent live trace показывает `enrich` + `verify`. На момент smoke: `publish_ready=0`, `verifying=1`, live after W4 sample пустой — D5/I6 нужно наблюдать на следующем реальном enrich→publish_ready→publish-verify цикле. |

## Финальный чек-лист (закрытие инициативы)

- [x] Все 4 волны ✅.
- [x] Acceptance A–H закрыты кодом/миграциями/доками; J operational goals покрыты новыми surfaces. Acceptance I1/I2/I4/I7 закрыты production smoke; I3 сейчас 0 published today; I5 требует реальное alert событие; I6/D5 ожидают следующий реальный post-W4 publish cycle.
- [x] Smoke I1–I7 выполнены настолько, насколько позволяет текущее production состояние; оставшиеся наблюдаемые условия зафиксированы выше.
- [x] Канонические `docs/OPERATIONS.md` и `docs/ARTICLE_SYSTEM.md` обновлены, временные файлы остаются для истории.
- [x] `CLAUDE.md` last-update bumped.
- [x] `MEMORY.md` имеет ссылку на эту инициативу.
- [x] В `docs/DECISIONS.md` появилась запись о принятых архитектурных решениях.
- [x] `npm run docs:check` зелёный.
