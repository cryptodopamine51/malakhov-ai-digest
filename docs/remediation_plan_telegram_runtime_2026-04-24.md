# Remediation plan: Telegram/runtime reliability, 2026-04-24

## Goal

Закрыть найденные нерабочие места без регрессий:

- убрать дубли Telegram-уведомлений;
- оставить один production runtime;
- восстановить запись статуса Telegram digest в Supabase;
- сделать отправку дайджеста идемпотентной;
- убрать зависимость Next build от внешних сайтов;
- привести окружение, security updates и observability в контролируемое состояние;
- разгрести незакоммиченный worktree без потери уже сделанной работы.

## Safety principles

1. Сначала стабилизация production, потом рефакторинг.
2. Не удалять и не останавливать legacy runtime без backup и явного понимания rollback.
3. Не смешивать incident fix, batch pipeline, дизайн и build cleanup в один PR.
4. Любая отправка в Telegram должна иметь dry-run или тестовый канал до production.
5. Любая миграция Supabase должна быть обратимой по смыслу: сначала additive schema, потом switch code.
6. Каждый шаг завершается проверкой: logs, database state, GitHub Actions, live smoke.

## Phase 0: worktree triage

Цель: не потерять текущие незакоммиченные изменения и не тащить всё одним большим коммитом.

Actions:

- Зафиксировать текущую ветку: `codex/pipeline-reliability-finish`.
- Снять полный diff в patch-файл вне git tracking, например `/tmp/malakhov-ai-digest-wip-2026-04-24.patch`.
- Разделить изменения по смыслу:
  - Telegram/runtime incident fix;
  - pipeline reliability / batch API;
  - UI/design;
  - docs;
  - generated/tmp artifacts.
- Для incident fix сделать отдельную ветку от `origin/main`, чтобы production patch был маленьким.
- Текущую большую ветку не откатывать, пока не станет понятно, какие изменения уже нужны.

Verification:

- `git status --short --branch`
- `git diff --stat`
- patch backup создан и читается.

Rollback:

- Вернуться к текущей ветке и восстановить patch, если сортировка изменений пошла не туда.

## Phase 1: immediate incident stop

Цель: уже завтра не получить три уведомления.

Actions:

- На VPS сделать backup PostgreSQL volume или `pg_dump` старой базы.
- Остановить legacy контейнеры, которые отправляют Telegram:
  - `malakhov_ai_digest_scheduler`
  - `malakhov_ai_digest_bot`, если личный бот больше не нужен как активный интерфейс.
- Если личный бот нужен для `/start`, оставить bot, но отключить scheduler. Главное: daily/weekly delivery не должен жить на VPS.
- На `origin/main` убрать backup cron из `.github/workflows/tg-digest.yml`, оставить один daily slot.
- Добавить workflow-level `concurrency`.

Verification:

- `docker ps` на VPS не показывает активный scheduler.
- В логах scheduler нет новых `send_daily_issue`.
- `gh run list --workflow tg-digest.yml` показывает один scheduled run в день после деплоя.
- В Telegram приходит только один пост в группу.

Rollback:

- Если новый контур не отправил дайджест, вручную запустить `workflow_dispatch` без `force`, после проверки DB lock.
- VPS scheduler можно поднять обратно только временно и только если Telegram delivery в новом контуре отключён.

## Phase 2: repair GitHub Supabase access

Цель: GitHub Actions должны писать служебные таблицы и обновлять `tg_sent`.

Actions:

- Перезаписать GitHub secret `SUPABASE_SERVICE_KEY` актуальным service-role JWT из Supabase.
- Добавить preflight в pipeline scripts:
  - проверить, что ключ похож на JWT;
  - декодировать payload;
  - убедиться, что `role === "service_role"`;
  - если роль неверная, падать до Telegram API.
- Добавить read/write smoke для служебной таблицы или безопасного service-only operation.
- В `bot/daily-digest.ts` после UPDATE `articles.tg_sent=true` проверять фактическое число обновлённых строк.

Verification:

- Manual GitHub Action проходит preflight.
- `digest_runs` получает новую запись `success` или `skipped`.
- Статьи из отправленного digest получают `tg_sent=true`.
- В логах нет `row-level security policy` errors.

Rollback:

- Вернуть предыдущий secret можно через GitHub secrets history нельзя, поэтому перед заменой сохранить метаданные источника ключа в приватном secure месте.
- Если preflight ломает pipeline из-за ошибочной проверки, временно отключить только preflight, не отключая idempotency lock.

## Phase 3: real Telegram idempotency

Цель: даже при двух cron, ручном retry или параллельном запуске Telegram получает максимум один daily digest на канал и дату.

Schema plan:

- Добавить таблицу `telegram_digest_runs` или расширить `digest_runs`.
- Минимальные поля:
  - `id uuid primary key`
  - `digest_date date not null`
  - `channel_id text not null`
  - `status text not null`
  - `message_hash text`
  - `article_ids uuid[]`
  - `telegram_message_id bigint`
  - `claimed_at timestamptz`
  - `sent_at timestamptz`
  - `failed_at timestamptz`
  - `error_message text`
- Добавить unique index на `(digest_date, channel_id)`.

Code plan:

- В начале `tg-digest` вычислять `digest_date` по МСК.
- До выборки/отправки делать atomic claim в DB.
- Если unique conflict, завершаться `skipped` до Telegram API.
- `FORCE_DIGEST=1` не должен обходить production lock без отдельного `FORCE_DIGEST_CONFIRM_DATE=YYYY-MM-DD`.
- После успешной отправки писать `sent_at`, `telegram_message_id`, `article_ids`, `message_hash`.
- Если Telegram API вернул ошибку, писать `failed_at` и не помечать статьи как отправленные.

