# Hotfix plan: Telegram duplicate sends, 2026-04-24

## Objective

Сделать минимальный production hotfix, чтобы следующий daily digest не отправился три раза.

Этот hotfix должен закрыть только incident path:

- две отправки в Telegram-группу из GitHub Actions;
- одна отправка в личный бот из legacy VPS scheduler;
- отсутствие записи `digest_runs` и `tg_sent` из-за неправильного Supabase access в GitHub Actions.

Не цель этого hotfix:

- batch enrich rollout;
- redesign/UI;
- полная миграция legacy VPS;
- удаление старого кода;
- dependency upgrades;
- build/render refactor.

## Starting point

Создать отдельную ветку от production:

```bash
git fetch origin
git switch -c codex/hotfix-telegram-duplicate origin/main
```

Важно: текущую dirty ветку `codex/pipeline-reliability-finish` не использовать как базу hotfix. В ней слишком много несвязанных изменений.

Перед переключением ветки обязательно сохранить текущий worktree:

```bash
git diff > /tmp/malakhov-ai-digest-wip-2026-04-24.patch
git diff --cached > /tmp/malakhov-ai-digest-wip-2026-04-24-staged.patch
git status --short --branch > /tmp/malakhov-ai-digest-wip-2026-04-24-status.txt
```

Если есть untracked files, сохранить их списком:

```bash
git ls-files --others --exclude-standard > /tmp/malakhov-ai-digest-wip-2026-04-24-untracked.txt
```

## Allowed files

Для минимального hotfix менять только:

- `.github/workflows/tg-digest.yml`
- `bot/daily-digest.ts`
- возможно `lib/supabase.ts`, если preflight логичнее положить рядом с Supabase client
- `docs/OPERATIONS.md`
- этот hotfix plan или итоговый incident note

Не трогать:

- `app/**`
- `src/components/**`
- batch pipeline files, кроме если без этого не собирается hotfix
- migrations для полного idempotency lock
- package upgrades
- generated files и `tmp/**`

## Step 1: stop legacy scheduled delivery on VPS

Цель: убрать отправку daily issue в личный бот из старого Python runtime.

Перед остановкой:

```bash
ssh malakhov-ai-vps 'docker ps --format "table {{.Names}}\t{{.Status}}"'
ssh malakhov-ai-vps 'cd /opt/malakhov-ai-digest && mkdir -p backups && docker exec malakhov_ai_digest_db pg_dump -U malakhov_ai_digest malakhov_ai_digest > backups/postgres_before_scheduler_stop_20260424.sql'
```

Остановить scheduler:

```bash
ssh malakhov-ai-vps 'cd /opt/malakhov-ai-digest/app && docker compose --env-file /opt/malakhov-ai-digest/env/.env.production -f deploy/compose.production.yml stop scheduler'
```

Bot container:

- Если личный бот больше не нужен, остановить `bot`.
- Если `/start` нужен, оставить `bot`, но проверить, что он не отправляет scheduled daily/weekly сам. По текущим логам scheduled delivery делает `scheduler`, не `bot`.

Проверка:

```bash
ssh malakhov-ai-vps 'docker ps --format "table {{.Names}}\t{{.Status}}"'
ssh malakhov-ai-vps 'docker logs --since 10m malakhov_ai_digest_scheduler 2>&1 | tail -80'
```

Rollback:

```bash
ssh malakhov-ai-vps 'cd /opt/malakhov-ai-digest/app && docker compose --env-file /opt/malakhov-ai-digest/env/.env.production -f deploy/compose.production.yml start scheduler'
```

Rollback использовать только если GitHub Telegram delivery временно отключён, иначе снова будет два runtime.

## Step 2: reduce GitHub schedule to one daily run

В `.github/workflows/tg-digest.yml` на `origin/main` сейчас два cron-слота:

```yaml
- cron: '30 5 * * *'
- cron: '0 6 * * *'
```

Оставить один:

```yaml
- cron: '0 6 * * *'
```

Добавить concurrency:

```yaml
concurrency:
  group: tg-digest-${{ github.ref }}
  cancel-in-progress: false
```

