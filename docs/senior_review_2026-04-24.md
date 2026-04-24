# Senior review: Malakhov AI Digest, 2026-04-24

## Executive summary

24 апреля 2026 проблема с тремя Telegram-уведомлениями объясняется не одной ошибкой, а раздвоением runtime и сломанной идемпотентностью Telegram digest.

Фактическая картина:

- В `origin/main` workflow `.github/workflows/tg-digest.yml` имеет два scheduled cron-слота: `05:30 UTC` и `06:00 UTC`. Сегодня GitHub запустил их с задержкой в `07:15 UTC` и `07:31 UTC` (`10:15` и `10:31` МСК).
- Оба GitHub-запуска реально отправили один и тот же дайджест в Telegram-группу. Логи обоих запусков показывают одинаковый набор статей и `Дайджест отправлен: 5 статей`.
- В обоих GitHub-запусках запись в `digest_runs` упала с `new row violates row-level security policy for table "digest_runs"`.
- После обоих запусков статьи за 23 апреля в Supabase остались с `tg_sent=false`, то есть GitHub runtime не смог зафиксировать факт отправки.
- На VPS `malakhov-ai-vps` параллельно запущен старый Python/Docker runtime: `api`, `scheduler`, `bot`, `postgres`, `caddy`. Scheduler 24 апреля в `09:00` МСК собрал daily issue, а в `09:05` МСК отправил его в личного Telegram-бота.

Итого: одно уведомление в бот пришло из legacy VPS scheduler, два уведомления в группу пришли из GitHub Actions из-за двух cron-слотов и неработающего Supabase write/dedup.

## P0 findings

### 1. Production Telegram digest запускается дважды в день

На production-ветке `origin/main` workflow содержит два cron-слота:

```yaml
schedule:
  - cron: '30 5 * * *'
  - cron: '0 6 * * *'
```

Локальная текущая ветка `codex/pipeline-reliability-finish` уже содержит только один слот, но production `main` работает по старой версии. Это подтверждается `gh run list --workflow tg-digest.yml`: 22, 23 и 24 апреля были по два scheduled-запуска в день.

Предварительное исправление:

- Убрать backup schedule из `origin/main`, оставить один cron.
- Добавить `concurrency` на workflow, например `group: tg-digest-${{ github.ref }}` и `cancel-in-progress: false`, чтобы два запуска одного workflow не могли пересечься.
- Не считать второй cron безопасной страховкой. Страховка должна быть через idempotency lock в базе, а не через повторный scheduler.

### 2. Защита от дублей в `bot/daily-digest.ts` ненадёжна

Сейчас guard проверяет статьи с `tg_sent=true` и `updated_at >= now - 8h`. Это слабая защита:

- она зависит от успешного UPDATE по статьям;
- она не лочит сам daily digest до отправки;
- она не защищает от двух почти параллельных запусков;
- она не защищает от `FORCE_DIGEST=1`;
- она не имеет уникального ключа на дату дайджеста и канал.

Сегодня оба GitHub-запуска прошли guard и отправили один и тот же текст.

Предварительное исправление:

- Завести таблицу `telegram_digest_runs` или усилить `digest_runs`: поля `digest_date`, `channel_id`, `status`, `message_hash`, `sent_at`, `telegram_message_id`.
- Добавить уникальный индекс на `(digest_date, channel_id)` для успешной или claimed отправки.
- В начале запуска атомарно делать insert claim. Если конфликт, выходить до Telegram API.
- После Telegram API обновлять status на `sent`.
- Если Telegram API упал, переводить статус в `failed`, но не создавать второй live send без явного ручного recovery.

### 3. GitHub secret для Supabase, вероятно, не является service-role ключом

Логи GitHub Actions:

```text
[digest_runs insert error] new row violates row-level security policy for table "digest_runs"
```

Локальный `.env.local` содержит JWT с ролью `service_role`, и локальная проверка через этот ключ читает `digest_runs` без RLS-ошибки. Поэтому наиболее вероятная причина: GitHub secret `SUPABASE_SERVICE_KEY` содержит anon key, старый ключ или ключ от другого проекта.

