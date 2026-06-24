# Telegram bot reliability — диагностика и системный фикс (2026-06-24)

> Триггер от владельца: «в ТГ боте вылезают ошибки, надо поправить и сделать системно,
> чтобы эти моменты не вылезали». Цель — не залатать один баг, а закрыть **класс отказов**.

## 1. Что реально сломано (verified)

### P0 — Weekly report не работает в проде вообще
- Лог `tg-weekly-report-backup` (run 27957292485, 2026-06-22 13:44 UTC):
  ```
  weekly report claim failed: Could not find the function
  public.claim_weekly_report_run(p_article_ids, p_chat_id, p_format, p_message_hash, p_week_start)
  in the schema cache
  ```
- Прямая проверка прод-Supabase service-ключом:
  - `GET /rest/v1/weekly_report_runs` → **404** (таблицы нет)
  - `GET /rest/v1/telegram_channel_posts` → 200 (для контраста — есть)
- **Корень:** миграция `supabase/migrations/20260622073323_weekly_telegram_report.sql`
  (коммит `3c711a4`, 2026-06-22) **не была применена к прод-Supabase**. В ней одновременно:
  таблица `weekly_report_runs`, функция `claim_weekly_report_run`, и `cron.schedule('tg-weekly-report', '0 8 * * 1', …)`.
  Раз миграция не накатана → **оба** пути доставки мертвы:
  - primary: pg_cron job `tg-weekly-report` не создан → понедельничный запуск не происходит;
  - backup: GitHub Actions падает на отсутствующей функции.
- **Итог:** еженедельный отраслевой отчёт не доставлялся ни разу с момента релиза.

Код приложения корректен: сигнатура вызова в `bot/weekly-report-core.ts:444` точно совпадает
с сигнатурой функции в миграции. Баг чисто инфраструктурный (schema drift), не в коде.

### Не сломано (проверено, чтобы не чинить лишнее)
- `tg-channel-post-backup` — последние запуски success; `telegram_channel_posts` существует.
- `bot/daily-top-formats*.ts` — экспериментальный ручной инструмент (`npm run tg-daily-top`),
  без cron и run-логов, читает существующие таблицы. В прод-пайплайне не участвует.
- `bot/daily-digest-core.ts` / `bot/channel-post-core.ts` — код идентичен между старой и новой
  прод-веткой (`git diff` пуст), регрессий нет.

## 2. Системные первопричины (почему «моменты вылезают»)

| # | Класс отказа | Сейчас | Последствие |
|---|---|---|---|
| C1 | **Нет применения миграций при деплое** | Миграции коммитятся в `supabase/migrations/`, но накатываются на прод вручную и бессистемно. Ничто не сверяет схему БД с кодом. | Любая фича, зависящая от новых DB-объектов (table/function/cron), молча ломается в проде до случайного обнаружения. Ровно это и произошло с weekly report. |
| C2 | **Нет мониторинга weekly report** | У channel posts есть монитор `tg_channel_posts_missing` (`pipeline/tg-channel-monitor.ts` в pipeline-health). У weekly report — нет ничего. | Провал каждый понедельник проходит молча; владелец узнаёт случайно. |
| C3 | **Рассинхрон ref-пинов воркфлоу** | `tg-weekly-report-backup.yml` → `codex/prod-release-2026-06-17`; `tg-channel-post-backup.yml` → старый `codex/evergreen-quality-standard-2026-05-21`. OPERATIONS §Deploy всё ещё называет старую ветку прод-веткой. | Бэкап-воркфлоу могут исполнять устаревший код (сейчас спасает то, что код веток совпал — это удача, не гарантия). Миграция прод-ветки сделана наполовину. |
| C4 | **Сырой crash вместо внятного алерта** | При отсутствии DB-объекта бот падает с raw-исключением и exit 1; никакого `fireAlert` в `pipeline_alerts`. | Ошибка видна только в логах Actions, не в общей системе алертов проекта. |

## 3. План фикса

### Шаг 0 — Немедленно: накатить миграцию на прод (P0, разблокирует weekly report)
- **Кто:** владелец (DDL через REST невозможен; нужен Supabase SQL Editor или linked CLI).
- **Что:** выполнить `supabase/migrations/20260622073323_weekly_telegram_report.sql` целиком
  в Supabase Studio → SQL Editor.
- **Предусловие для pg_cron части:** в Vault должен существовать секрет `cron_bearer_token`,
  равный `CRON_SECRET` из env Vercel (route `app/api/cron/tg-weekly-report` сверяет
  `Authorization: Bearer ${CRON_SECRET}`). Если секрета нет — primary pg_cron вернёт 401;
  завести/сверить секрет.
- **Проверка после:**
  ```sql
  select jobid, jobname, schedule, active from cron.job where jobname = 'tg-weekly-report';
  select count(*) from weekly_report_runs;
  ```
  и ручной прогон: `npm run tg-weekly-report -- --week-start=2026-06-15 --format=signal --send=admin`.

### Шаг 1 — C1: schema-guard (предотвратить класс отказа)
Лёгкий runtime-preflight, проверяющий наличие обязательных DB-объектов до основной работы,
с понятным сообщением вместо raw-краша:
- Новый `pipeline/schema-guard.ts`: функция `assertDbObjects(supabase, { rpc?: string[], tables?: string[] })`,
  которая бьёт лёгкими probe-запросами (для table — `select ... limit 0`; для rpc — наличие в
  `pg_proc` через узкий select) и кидает агрегированную ошибку со списком отсутствующего.
