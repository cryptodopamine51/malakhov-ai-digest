# Task — post-deploy synthetic check (заэнфорсить инцидент-learning) (P2)

> Рабочий, не канонический. Источник: `docs/senior_review_2026-05-29.md` (P2.10).
> Статус: **DONE (2026-05-29).**

## Проблема
Урок инцидента 2026-05-26 (см. `CLAUDE.md`): прод-редеплой при egress-заблокированном Supabase
стирает защитный stale ISR-кеш → страницы рендерятся пустыми (`/api/feed` total:0), хотя данные в БД целы.
Сейчас урок зафиксирован только прозой — технически ничем не защищён. Прямая угроза цели №1/№2
(пустой сайт = 0 трафика и доверия).

## Цель / Definition of Done
- [x] Лента не пустая проверяется автоматически (не привязано к деплою — ловит больше классов отказа).
- [x] При `total:0` или недоступном endpoint — критический алерт в Telegram через `pipeline/alerts.ts`.
- [~] Pre-deploy guard остаётся процедурным правилом (см. `docs/OPERATIONS.md`); автоматический
  guard не делаем — pipeline-мониторы при заблокированном Supabase и так алёртят, дублирование
  лишнее.

## Что сделано
Выбран вариант 2 (cron-монитор) — меньше связности с деплоем, ловит и другие причины пустоты
(сброшенный ISR-кеш, недоступный endpoint, упавшая БД).

- `pipeline/site-feed-monitor.ts` (новый):
  - `decideFeed(snapshot)` — чистое решение: `total===0` → fire `empty_feed`;
    `!httpOk || total===null` → fire `fetch_failed`; иначе resolve `feed_ok`.
  - `fetchFeedSnapshot(feedUrl, attempts=3)` — фетч с короткими ретраями (2s), глушит
    транзиентные сетевые блипы перед критическим алёртом; `total:0` — валидный ответ, не ретраится.
  - `runSiteFeedMonitor(supabase, config)` — на fire шлёт `fireAlert({ alertType: 'site_feed_empty',
    severity: 'critical', ... })`, иначе `resolveAlert(supabase, 'site_feed_empty')`.
  - `main()` грузит `.env.local`, читает `SITE_MONITOR_URL` / `TELEGRAM_*`; exit 0 даже на fire
    (канал оповещения — Telegram, как у прочих мониторов; красный workflow на каждый тик шумит).
- `pipeline/alerts.ts` — добавлен `site_feed_empty: 1` в `COOLDOWN_HOURS` (1h дедуп).
  `fireAlert` уже устойчив к недоступной БД: при ошибке записи в `pipeline_alerts` всё равно шлёт
  Telegram — то, что нужно при заблокированном Supabase.
- `.github/workflows/site-monitor.yml` (новый) — cron `*/15 * * * *` + `workflow_dispatch`,
  concurrency `site-monitor`, `npx tsx pipeline/site-feed-monitor.ts` с секретами
  `SUPABASE_URL/SUPABASE_SERVICE_KEY/TELEGRAM_BOT_TOKEN/TELEGRAM_ADMIN_CHAT_ID` и
  `SITE_MONITOR_URL` из repo vars.
- `tests/node/site-feed-monitor.test.ts` (новый, 4 теста) — `decideFeed` для
  empty_feed / fetch_failed(HTTP 500) / fetch_failed(total null) / resolve feed_ok.

## Проверки
- `tsc` чисто, lint чисто.
- Полный прогон тестов: 250/250 pass (включая `alert-cleanup.test.ts`, который требует литерал
  `alertType: 'site_feed_empty'` в вызове `fireAlert` — поэтому строка заинлайнена, не вынесена в const).
- `npm run docs:check` green.

## Файлы
- `pipeline/site-feed-monitor.ts` (новый)
- `pipeline/alerts.ts` (cooldown)
- `.github/workflows/site-monitor.yml` (новый)
- `tests/node/site-feed-monitor.test.ts` (новый)

## Owner step
Перед включением убедиться, что в GitHub repo заданы secrets
`SUPABASE_URL/SUPABASE_SERVICE_KEY/TELEGRAM_BOT_TOKEN/TELEGRAM_ADMIN_CHAT_ID`
(те же, что у остальных pipeline-workflow'ов) и опционально repo var `SITE_MONITOR_URL`.

Docs updated: docs/OPERATIONS.md