Косвенное подтверждение: после GitHub-запусков за 24 апреля статьи из отправленного дайджеста в Supabase всё ещё `tg_sent=false`.

Предварительное исправление:

- Перезаписать GitHub secret `SUPABASE_SERVICE_KEY` актуальным service-role JWT из Supabase.
- Добавить runtime self-check в pipeline scripts: декодировать JWT payload и падать до работы, если `role !== "service_role"`.
- После UPDATE `tg_sent=true` делать `.select('id')` и проверять, что обновлено ровно `digest.length` строк. Если 0 строк, считать запуск failed.
- Добавить отдельный smoke workflow/manual command: insert/delete test row в служебную таблицу или read-only проверку роли через безопасный endpoint/SQL.

### 4. На VPS активен legacy Python runtime, который отправляет Telegram-сообщения

На `malakhov-ai-vps` запущены контейнеры:

```text
malakhov_ai_digest_api
malakhov_ai_digest_scheduler
malakhov_ai_digest_bot
malakhov_ai_digest_db
malakhov_ai_digest_caddy
```

Scheduler logs за 24 апреля:

```text
06:00 UTC build_daily_issue issue_id=53
06:05 UTC send_daily_issue telegram_message_id=27 status=sent
```

Это ровно `09:00` и `09:05` МСК. Публичный сайт при этом отдаётся Vercel, а не VPS (`server: Vercel`, `x-powered-by: Next.js`). То есть VPS сейчас не основной web runtime, но продолжает жить как отдельный Telegram/database/scheduler контур.

Предварительное исправление:

- Если production source of truth теперь `Vercel + Supabase + GitHub Actions`, остановить legacy scheduler и bot на VPS.
- Перед остановкой снять backup `/opt/malakhov-ai-digest/volumes/postgres`.
- Минимальный быстрый вариант: `docker compose ... stop scheduler bot`.
- Более чистый вариант: задокументировать VPS как архивный/infra-only контур, удалить автозапуск scheduler/bot, оставить только нужные VPN/proxy сервисы.

## P1 findings

### 5. Сайт во время `next build` ходит во внешние источники статей

`app/articles/[slug]/page.tsx` импортирует `fetchArticleContent` из `pipeline/fetcher` и при отсутствии `article.article_videos` делает live fetch `article.original_url` прямо в render path.

Во время `npm run build` было сгенерировано 250 статических страниц, и билд массово ходил в Habr, ZDNet, TechCrunch, OpenAI, Hugging Face и другие внешние сайты. Были таймауты, 403 и aborted requests. Билд завершился успешно, но production build не должен зависеть от доступности чужих сайтов.

Предварительное исправление:

- Запретить внешние fetches в Next render/build path.
- Всё извлечение media/video делать только в pipeline enrichment и сохранять в Supabase.
- На странице статьи использовать только `article.article_videos`, `article.article_images`, `cover_image_url`.
- Если media нет, показывать graceful fallback, но не ходить во внешний источник.

### 6. Pipeline observability есть, но status lifecycle не закрывается

В `pipeline_alerts` найдено 31 записей, последние 20 остаются `status=open`, хотя `cooldown_until` уже в прошлом. Это создаёт шум и снижает доверие к alerting.

Предварительное исправление:

- Добавить resolver/expiry для старых alerts.
- В `publish-verify` закрывать alert при успешной проверке той же статьи.
- Сделать отдельный health summary: open critical, open warning, stale open.

### 7. Batch tables есть, но пока пустые

В Supabase:

```text
anthropic_batches: 0
anthropic_batch_items: 0
```

При этом workflows `enrich.yml`, `enrich-collect-batch.yml`, `recover-batch-stuck.yml` активны. Это может быть нормально, если сейчас нет batch candidates, но требует проверки, потому что проект уже переведён на batch runtime по документации.

Предварительное исправление:

- Проверить последние `enrich_runs` по `run_kind`.
- Убедиться, что `enrich-submit-batch` реально создаёт batch rows при наличии pending статей.
- Если batch runtime ещё не включён, выключить лишние collect/recover workflows или явно зафиксировать staged rollout.

### 8. Default local Node.js не соответствует проекту

Системный Node:

```text
v18.15.0
```