Tests:

- Два последовательных запуска на одну дату: второй skip без Telegram call.
- Два параллельных запуска: только один получает claim.
- Неверный Supabase key: падение до Telegram call.
- Telegram API error: статус failed, `tg_sent` не обновляется.

Verification:

- Manual dry-run на тестовом channel id.
- Manual production run без `force`: один sent run.
- Повторный run: skipped.

Rollback:

- Оставить старый `digest_runs` read path совместимым.
- Новая таблица additive, можно отключить новый guard feature flag'ом `TG_DIGEST_DB_LOCK=0` только при emergency.

## Phase 4: decommission or isolate legacy VPS runtime

Цель: больше не иметь двух production-контуров, которые оба считают себя главными.

Actions:

- Решить роль VPS:
  - `infra-only`: VPN/proxy/Caddy для служебных задач;
  - `archived legacy`: код и база сохранены, runtime выключен;
  - `active production`: тогда нужно переносить сайт и pipeline с Vercel/Supabase, но это отдельный проект.
- Если выбран текущий канонический контур `Vercel + Supabase + GitHub Actions`, выключить:
  - Docker scheduler;
  - legacy bot daily/weekly delivery;
  - legacy API, если он не нужен.
- Оставить backups:
  - `/opt/malakhov-ai-digest/backups`;
  - compose file;
  - env file в приватном месте.
- Добавить серверный `README.RUNTIME_STATUS.md` или doc в репозитории: что на VPS больше не production.

Verification:

- `docker ps` не содержит `malakhov_ai_digest_scheduler`.
- Нет новых записей delivery в legacy Postgres.
- Telegram bot не отправляет daily issue в личку.

Rollback:

- `docker compose up -d scheduler bot` только после временного отключения GitHub `tg-digest.yml`.

## Phase 5: remove live fetch from Next render/build

Цель: `next build` не должен зависеть от Habr, ZDNet, TechCrunch и других внешних сайтов.

Actions:

- Убрать `fetchArticleContent(article.original_url)` из `app/articles/[slug]/page.tsx`.
- Использовать только media, уже сохранённые в `articles.article_videos`, `articles.article_images`, `cover_image_url`.
- Если media нет, показывать fallback без сетевого запроса.
- Проверить, что pipeline enrichment сохраняет `article_videos` и `article_images`.
- Добавить тест или grep guard, запрещающий импорт `pipeline/fetcher` в `app/**`.

Verification:

- `npm run build` не печатает `fetchArticleContent`.
- Сборка проходит без доступа к внешним article source domains.
- Article pages с видео и без видео открываются.

Rollback:

- Если media резко пропали на сайте, временно вернуть только fallback cover, но не live fetch в render path.

## Phase 6: dependency and runtime hygiene

Цель: убрать known vulnerabilities и локальные несовпадения Node.

Actions:

- Добавить `.nvmrc` с Node 20.
- Обновить `next` с `14.2.29` до `14.2.35`.
- Проверить `@mozilla/readability@0.6.0` отдельно, потому что пакет влияет на extraction.
- Прогнать:
  - `npm ci`
  - `npm run build`
  - `npm run test:pipeline-reliability`
  - `npm run test:batch-enrich`
  - `npm audit --omit=dev`

Rollback:

- Next update откатывается отдельным commit revert, если ломает build/runtime.
- Readability update не смешивать с Next update.

## Phase 7: observability cleanup

Цель: alerts должны помогать, а не копить вечные open-записи.

Actions:

- В `publish-verify` закрывать `publish_verify_failed` alert при успешной проверке статьи.
- Добавить periodic cleanup/resolution для stale alerts.
- Добавить summary query/script: open critical, open warning, stale open, last alert.
- Проверить `llm_usage_logs`: сейчас count вернулся `null`, нужно понять, это ошибка schema/query или пустая таблица без count из-за API ограничения.

Verification:

- Старые resolved проблемы получают `status=resolved`.
- Новые реальные проблемы остаются open.
- Telegram admin alerts не дублируются при cooldown.

## Proposed PR split

1. `fix/tg-runtime-incident`
   - one cron;
   - workflow concurrency;
   - Supabase role preflight;
   - update count checks;
   - docs update.

2. `fix/tg-digest-idempotency`
   - migration for digest lock;
   - atomic claim;
   - tests;
   - dry-run support.

3. `ops/decommission-legacy-vps`
   - operational doc;
   - server cleanup checklist;
   - no app code unless needed.

4. `fix/no-live-fetch-in-build`
   - remove app render dependency on `pipeline/fetcher`;
   - build guard;
   - article media fallback.

5. `chore/runtime-security`
   - `.nvmrc`;
   - Next patch update;
   - Readability update after tests.

## Do-not-break checklist

- Перед каждым PR: `git diff --stat` должен соответствовать теме PR.
- Перед production: `npm run build` на Node 20.
- Перед Telegram production run: test channel или dry-run.
- После Telegram run: проверить `digest_runs`/`telegram_digest_runs`, `articles.tg_sent`, GitHub logs.
- После VPS stop: проверить, что сайт всё ещё Vercel и Telegram group digest живёт.
- Не использовать `FORCE_DIGEST=1` в production без явной даты и причины.