- Подключить в начало `runWeeklyReport` (и по аналогии в channel-post / daily-digest):
  при отсутствии объектов → `fireAlert('schema_drift', …)` + явный exit с понятным текстом.
- **CI-парити-тест** `tests/node/migration-parity.test.ts`: грепом собрать все `supabase.rpc('…')`
  и `.from('…')` в `bot/` + `pipeline/`, и убедиться, что каждый идентификатор встречается в
  `supabase/migrations/*.sql` (`create … function|table`). Ловит «забыли миграцию» на этапе CI,
  а не в проде.

### Шаг 2 — C2: монитор weekly report в pipeline-health
- Новый `pipeline/tg-weekly-monitor.ts` по образцу `tg-channel-monitor.ts`:
  если сегодня понедельник (или прошёл) и за текущую ISO-неделю в `weekly_report_runs` нет строки
  со `status='success'` к, скажем, 13:00 МСК → `fireAlert('tg_weekly_report_missing', critical)`;
  при появлении success → `resolveAlert`.
- Добавить шаг запуска в `.github/workflows/pipeline-health.yml` (и продублировать env при необходимости).
- Тест `tests/node/tg-weekly-monitor.test.ts` (states: no-row / running-stale / success).

### Шаг 3 — C3: консолидация ref-пинов + актуализация Deploy-доки
- Привести `tg-channel-post-backup.yml` ref → `codex/prod-release-2026-06-17` (как у weekly).
  Внести **в обе ветки** (`codex/prod-release-2026-06-17` и `main`), т.к. scheduled-воркфлоу
  читаются с `main`.
- Пройтись по всем `.github/workflows/*.yml`: единый канонический ref-pin прод-ветки.
- Обновить `docs/OPERATIONS.md` §Deploy: зафиксировать `codex/prod-release-2026-06-17` как
  текущую прод-ветку (сейчас там старая) и добавить пункт про обязательную сверку ref-пинов.

### Шаг 4 — C1/C4: миграции как явный шаг деплоя
- В `docs/OPERATIONS.md` §Deploy добавить обязательный гейт:
  «Перед prod-deploy: если в диффе есть `supabase/migrations/*` — применить их к прод-Supabase
  и проверить наличие объектов **до** деплоя кода, который от них зависит».
- Зафиксировать порядок: миграция → проверка объектов → деплой кода/воркфлоу.

## 4. Что я могу сделать сам vs. зона владельца
- **Агент (код, в этой сессии после подтверждения):** Шаги 1, 2, 3, 4 — код, тесты, доки.
- **Владелец (внешние системы):** Шаг 0 — накатить SQL-миграцию в Supabase + сверить
  Vault-секрет `cron_bearer_token`. Деплой Vercel прод-ветки и пуш воркфлоу-правок в `main`.

## 5. Definition of Done
- [ ] **(Шаг 0, зона владельца/доступ к БД)** Миграция применена; `cron.job` содержит
      `tg-weekly-report`; Vault `cron_bearer_token` == Vercel `CRON_SECRET`; ручной weekly прогон доставлен.
- [x] `schema-guard` (`pipeline/schema-guard.ts`) + scheduled `runWeeklyReport` fail-fast + parity-тест
      (`tests/node/migration-parity.test.ts`): CI краснеет при ссылке на объект без миграции.
- [x] `tg_weekly_report_missing` монитор (`pipeline/tg-weekly-monitor.ts`) в pipeline-health,
      тесты `tests/node/tg-weekly-monitor.test.ts`.
- [x] TG backup-воркфлоу пиновы на единую прод-ветку `codex/prod-release-2026-06-17`
      (`tg-channel-post-backup.yml` перепинён). Внести в `main` при деплое.
- [x] OPERATIONS §Deploy: прод-ветка актуализирована + добавлен migration-apply гейт + ref-pin сверка.
- [x] `npm test` зелёный (428/428), `npm run build` exit 0, `npm run docs:check` ok.

## 6. Лог реализации (2026-06-24, агент)
Сделано в ветке `codex/prod-release-2026-06-17` (локально, не запушено):
- `pipeline/schema-guard.ts` (new) — `isMissingObjectError`, `findMissingTables`, `assertSchemaReady`,
  `WEEKLY_REPORT_SCHEMA`.
- `bot/weekly-report-core.ts` — guard в начале scheduled-пути (preview/dry-run не трогают БД).
- `pipeline/tg-weekly-monitor.ts` (new) + шаг в `.github/workflows/pipeline-health.yml`.
- `.github/workflows/tg-channel-post-backup.yml` — ref-pin → актуальная прод-ветка.
- Тесты: `schema-guard.test.ts`, `tg-weekly-monitor.test.ts`, `migration-parity.test.ts`.
- `docs/OPERATIONS.md` — weekly-report раздел, Deploy (ветка + migration-гейт + ref-pin сверка).

**Остаётся (требует доступа к прод-БД, которого нет у service-ключа):**
1. Накатить `20260622073323_weekly_telegram_report.sql` на прод-Supabase. Service-role JWT через
   PostgREST DDL не выполняет; нужен Postgres connection string (psql / `supabase db push`) или
   Supabase PAT (Management API). После применения проверить `cron.job` и Vault-секрет.
2. Деплой: запушить эти изменения в прод-ветку, продублировать workflow-правки и новые
   `pipeline/*.ts` в `main` (pipeline-health бежит с `main` без ref-pin), `vercel deploy --prod`.

Docs impact: `docs/OPERATIONS.md` (Deploy, branch, migration gate, weekly monitor),
возможно `docs/ARTICLE_SYSTEM.md` (weekly report ops). Финал — строкой `Docs updated: …`.