Почему `cancel-in-progress: false`: если один запуск уже идёт, второй должен ждать/не стартовать в параллельную отправку, а не убивать процесс посередине Telegram/API операций.

Проверка:

```bash
gh workflow view tg-digest.yml --yaml
```

После merge:

```bash
gh run list --workflow tg-digest.yml --limit 10
```

## Step 3: add Supabase service-role preflight

Проблема из логов:

```text
[digest_runs insert error] new row violates row-level security policy for table "digest_runs"
```

Hotfix-level защита: до Telegram API проверить, что `SUPABASE_SERVICE_KEY` действительно service-role JWT.

Логика:

- взять `process.env.SUPABASE_SERVICE_KEY`;
- split по `.`;
- decode payload через `Buffer.from(payload, 'base64url')`;
- проверить `role === "service_role"`;
- если нет, вывести понятную ошибку и `process.exit(1)`;
- не отправлять Telegram до этой проверки.

Acceptance:

- При anon key скрипт падает до `sendTelegramMessage`.
- При service-role key скрипт продолжает работу.

## Step 4: make DB writes fail loudly

Сейчас `digest_runs` insert error только логируется, а workflow всё равно success.

Hotfix behavior:

- Если после Telegram send не удалось обновить `tg_sent`, workflow должен завершиться ошибкой.
- Если не удалось вставить `digest_runs` success, workflow должен завершиться ошибкой.
- Для skipped logs можно оставить non-fatal, но лучше тоже сделать visible warning.

Важно: этот шаг не заменяет полноценный idempotency lock. Он только делает проблему видимой и не даёт GitHub Actions показывать success при сломанной записи в БД.

Acceptance:

- Неверные RLS/secret больше не выглядят как successful delivery.
- После успешного delivery в Supabase есть `digest_runs.status=success`.
- У отправленных статей `tg_sent=true`.

## Step 5: repair GitHub secret

Через GitHub secrets заменить `SUPABASE_SERVICE_KEY` актуальным service-role key из Supabase.

Команда, если локальный `.env.local` уже содержит правильный ключ:

```bash
set -a
source .env.local
set +a
gh secret set SUPABASE_SERVICE_KEY --body "$SUPABASE_SERVICE_KEY"
```

Проверка без раскрытия секрета:

```bash
gh secret list --repo cryptodopamine51/malakhov-ai-digest
```

Потом manual run `tg-digest.yml` лучше делать только после idempotency/preflight patch. Если нужно проверить только доступ, добавить временный безопасный DB preflight step или использовать отдельный local check.

## Step 6: validation before merge

Локально:

```bash
npm run test:pipeline-reliability
npm run docs:check
env PATH=/Users/malast/.nvm/versions/node/v20.20.0/bin:$PATH npm run build
```

Ожидаемо:

- tests pass;
- docs check pass;
- build pass;
- build может ещё печатать `fetchArticleContent` до отдельного fix, это не блокер hotfix, если не падает.

GitHub:

- открыть PR только с allowed files;
- проверить diff вручную;
- после merge проверить `gh run list --workflow tg-digest.yml`.

Telegram/Supabase smoke:

- manual run делать осторожно, потому что он может отправить production digest;
- предпочтительно временно проверить на test channel через отдельный secret/branch или добавить dry-run в следующем PR;
- если production manual run всё-таки нужен, сначала убедиться, что за текущую дату ещё не было успешной отправки.

## Completion criteria

Hotfix считается готовым, когда:

- VPS scheduler остановлен или не имеет scheduled delivery;
- production `tg-digest.yml` имеет один cron;
- workflow имеет concurrency;
- `bot/daily-digest.ts` падает до Telegram API при неверном Supabase role;
- successful delivery не считается успешным, если `tg_sent` или `digest_runs` не записались;
- GitHub secret `SUPABASE_SERVICE_KEY` обновлён;
- следующий scheduled run создаёт один Telegram post, один `digest_runs.success`, и помечает выбранные статьи `tg_sent=true`.

## Follow-up after hotfix

После hotfix отдельными PR:

- полноценный DB idempotency lock через `telegram_digest_runs`;
- убрать live fetch из Next article render/build;
- dependency/security updates;
- stale alerts cleanup;
- окончательно заархивировать или удалить legacy VPS runtime.