`npm run build` на нём падает сразу: Next.js требует минимум `18.17.0`, а `package.json` требует Node `>=20.0.0`. С Node `20.20.0` сборка проходит.

Предварительное исправление:

- Добавить `.nvmrc` с `20.20.0` или `20`.
- В README/OPERATIONS явно указать `nvm use`.
- В CI оставить `node-version: '20'`.

### 9. Production dependencies имеют известные уязвимости

`npm audit --omit=dev` нашёл:

- `next@14.2.29`: high severity advisory set, fix доступен на `14.2.35`.
- `@mozilla/readability@0.5.x`: low severity ReDoS, fix на `0.6.0` с semver-major по пакету.

Предварительное исправление:

- Обновить Next.js до `14.2.35` и прогнать `npm run build`.
- Отдельно проверить `@mozilla/readability@0.6.0` на pipeline tests, потому что он влияет на extraction.

## P2 findings

### 10. В репозитории много активных незакоммиченных изменений

Рабочее дерево уже было грязным до ревью: десятки изменённых файлов и новые docs/workflows/migrations. Я их не откатывал. Это важно для дальнейших исправлений: production `main`, локальная ветка и VPS checkout сейчас расходятся.

Предварительное исправление:

- Перед patch-сессией выбрать базовую ветку: либо довести `codex/pipeline-reliability-finish` до PR, либо отвести отдельную ветку от `main` только под Telegram/runtime fix.
- Не смешивать дизайн, pipeline reliability, batch API и Telegram incident fix в один PR.

### 11. VPS содержит старый checkout и локальные файлы, которые легко спутать с production

На сервере:

```text
/opt/malakhov-ai-digest/app            68M
/opt/malakhov-ai-digest/volumes        75M
/opt/malakhov-ai-digest/backups        584K
/opt/malakhov-ai-digest/app/local_dev.db
/opt/malakhov-ai-digest/app/.env
```

VPS checkout находится на ветке `deploy/render-bootstrap`, commit `6d2a163`, с локально изменённым `deploy/compose.production.yml` и backup-файлом `deploy/compose.production.yml.bak-20260420`.

Предварительное исправление:

- После остановки legacy scheduler/bot оставить README на сервере с текущим статусом: archived runtime, not production.
- Перенести backup-файлы в `/opt/malakhov-ai-digest/backups`.
- Удалять файлы только после backup и подтверждения, что они не используются контейнерами.

## Проверки, которые были выполнены

- `gh run list --workflow tg-digest.yml`: подтверждены дубли scheduled-запусков 22, 23 и 24 апреля.
- `gh run view <run_id> --log`: оба запуска 24 апреля отправили одинаковый дайджест и получили RLS error на `digest_runs`.
- Supabase read через локальный `service_role`: `articles=521`, `digest_runs=10`, `pipeline_alerts=31`, `anthropic_batches=0`.
- VPS read-only inspection через SSH: активны legacy Docker containers, scheduler отправил daily issue 24 апреля в `09:05` МСК.
- `curl -I https://news.malakhovai.ru/`: публичный сайт отдаётся Vercel.
- `npm run docs:check`: ok.
- `npm run test:pipeline-reliability`: 12/12 pass.
- `npm run build` с Node 18: fail по версии Node.
- `npm run build` с Node 20.20.0: success, но build делает внешние fetch-запросы и ловит network errors.
- `npm audit --omit=dev`: 2 production vulnerabilities.

## Recommended fix order

1. Incident stop: отключить legacy VPS `scheduler` и `bot`, если текущий production должен быть только Vercel/Supabase/GitHub Actions.
2. GitHub secret repair: перезаписать `SUPABASE_SERVICE_KEY`, добавить role self-check.
3. Telegram idempotency: ввести DB lock/unique key по `digest_date + channel_id`; не полагаться на `tg_sent` как единственный guard.
4. Production workflow cleanup: довести один cron в `origin/main`, добавить concurrency.
5. Build isolation: убрать `fetchArticleContent` из Next article render path.
6. Dependency/platform hygiene: Node 20 по умолчанию, Next security update.
7. Observability cleanup: закрытие stale alerts, отдельный health summary.

