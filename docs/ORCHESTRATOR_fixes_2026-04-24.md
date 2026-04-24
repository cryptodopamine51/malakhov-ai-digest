---
title: Orchestrator — single source of truth для исполнения всех фиксов (2026-04-24)
status: executable playbook, версия 1
source docs:
  - docs/senior_audit_claude_2026-04-24.md
  - docs/senior_review_2026-04-24.md
  - docs/senior_audit_comparison_2026-04-24.md
  - docs/remediation_plan_telegram_runtime_2026-04-24.md
  - docs/remediation_task_breakdown_2026-04-24.md
  - docs/hotfix_plan_telegram_duplicate_2026-04-24.md
---

# Orchestrator — исполняемый playbook фиксов

Этот файл — **единственный документ**, по которому нужно исполнять фиксы. Все остальные аудиты/планы в `docs/` остаются как исторические артефакты. Если что-то противоречит, **этот файл побеждает**.

Правило: после каждого tick’а — запустить соответствующую `Verification`-секцию. Если она не зелёная, откатываться по `Rollback`.

---

## 0. State of the world на момент запуска playbook’а

### Git

- `origin/main` = `193729a` — хотфикс `fix: prevent duplicate telegram digest sends`: один cron, concurrency, `assertServiceRoleKey`, throw на digest_runs insert. **Landed, работает**.
- Рабочая ветка `codex/pipeline-reliability-finish` @ `9b3b4ac`. Расходится с `main`: хотфикс **не влит**, плюс ~30 модифицированных файлов и ~40 untracked. Untracked — это batch API (`pipeline/enrich-submit-batch.ts`, `pipeline/enrich-collect-batch.ts`, `pipeline/anthropic-batch.ts`, `pipeline/llm-usage.ts`), новые миграции 006/007/008 + RLS, тесты, новые scripts.
- Worktree грязный до начала playbook’а. Первое, что делаем, — Phase A.

### Известные причины инцидентов

- 24 апреля: три Telegram-сообщения — из-за 2 cron (на `origin/main`), неверного `SUPABASE_SERVICE_KEY` secret в GitHub (anon вместо service_role) и живого legacy scheduler на VPS `malakhov-ai-vps`.
- Сайт собирается, но `next build` тянет 250 внешних страниц через `fetchArticleContent` в render path.

### Ручные шаги, которые **нельзя** закрыть в коде

- Перезаписать GitHub secret `SUPABASE_SERVICE_KEY`.
- Остановить legacy docker-контейнеры на VPS (scheduler/bot).
- Сверить actual keys в Supabase Dashboard.

Эти шаги зовутся **OUT-OF-CODE**. Они должны быть сделаны **до** Phase B-code-items, иначе фиксы не покажут эффекта.

---

## 1. Overall PR roadmap

Работы разбиваются на 8 PR, которые нужно мерджить **в этом порядке**:

| # | Бренч | Тема | Depends on |
|---|---|---|---|
| PR-0 | (main → current) | Merge `main` → `codex/pipeline-reliability-finish` (подтянуть хотфикс) | — |
| PR-1 | `fix/tg-digest-idempotency` | UNIQUE-lock по `(digest_date, channel_id)` + atomic claim | PR-0 |
| PR-2 | `fix/no-live-fetch-in-build` | Убрать `fetchArticleContent` из `[slug]/page.tsx` + backfill скрипт | PR-0 |
| PR-3 | `fix/public-read-performance` | partial index, `.range()` в `getArticlesFeed`, split `client()` | PR-0 |
| PR-4 | `fix/pipeline-hardening-small` | recover-stuck tx, publish-verify retry, fetcher single JSDOM, rss http_status | PR-0 |
| PR-5 | `feat/batch-api-finish` | Вмержить всё untracked по batch API + tests + миграции 006/007/008 с корректным `duration_ms` | PR-0 |
| PR-6 | `chore/runtime-security` | `.nvmrc`, `next@14.2.35`, `@mozilla/readability@0.6.0`, audit fix | PR-0 |
| PR-7 | `chore/tech-debt-sweep` | security headers, /privacy stub, deepl removal, logger consolidate, ThemeToggle fix, schema.sql clean | after PR-1..5 |

PR-0 блокирует всё. PR-1 и PR-2 можно делать параллельно после PR-0. PR-3 и PR-4 — после PR-0. PR-5 — когда подтверждено, что PR-0 стабилен. PR-6 и PR-7 — финальный sweep.

Команда «не смешивать темы» (Codex): строго один PR — одна тема. Размер PR ≤ 400 строк diff.

---

## 2. OUT-OF-CODE шаги (исполняет владелец через консоль/веб)

### 2.1. Перезапись GitHub secret `SUPABASE_SERVICE_KEY`

```bash
# 1. Открыть Supabase Dashboard → Project → Settings → API
#    Скопировать Service role key (JWT, начинается на eyJ...).
# 2. Проверить, что payload содержит role=service_role:
KEY="eyJ..."
echo "$KEY" | cut -d. -f2 | tr '_-' '/+' | base64 -d 2>/dev/null | jq .role
# должно напечатать: "service_role"

# 3. Обновить GitHub secret:
gh secret set SUPABASE_SERVICE_KEY --body "$KEY" --repo <owner>/malakhov-ai-digest
```

**Verification:**
- `gh api /repos/<owner>/malakhov-ai-digest/actions/secrets/SUPABASE_SERVICE_KEY` → `"name":"SUPABASE_SERVICE_KEY"` (значение не показывается).
- После merge PR-0 сделать `gh workflow run tg-digest.yml` → job не падает на `assertServiceRoleKey`.

**Rollback:** старый secret не восстанавливается из истории GitHub. Перед перезаписью сохранить текущий value локально в зашифрованное хранилище (`pass`, `1password` CLI, `gh secret list` фиксирует хэш).

---

### 2.2. Остановка legacy VPS scheduler/bot

```bash
ssh malakhov-ai-vps
cd /opt/malakhov-ai-digest/app

# Backup БД перед любым действием
mkdir -p /opt/malakhov-ai-digest/backups
docker exec malakhov_ai_digest_db pg_dumpall -U postgres \
  > /opt/malakhov-ai-digest/backups/pg_dumpall_$(date +%Y%m%d_%H%M).sql

# Остановить только delivery-контейнеры
docker compose -f deploy/compose.production.yml stop scheduler bot

# (Опционально) задокументировать статус VPS
cat > /opt/malakhov-ai-digest/README.RUNTIME_STATUS.md <<EOF
Status: archived legacy runtime (as of 2026-04-24).
Production site: Vercel.
Production data: Supabase.
Production pipeline: GitHub Actions.

Этот VPS более не используется как основной runtime. Scheduler и bot остановлены,
чтобы не дублировать Telegram delivery. Backup базы: /opt/malakhov-ai-digest/backups.
EOF
```

**Verification:**
- `docker ps --format '{{.Names}}'` не содержит `malakhov_ai_digest_scheduler` и `malakhov_ai_digest_bot`.
- В логах `malakhov_ai_digest_scheduler` (через `docker logs --tail 100`) нет новых `send_daily_issue` после срока остановки.
- Завтрашний Telegram-digest приходит ровно один раз.

**Rollback:** `docker compose -f deploy/compose.production.yml up -d scheduler bot`, но **только** если GitHub `tg-digest.yml` временно отключён через `gh workflow disable tg-digest.yml`.

---

### 2.3. Smoke-test после OUT-OF-CODE + PR-0

```bash
# Запустить manual tg-digest вне расписания
gh workflow run tg-digest.yml --repo <owner>/malakhov-ai-digest

# Следить за выполнением
gh run watch

# Проверить, что digest_runs записался и tg_sent обновился
psql "$DATABASE_URL" <<SQL
SELECT created_at, status, articles_count
FROM digest_runs ORDER BY created_at DESC LIMIT 3;

SELECT count(*) FILTER (WHERE tg_sent) AS sent,
       count(*) FILTER (WHERE NOT tg_sent) AS unsent
FROM articles
WHERE verified_live = true AND publish_status = 'live'
  AND pub_date > now() - interval '24 hours';
SQL
```

Успех: `digest_runs.status='success'`, `tg_sent=true` у статей из сегодняшнего выпуска, Telegram-канал получил один пост.

---

## 3. Phase A — стабилизация ветки (PR-0)

### A.1. Снять страховку worktree

```bash
cd /Users/malast/malakhov-ai-digest
git stash push -u -m "wip-2026-04-24-pre-orchestrator"
git stash show -p "stash@{0}" > /tmp/malakhov-ai-digest-wip-2026-04-24.patch
git stash pop
# Файл patch’а лежит в /tmp, не тречится git’ом — это страховка на случай катастрофы.
```

### A.2. Mерж `main` в рабочую ветку

```bash
git fetch origin main
git checkout codex/pipeline-reliability-finish
git merge origin/main
```

**Ожидаемые конфликты:**
- `.github/workflows/tg-digest.yml` — взять версию из `origin/main` (один cron + concurrency).
- `bot/daily-digest.ts` — взять `main`-версию `assertServiceRoleKey`, `throw` на `digest_runs insert`, remain the getArticleUrl-cleanup из локальных изменений.

**Правило разрешения:** конфликтные hunks из `main` — accept полностью. Из локального — только то, что не пересекается с хотфиксом.

### A.3. Verification

```bash
# Хотфикс-функции должны быть в коде
grep -n "assertServiceRoleKey" bot/daily-digest.ts        # > 0
grep -n "concurrency:" .github/workflows/tg-digest.yml    # > 0
grep -c "^    - cron:" .github/workflows/tg-digest.yml    # == 1

# Тесты всё ещё зелёные
npm run test:pipeline-reliability
npm run test:batch-enrich
npm run build
```

### A.4. Rollback

```bash
git merge --abort        # пока не было conflict-resolution
# или
git reset --hard ORIG_HEAD  # после merge, но до push
```

---

## 4. Phase B — P0 code работы

### PR-1. `fix/tg-digest-idempotency` — UNIQUE-lock на (digest_date, channel_id)

**Ветка:** `fix/tg-digest-idempotency` от `codex/pipeline-reliability-finish` (после PR-0).

#### B1.1. Миграция `supabase/migrations/009_telegram_digest_lock.sql`

```sql
-- Migration 009: idempotent Telegram digest lock
-- Phase 1: additive columns + backfill
-- Phase 2: unique index (создаём в конце, после backfill)

alter table digest_runs
  add column if not exists digest_date date,
  add column if not exists channel_id text,
  add column if not exists message_hash text,
  add column if not exists article_ids uuid[],
  add column if not exists telegram_message_id bigint,
  add column if not exists claimed_at timestamptz,
  add column if not exists sent_at timestamptz,
  add column if not exists failed_at timestamptz,
  add column if not exists error_message text;

-- Backfill digest_date из created_at по МСК для уже существующих записей
update digest_runs
set digest_date = (
  (created_at at time zone 'Europe/Moscow')::date
)
where digest_date is null;

-- channel_id backfill: предполагаем, что все прошлые отправки шли в один канал
-- Заполняем значением из env через pipeline скрипт — здесь оставляем null,
-- UNIQUE ниже условный WHERE status in ('running','success') — прошлые 'skipped'/'error' не заденет.
update digest_runs
set channel_id = 'unknown'
where channel_id is null and status in ('success', 'running');

-- Ограничение состояний
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'digest_runs_status_check_v2') then
    alter table digest_runs
      add constraint digest_runs_status_check_v2
      check (status in ('running', 'success', 'skipped', 'low_articles', 'error', 'failed'));
  end if;
end $$;

-- Уникальный индекс: в один (date, channel) не может быть более одного running/success
create unique index if not exists idx_digest_runs_date_channel_live
  on digest_runs(digest_date, channel_id)
  where status in ('running', 'success');

-- Индекс для чтения статусов текущих suns
create index if not exists idx_digest_runs_date_desc
  on digest_runs(digest_date desc, created_at desc);
```

Применение (Supabase Dashboard → SQL Editor): скопировать и выполнить целиком, проверить в Table Editor.

**Verification:**
```sql
-- Новые колонки существуют
select column_name from information_schema.columns
where table_name = 'digest_runs' and column_name in
  ('digest_date','channel_id','message_hash','article_ids','telegram_message_id',
   'claimed_at','sent_at','failed_at','error_message');

-- Индекс существует
select indexname from pg_indexes
where tablename = 'digest_runs' and indexname like 'idx_digest_runs_%';
```

**Rollback:**
```sql
drop index if exists idx_digest_runs_date_channel_live;
alter table digest_runs drop constraint if exists digest_runs_status_check_v2;
-- Колонки не трогаем — безопасны при откате кода
```

#### B1.2. Переписать `bot/daily-digest.ts:main()`

**Критические куски** (псевдокод, полный файл см. в Imp plan):

```ts
// ── Atomic claim ──
async function claimDigestSlot(
  supabase: ReturnType<typeof getServerClient>,
  digestDate: string,
  channelId: string,
): Promise<{ claimed: true; runId: string } | { claimed: false; reason: string }> {
  const { data, error } = await supabase
    .from('digest_runs')
    .insert({
      digest_date: digestDate,
      channel_id: channelId,
      status: 'running',
      claimed_at: new Date().toISOString(),
    })
    .select('id')
    .single()

  if (error) {
    // 23505 = unique_violation. Значит другой запуск уже клаймил слот.
    if (error.code === '23505') {
      return { claimed: false, reason: 'already_claimed' }
    }
    throw new Error(`digest claim failed: ${error.message}`)
  }

  return { claimed: true, runId: data.id }
}

// ── После отправки ──
async function finalizeDigestSuccess(
  supabase: ReturnType<typeof getServerClient>,
  runId: string,
  telegramMessageId: number,
  articleIds: string[],
  messageText: string,
): Promise<void> {
  const hash = createHash('sha256').update(messageText).digest('hex').slice(0, 32)
  await supabase.from('digest_runs').update({
    status: 'success',
    sent_at: new Date().toISOString(),
    telegram_message_id: telegramMessageId,
    article_ids: articleIds,
    message_hash: hash,
  }).eq('id', runId)
}

// ── При ошибке ──
async function finalizeDigestFailure(
  supabase: ReturnType<typeof getServerClient>,
  runId: string,
  err: unknown,
): Promise<void> {
  await supabase.from('digest_runs').update({
    status: 'failed',
    failed_at: new Date().toISOString(),
    error_message: err instanceof Error ? err.message : String(err),
  }).eq('id', runId)
}
```

И в `main()`:

```ts
async function main(): Promise<void> {
  // ... env-проверки, assertServiceRoleKey() уже есть после PR-0 ...

  const supabase = getServerClient()
  const digestDate = getMoscowDateKey() // из lib/utils.ts
  const channelId = process.env.TELEGRAM_CHANNEL_ID!

  // 1. Atomic claim ДО всего остального
  const force = process.env.FORCE_DIGEST === '1'
  const forceConfirmDate = process.env.FORCE_DIGEST_CONFIRM_DATE
  if (force && forceConfirmDate !== digestDate) {
    logError(`FORCE_DIGEST=1 требует FORCE_DIGEST_CONFIRM_DATE=${digestDate}`)
    process.exit(1)
  }

  const claim = await claimDigestSlot(supabase, digestDate, channelId)
  if (!claim.claimed) {
    log(`Slot (${digestDate}, ${channelId}) уже занят: ${claim.reason} — выходим без отправки`)
    process.exit(0)
  }
  const runId = claim.runId

  try {
    // 2. Выборка статей, фильтрация live, формирование текста
    // ... существующая логика ...
    const messageText = buildDigestText(...)
    const telegramResponse = await sendTelegramMessage(...)
    const telegramMessageId = telegramResponse.result.message_id

    // 3. Пометить статьи tg_sent=true и проверить кол-во обновлённых
    const { data: updatedRows, error: updateErr } = await supabase
      .from('articles')
      .update({ tg_sent: true })
      .in('id', articleIds)
      .select('id')
    if (updateErr) throw new Error(`tg_sent update failed: ${updateErr.message}`)
    if ((updatedRows?.length ?? 0) !== articleIds.length) {
      throw new Error(
        `tg_sent обновил ${updatedRows?.length}/${articleIds.length} строк — вероятно RLS`
      )
    }

    // 4. Финализировать run
    await finalizeDigestSuccess(supabase, runId, telegramMessageId, articleIds, messageText)
    log(`Дайджест отправлен: ${articleIds.length} статей, run_id=${runId}`)
  } catch (err) {
    await finalizeDigestFailure(supabase, runId, err).catch(() => {/* best-effort */})
    logError('Ошибка отправки', err)
    process.exit(1)
  }
}
```

**Важно:** `sendTelegramMessage` должен возвращать объект Telegram API response. Текущая версия игнорирует `result.message_id`:

```ts
async function sendTelegramMessage(...): Promise<{ result: { message_id: number } }> {
  const res = await fetch(..., { method: 'POST', ... })
  const data = await res.json() as any
  if (!data.ok) throw new Error(data.description ?? 'Telegram API вернул ok=false')
  return data
}
```

#### B1.3. Тесты `tests/node/tg-digest-idempotency.test.ts`

Минимум 4 кейса:

```ts
import test from 'node:test'
import assert from 'node:assert/strict'

// Mock supabase.from('digest_runs').insert → duplicate → claimed=false
test('claimDigestSlot returns claimed=false on 23505', async () => { ... })

// При пустом SUPABASE_SERVICE_KEY assertServiceRoleKey падает ДО insert
test('missing service key fails before Telegram API', async () => { ... })

// После успешной отправки update статей возвращает полный count → success
test('finalizeDigestSuccess writes all metadata', async () => { ... })

// Telegram API error → finalizeDigestFailure, tg_sent не меняется
test('telegram error leaves tg_sent=false and run=failed', async () => { ... })
```

#### B1.4. Verification PR-1

```bash
# Build + тесты
npm run build
npm run test:pipeline-reliability
node --test tests/node/tg-digest-idempotency.test.ts

# Dry-run в dev (нужен тестовый канал)
FORCE_DIGEST=1 FORCE_DIGEST_CONFIRM_DATE=$(TZ=Europe/Moscow date +%Y-%m-%d) \
  TELEGRAM_CHANNEL_ID=@test_channel \
  npm run tg-digest

# Второй запуск той же датой — должен exit 0 с "already_claimed"
TELEGRAM_CHANNEL_ID=@test_channel npm run tg-digest
```

#### B1.5. Rollback PR-1

1. `git revert <merge-commit>`.
2. На Supabase не откатывать индекс мгновенно — старый код его просто игнорирует.
3. Отмонитьить hotfix не нужно; старый tg_sent-guard из main останется как fallback.

---

### PR-2. `fix/no-live-fetch-in-build` — убрать `fetchArticleContent` с рендера

**Ветка:** `fix/no-live-fetch-in-build`.

#### B2.1. Backfill скрипт `scripts/backfill-article-videos.ts`

```ts
#!/usr/bin/env tsx
import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { getServerClient } from '../lib/supabase'
import { fetchArticleContent } from '../pipeline/fetcher'

async function main() {
  const supabase = getServerClient()
  const { data: articles, error } = await supabase
    .from('articles')
    .select('id, original_url, article_videos')
    .eq('publish_status', 'live')
    .eq('verified_live', true)
    .eq('quality_ok', true)
    .is('article_videos', null)
    .limit(500)
  if (error) throw error

  console.log(`Backfill candidates: ${articles?.length ?? 0}`)
  let done = 0, failed = 0

  for (const article of articles ?? []) {
    try {
      const { inlineVideos } = await fetchArticleContent(article.original_url, { includeText: false })
      const value = inlineVideos.length > 0 ? inlineVideos : []
      const { error: upd } = await supabase
        .from('articles')
        .update({ article_videos: value })
        .eq('id', article.id)
      if (upd) throw upd
      done++
      if (done % 20 === 0) console.log(`  ...${done}`)
    } catch (e) {
      failed++
      console.error(`fail ${article.id}: ${e instanceof Error ? e.message : e}`)
    }
    await new Promise((r) => setTimeout(r, 500)) // rate-limit per source
  }

  console.log(`Done: updated=${done}, failed=${failed}`)
}

main().catch((e) => { console.error(e); process.exit(1) })
```

Запустить `npx tsx scripts/backfill-article-videos.ts` на **одном** машине (не в GH Actions, чтобы не получить ban по IP) — до merge PR-2.

#### B2.2. Правка `app/articles/[slug]/page.tsx`

**Что удалить:**
```ts
// УДАЛИТЬ импорт
import { fetchArticleContent, type ExtractedVideo } from '../../../pipeline/fetcher'
```

**Что оставить/добавить:**
```ts
// Тип ExtractedVideo вынести в lib (inline или reusable):
type ExtractedVideo = NonNullable<Article['article_videos']>[number]
```

**Что изменить в `ArticlePage`:**
```ts
// УДАЛИТЬ:
// const videosPromise = article.article_videos && article.article_videos.length > 0
//   ? Promise.resolve(article.article_videos)
//   : fetchArticleContent(article.original_url, { includeText: false })
//     .then(({ inlineVideos }) => inlineVideos)
//     .catch(() => [])

// ЗАМЕНИТЬ на:
const inlineVideos = article.article_videos ?? []

const [related, anchorLinks] = await Promise.all([
  getRelatedArticles(article.topics ?? [], article.id, 3),
  resolveAnchorLinks(article.link_anchors ?? [], article.id),
])
```

#### B2.3. ESLint guard

`.eslintrc.json`:
```json
{
  "extends": ["next/core-web-vitals", "next/typescript"],
  "overrides": [
    {
      "files": ["app/**/*.ts", "app/**/*.tsx"],
      "rules": {
        "no-restricted-imports": [
          "error",
          {
            "patterns": [
              {
                "group": ["**/pipeline/*", "../**/pipeline/*", "pipeline/*"],
                "message": "app/** не может импортировать pipeline/*. Читать контент только из БД."
              }
            ]
          }
        ]
      }
    }
  ]
}
```

#### B2.4. Ограничить `generateStaticParams`

```ts
export async function generateStaticParams() {
  // Только последние 30 дней — остальное отдаёт ISR on-demand.
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
  const supabase = getServerClient()
  const { data } = await supabase
    .from('articles')
    .select('slug')
    .eq('publish_status', 'live')
    .eq('verified_live', true)
    .not('slug', 'is', null)
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(300)
  return (data ?? [])
    .map((r) => r.slug ? toPublicArticleSlug(r.slug) : null)
    .filter((s): s is string => s !== null)
    .map((slug) => ({ slug }))
}
```

#### B2.5. Verification PR-2

```bash
# 1. Backfill прошёл
psql "$DATABASE_URL" -c "
  select count(*) filter (where article_videos is not null) as have_videos,
         count(*) filter (where article_videos is null) as no_videos
  from articles where publish_status='live' and verified_live=true"

# 2. Build не ходит на Habr/TechCrunch
npm run build 2>&1 | tee /tmp/build.log
grep -i "habr\|techcrunch\|venturebeat\|zdnet" /tmp/build.log \
  && echo "FAIL: build fetches external hosts" \
  || echo "OK: build isolated"

# 3. ESLint guard работает
npm run lint -- --max-warnings 0
```

#### B2.6. Rollback PR-2

- `git revert`.
- `article_videos` в БД не трогать — колонка уже заполнена.

---

### PR-3. `fix/public-read-performance`

**Ветка:** `fix/public-read-performance`.

#### B3.1. Миграция `010_live_articles_partial_index.sql`

```sql
-- Migration 010: partial index for public-read queries
-- Все публичные SELECT’ы фильтруют по 4 булевым колонкам.
-- Текущий idx_articles_verified_public не partial и не включает publish_status.

create index concurrently if not exists idx_articles_live_ranked
  on articles (score desc, created_at desc)
  where published and quality_ok and verified_live and publish_status = 'live';

-- Для feed-запроса дополнительно отдельный partial по pub_date
create index concurrently if not exists idx_articles_live_pub_date
  on articles (pub_date desc nulls last, created_at desc)
  where published and quality_ok and verified_live and publish_status = 'live';
```

**Важно:** `CONCURRENTLY` нельзя запустить внутри транзакции. В Supabase Dashboard SQL Editor использовать checkbox «Disable automatic wrapping in a transaction» или запускать через `supabase db push` с миграцией как отдельным файлом.

**Verification:**
```sql
-- Индексы есть
select indexname, indexdef from pg_indexes
where tablename = 'articles' and indexname like 'idx_articles_live_%';

-- EXPLAIN использует их
explain (analyze, buffers)
  select * from articles
  where published and quality_ok and verified_live and publish_status='live'
  order by score desc, created_at desc limit 12;
```

Ожидаемый план: `Index Scan using idx_articles_live_ranked` вместо Seq Scan.

#### B3.2. Разделение `lib/articles.ts:client()`

Новые функции в `lib/supabase.ts`:

```ts
let publicReadInstance: SupabaseClient | null = null

export function getPublicReadClient(): SupabaseClient {
  if (publicReadInstance) return publicReadInstance

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY
  if (!url || !key) {
    throw new Error('Supabase: NEXT_PUBLIC_SUPABASE_URL или NEXT_PUBLIC_SUPABASE_ANON_KEY не заданы')
  }
  publicReadInstance = createClient(url, key, { auth: { persistSession: false } })
  return publicReadInstance
}

// Старый getServerClient() переименовать в getAdminClient()
export function getAdminClient(): SupabaseClient {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_KEY
  if (!url || !key) throw new Error('Supabase: service key не задан')
  return createClient(url, key, { auth: { persistSession: false } })
}

// Backward-compat shim (на время миграции):
export const getServerClient = getAdminClient
```

`lib/articles.ts`:

```ts
function client() {
  // Публичные страницы читают через anon. RLS-политика уже покрывает live-материалы.
  return getPublicReadClient()
}
```

Internal routes (`app/internal/articles/[slug]/route.ts`, `pipeline/**`, `bot/**`, `scripts/**`) переводятся на `getAdminClient()`.

#### B3.3. Переписать `lib/articles.ts:getArticlesFeed`

```ts
export async function getArticlesFeed(
  page = 1,
  perPage = 12,
): Promise<{ articles: Article[]; total: number }> {
  const supabase = client()
  const offset = (page - 1) * perPage

  // Получаем total отдельно, но через dedicated partial index — быстро.
  const [{ count: total }, { data, error }] = await Promise.all([
    supabase
      .from('articles')
      .select('*', { count: 'exact', head: true })
      .eq('published', true)
      .eq('quality_ok', true)
      .eq('verified_live', true)
      .eq('publish_status', 'live'),
    supabase
      .from('articles')
      .select('*')
      .eq('published', true)
      .eq('quality_ok', true)
      .eq('verified_live', true)
      .eq('publish_status', 'live')
      .order('score', { ascending: false })
      .order('created_at', { ascending: false })
      .range(offset, offset + perPage - 1),
  ])

  if (error) {
    console.error('getArticlesFeed error:', error.message)
    return { articles: [], total: 0 }
  }

  return { articles: (data ?? []) as Article[], total: total ?? 0 }
}
```

Freshness-ranking в этом шаге **убираем** — он сдвигал реальный порядок и делался в JS. Если нужен — делать отдельной RPC `articles_feed_ranked()` или view.

#### B3.4. Снять `force-dynamic` с `app/page.tsx`

```ts
// УДАЛИТЬ:
// export const dynamic = 'force-dynamic'

// ДОБАВИТЬ:
export const revalidate = 300 // 5 минут
```

#### B3.5. Verification PR-3

```bash
# EXPLAIN + partial index (выше)

# Лейтенси главной снизилась
time curl -s -o /dev/null https://news.malakhovai.ru/ # после деплоя

# ESLint/types ok
npm run lint
npm run build
```

#### B3.6. Rollback PR-3

- `git revert` + `drop index idx_articles_live_ranked; drop index idx_articles_live_pub_date;` при проблемах с planner’ом (редко).

---

### PR-4. `fix/pipeline-hardening-small`

**Ветка:** `fix/pipeline-hardening-small`.

Набор небольших, независимых фиксов. Коммиты можно делать атомарно.

#### B4.1. `pipeline/recover-stuck.ts` — один UPDATE

Заменить двухшаговый UPDATE в цикле на:

```ts
const targetStatus = attemptCount >= RETRY_POLICY.maxAttempts ? 'failed' : 'retry_wait'

const { error } = await supabase
  .from('articles')
  .update({
    enrich_status: targetStatus,
    next_retry_at: targetStatus === 'retry_wait' ? retryAt : null,
    processing_finished_at: now,
    last_error: `lease expired (was held by ${article.processing_by ?? 'unknown'})`,
    last_error_code: 'lease_expired',
    claim_token: null,
    processing_by: null,
    lease_expires_at: null,
    updated_at: now,
  })
  .eq('id', article.id)
  .eq('enrich_status', 'processing')
  .eq('claim_token', article.claim_token ?? '')
```

`stuck` как промежуточный статус не нужен — либо retry_wait, либо failed.

#### B4.2. `pipeline/publish-verify.ts` — one-shot attempt_no

```ts
async function writeVerifyAttempt(
  supabase: ReturnType<typeof getAdminClient>,
  articleId: string,
  attemptNo: number,  // ← передаём явно
  resultStatus: 'ok' | 'retryable' | 'failed',
  errorMessage?: string,
): Promise<void> {
  await supabase.from('article_attempts').insert({
    article_id: articleId,
    stage: 'verify',
    attempt_no: attemptNo,
    ...
  })
}
```

И вызывающий код:
```ts
const prevAttempts = await countVerifyAttempts(supabase, article.id)
await writeVerifyAttempt(supabase, article.id, prevAttempts + 1, status, msg)
```

Один COUNT на статью вместо двух.

Плюс — live_sample retry вместо мгновенного fail:

```ts
} else if (isLiveSample) {
  const prevSampleFails = await countVerifyAttempts(supabase, article.id, 'verify_sample')
  if (prevSampleFails + 1 < MAX_VERIFY_ATTEMPTS) {
    await writeVerifyAttempt(supabase, article.id, prevSampleFails + 1, 'retryable', errorMsg)
    // НЕ переводим в verification_failed; только логируем
    continue
  }
  // Exhausted — только после N подряд фэйлов
  await supabase.from('articles').update({
    publish_status: 'verification_failed',
    verified_live: false,
    live_check_error: `regression after ${MAX_VERIFY_ATTEMPTS} samples: ${status ?? error}`,
  }).eq('id', article.id)
  await fireAlert({ ... })
}
```

Для этого `article_attempts.stage` расширить как `'enrich' | 'verify' | 'verify_sample'`. Миграция:

```sql
-- в PR-4 можно как отдельная 011_verify_sample_stage.sql
alter table article_attempts
  drop constraint if exists article_attempts_stage_check;
alter table article_attempts
  add constraint article_attempts_stage_check
  check (stage in ('enrich', 'verify', 'verify_sample'));
```

#### B4.3. `pipeline/fetcher.ts` — один JSDOM

```ts
export async function fetchArticleContent(...): Promise<FetchedContent> {
  // ... fetch + guard ...
  const html = await response.text()

  const virtualConsole = new VirtualConsole()
  virtualConsole.on('jsdomError', () => undefined)
  const dom = new JSDOM(html, { url, virtualConsole })
  const doc = dom.window.document

  const imageUrl = extractOgImage(html) // можно заменить на doc.querySelector('meta[property="og:image"]')
  const text = includeText ? extractReadableTextFromDocument(doc) : ''
  const tables = extractTables(doc)
  const inlineImages = extractInlineImages(doc, url)
  const inlineVideos = extractInlineVideos(doc, url)
  // ...
}

function extractReadableTextFromDocument(doc: Document): string {
  try {
    const reader = new Readability(doc.cloneNode(true) as Document)
    const article = reader.parse()
    const raw = (article?.textContent ?? '').replace(/\s+/g, ' ').trim()
    return cleanText(raw).slice(0, MAX_TEXT_LENGTH).replace(/\s[^.!?]*$/, '')
  } catch {
    return ''
  }
}
```

Readability мутирует DOM — использовать `cloneNode(true)` чтобы не сломать последующие `extractTables/Images/Videos`.

Плюс ограничение размера ответа:
```ts
const MAX_HTML_BYTES = 2_000_000
const contentLength = Number(response.headers.get('content-length') ?? 0)
if (contentLength > MAX_HTML_BYTES) {
  return { text: '', imageUrl: null, tables: [], inlineImages: [], inlineVideos: [],
           errorCode: 'fetch_failed', errorMessage: `html too large: ${contentLength}` }
}
const contentType = response.headers.get('content-type') ?? ''
if (!contentType.includes('html') && !contentType.includes('xml')) {
  return { ... errorMessage: `not html: ${contentType}` }
}
```

#### B4.4. `pipeline/rss-parser.ts` — ручной fetch для http_status

```ts
async function parseFeed(
  parser: RSSParser,
  feed: FeedConfig,
  cutoff: Date,
): Promise<{ items: ParsedItem[]; sourceResult: SourceFeedResult }> {
  const startedAt = Date.now()
  const sourceResult: SourceFeedResult = { ... status: 'failed', httpStatus: null, ... }

  try {
    const response = await fetch(feed.url, {
      headers: { 'User-Agent': 'MalakhovAIDigestBot/1.0 (+https://news.malakhovai.ru)' },
      signal: AbortSignal.timeout(20_000),
    })
    sourceResult.httpStatus = response.status
    sourceResult.responseTimeMs = Date.now() - startedAt

    if (!response.ok) {
      sourceResult.errorMessage = `HTTP ${response.status}`
      return { items: [], sourceResult }
    }

    const xml = await response.text()
    const feedData = await parser.parseString(xml)
    // ... остальное как раньше ...
  } catch (error) {
    sourceResult.errorMessage = error instanceof Error ? error.message : String(error)
    sourceResult.responseTimeMs = Date.now() - startedAt
    return { items: [], sourceResult }
  }
}
```

#### B4.5. `pipeline/claude.ts` — helper + truncation + multi-text

```ts
// В errorCode (pipeline/types.ts):
export type ErrorCode =
  | ...
  | 'claude_truncated'
  | ...

RETRYABLE_ERRORS.push('claude_truncated')

// В claude.ts:
function extractEditorialText(message: Pick<Message, 'content'>): string | null {
  const parts = message.content
    .filter((block) => block.type === 'text')
    .map((block) => (block as { text: string }).text)
  return parts.length > 0 ? parts.join('\n') : null
}

async function logUsage(
  status: string,
  usage: TokenUsage,
  ctx: EditorialUsageContext | null,
  req: EditorialRequest,
  extraMeta?: Record<string, unknown>,
): Promise<void> {
  await writeLlmUsageLog({
    provider: 'anthropic',
    model: MODEL,
    operation: ctx?.operation ?? 'editorial_sync',
    runKind: ctx?.runKind ?? 'sync',
    enrichRunId: ctx?.enrichRunId,
    articleId: ctx?.articleId,
    batchItemId: ctx?.batchItemId,
    sourceName: req.sourceName,
    sourceLang: req.sourceLang,
    originalTitle: req.originalTitle,
    resultStatus: status,
    metadata: { ...(ctx?.metadata ?? {}), ...(extraMeta ?? {}) },
    usage,
  })
}

// И truncation guard:
if (message.stop_reason === 'max_tokens') {
  await logUsage('claude_truncated', usage, usageContext, request)
  return { output: null, usage, errorCode: 'claude_truncated',
           errorMessage: 'Claude response hit max_tokens, output truncated' }
}
```

Поднять `MAX_TOKENS = 3000 → 4000` — отдельный коммит.

#### B4.6. `.github/workflows/retry-failed.yml` — добавить recover-stuck

```yaml
    - name: Recover stuck articles
      run: npm run recover-stuck
      continue-on-error: true
      env:
        SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
        SUPABASE_SERVICE_KEY: ${{ secrets.SUPABASE_SERVICE_KEY }}

    - name: Reset retry_wait articles to pending
      run: npm run retry-failed
      ...
```

#### B4.7. `bot/daily-digest.ts` — AbortController в isArticleLive + main catch

```ts
async function isArticleLive(siteUrl: string, slug: string): Promise<boolean> {
  try {
    const res = await fetch(getArticleUrl(siteUrl, slug), {
      method: 'HEAD',
      signal: AbortSignal.timeout(5_000),
    })
    return res.ok
  } catch {
    return false
  }
}

// В конце файла:
main().catch((err) => {
  logError('Unhandled error in main', err)
  process.exit(1)
})
```

#### B4.8. Verification PR-4

```bash
npm run test:pipeline-reliability
npm run test:batch-enrich
npm run build
npm run lint
```

Ручной тест recover-stuck:
```bash
# искусственно устанавливаем expired lease на одной статье
psql ... -c "update articles set enrich_status='processing',
  claim_token=gen_random_uuid(), processing_by='test',
  lease_expires_at=now() - interval '1 minute'
  where id='<uuid>'"
npm run recover-stuck
psql ... -c "select enrich_status, next_retry_at from articles where id='<uuid>'"
# Ожидаем: enrich_status='retry_wait'
```

---

## 5. Phase C — P1 (неделя)

### PR-5. `feat/batch-api-finish`

В worktree **уже лежит** весь код batch API (`pipeline/enrich-submit-batch.ts`, `pipeline/enrich-collect-batch.ts`, `pipeline/anthropic-batch.ts`, `pipeline/llm-usage.ts`, миграции 006/007/008, tests/node/batch-enrich.test.ts). Задача — собрать его в один фокусированный PR.

Steps:

1. Перед merge — выполнить миграции 006, 007, 008, RLS в Supabase.
2. **Патч-фикс в 007**: убрать ошибку `duration_ms = ::bigint * 1000`. Правильная формула — `floor(extract(epoch from (now() - coalesce(v_article.processing_started_at, now()))) * 1000)::integer`. Это миграция `011_fix_apply_duration_ms.sql`:

```sql
-- Migration 011: fix duration_ms arithmetic in apply_anthropic_batch_item_result
-- Миграция 007 использовала ::bigint * 1000 → truncation до секунды.
-- Восстанавливаем корректный расчёт как в миграции 006.

create or replace function public.apply_anthropic_batch_item_result(
  ...  -- signature как в 007 (с p_article_videos)
) returns table(applied boolean, noop boolean, state text)
language plpgsql security invoker set search_path = public
as $$
declare
  v_item anthropic_batch_items%rowtype;
  v_article articles%rowtype;
  v_attempt_no integer;
begin
  -- ... весь тело как в 007, но в блоке INSERT article_attempts:
  insert into article_attempts (...)
    select
      v_article.id, v_item.id, 'enrich', v_attempt_no,
      coalesce(v_article.processing_by, 'batch-collector'),
      v_article.claim_token,
      coalesce(v_article.processing_started_at, now()),
      now(),
      greatest(0, floor(extract(epoch from (now() - coalesce(v_article.processing_started_at, now()))) * 1000))::integer,
      ...
end $$;
```

3. Дропнуть `shouldRetryLegacyApplyRpc` fallback в `pipeline/enrich-collect-batch.ts` (после подтверждения, что 007 накатан на prod).

4. Verification:
```sql
-- Новые колонки enrich_runs
select run_kind, count(*) from enrich_runs group by run_kind;

-- Batch submit действительно работает
select count(*) as submitted_batches,
       count(*) filter (where status='completed') as done,
       max(submitted_at) as last_submit
from anthropic_batches
where submitted_at > now() - interval '24 hours';

-- Duration_ms разнообразен, не кратен 1000
select min(duration_ms), max(duration_ms), count(distinct duration_ms)
from article_attempts where stage='enrich' and duration_ms > 0;
```

### PR-6. `chore/runtime-security`

#### C.1. `.nvmrc`
```
20
```

#### C.2. `package.json`
```json
"next": "14.2.35"
```
Запуск:
```bash
npm i next@14.2.35
npm run build
npm run test:pipeline-reliability
npm audit --omit=dev | head
```

#### C.3. `@mozilla/readability` — отдельный коммит

Причина отдельности: 0.6 semver-major, меняет extraction behaviour.
```bash
npm i @mozilla/readability@^0.6.0
npx tsx scripts/check-links.ts   # verify что статьи всё ещё парсятся
# Прогнать smoke на 5 разных источниках (Habr, TechCrunch, MIT TR, vc.ru, OpenAI).
```

Если ломается — откатить только этот коммит.

### PR-7. `chore/tech-debt-sweep`

Группа мелочей, все в одном PR:

1. **Security headers** — `next.config.mjs`:
```js
const nextConfig = {
  images: { remotePatterns: [{ protocol: 'https', hostname: '**' }] },
  async headers() {
    return [{
      source: '/(.*)',
      headers: [
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
        { key: 'Strict-Transport-Security',
          value: 'max-age=63072000; includeSubDomains; preload' },
        { key: 'Permissions-Policy',
          value: 'camera=(), microphone=(), geolocation=()' },
      ],
    }]
  },
}
```

2. **`/privacy` stub** — `app/privacy/page.tsx` с коротким текстом про обработку данных, упоминание Yandex Metrika, контакт. В `robots.ts` добавить `/privacy` как allow (автоматически уже allow).

3. **Cookie consent для Metrika** — baseline вариант:
```tsx
// app/layout.tsx, вместо текущего Metrika <Script>
{METRIKA_ID && <MetrikaGate id={METRIKA_ID} />}
```
`src/components/MetrikaGate.tsx` — рендерит inline-баннер, при согласии через `localStorage.setItem('metrika-consent','yes')` подгружает скрипт. Дефолт — НЕ грузить.

4. **Удалить `pipeline/deepl.ts`**:
```bash
git rm pipeline/deepl.ts
```
Из `.github/workflows/rss-parse.yml` и `retry-failed.yml` убрать `DEEPL_API_KEY:`.

5. **Consolidated logger** — `pipeline/logger.ts`:
```ts
export function log(msg: string): void {
  console.log(`[${new Date().toTimeString().slice(0,8)}] ${msg}`)
}
export function logError(msg: string, err?: unknown): void {
  const detail = err instanceof Error ? err.message : err ? String(err) : ''
  console.error(`[${new Date().toTimeString().slice(0,8)}] ERROR: ${msg}${detail ? ' — ' + detail : ''}`)
}
```
Во всех pipeline/*.ts, bot/*.ts, scripts/*.ts заменить локальные `log()` на импорт.

6. **ThemeToggle init** — `src/components/ThemeToggle.tsx`:
```ts
import { useEffect, useLayoutEffect, useState } from 'react'

const useIsomorphicLayoutEffect =
  typeof window !== 'undefined' ? useLayoutEffect : useEffect

export default function ThemeToggle() {
  const [dark, setDark] = useState(false)

  useIsomorphicLayoutEffect(() => {
    const current = document.documentElement.getAttribute('data-theme')
    setDark(current === 'dark')
  }, [])
  // ... toggle как раньше ...
}
```

7. **`schema.sql`** — убрать «LEGACY Python/FastAPI» комментарий, заменить на:
```
-- Initial schema for the `articles` table used by the Next.js+Supabase stack.
-- Новые колонки добавляются через migrations/*.sql.
```

8. **`publish-verify` cache-buster** — `pipeline/publish-verify.ts:checkLive`:
```ts
const url = `${buildVerifyUrl(siteUrl, slug, kind)}?v=${Date.now()}`
```
Либо header `'Cache-Control': 'no-cache'`.

9. **`entities` вместо `decodeHtmlEntities`** — `npm i entities` + в `pipeline/rss-parser.ts` заменить:
```ts
import { decodeHTML } from 'entities'
// ...
const originalTitle = decodeHTML(rawTitle)
const snippet = decodeHTML(rawSnippet).slice(0, 300)
```

10. **Closing-loop для alerts** — в `pipeline/publish-verify.ts` после успеха:
```ts
await resolveAlert(supabase, 'publish_verify_failed', article.slug ?? article.id)
```

11. **Stale-alert cleaner** — `scripts/resolve-stale-alerts.ts`:
```ts
import { getAdminClient } from '../lib/supabase'
const supabase = getAdminClient()
const { data } = await supabase
  .from('pipeline_alerts')
  .update({ status: 'resolved', resolved_at: new Date().toISOString() })
  .eq('status', 'open')
  .lt('cooldown_until', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
  .select('id')
console.log(`Auto-resolved ${data?.length ?? 0} stale alerts`)
```
И добавить в `.github/workflows/pipeline-health.yml` как шаг.

### Verification PR-7

```bash
npm run build
npm run lint
curl -I https://news.malakhovai.ru/ | grep -i "strict-transport\|x-content-type\|referrer-policy"
```

---

## 6. Phase D — health dashboard и финальные штрихи

### D.1. `/api/health` endpoint

`app/api/health/route.ts`:
```ts
import { NextResponse } from 'next/server'
import { getAdminClient } from '../../../lib/supabase'

export const dynamic = 'force-dynamic'

export async function GET() {
  const sb = getAdminClient()
  const [ingest, enrich, digest, alerts, batches] = await Promise.all([
    sb.from('ingest_runs').select('finished_at, status').order('finished_at', { ascending: false }).limit(1).maybeSingle(),
    sb.from('enrich_runs').select('finished_at, status, run_kind').order('finished_at', { ascending: false }).limit(1).maybeSingle(),
    sb.from('digest_runs').select('digest_date, status, sent_at').order('created_at', { ascending: false }).limit(1).maybeSingle(),
    sb.from('pipeline_alerts').select('*', { count: 'exact', head: true }).eq('status', 'open'),
    sb.from('anthropic_batches').select('*', { count: 'exact', head: true }).eq('processing_status', 'in_progress'),
  ])
  return NextResponse.json({
    ingest: ingest.data,
    enrich: enrich.data,
    digest: digest.data,
    alerts_open: alerts.count ?? 0,
    batches_open: batches.count ?? 0,
    server_time: new Date().toISOString(),
  }, { headers: { 'Cache-Control': 'no-store' } })
}
```

Защитить `?token=` равным `HEALTH_TOKEN` env.

### D.2. README badges

```markdown
![RSS](https://github.com/<owner>/<repo>/actions/workflows/rss-parse.yml/badge.svg)
![Enrich](.../enrich.yml/badge.svg)
![Digest](.../tg-digest.yml/badge.svg)
![Health](.../pipeline-health.yml/badge.svg)
```

---

## 7. Чек-лист финальной приёмки

После всех PR:

- [ ] `origin/main` смержен в рабочую ветку, хотфикс присутствует.
- [ ] GitHub secret `SUPABASE_SERVICE_KEY` = актуальный service_role JWT.
- [ ] VPS `scheduler` и `bot` остановлены. `README.RUNTIME_STATUS.md` создан.
- [ ] Миграции 009, 010, 011 применены в Supabase.
- [ ] Ручной `gh workflow run tg-digest.yml` → один post в канал, `digest_runs.status='success'`, `tg_sent=true` у всех ids.
- [ ] Второй запуск того же дня → exit 0 `already_claimed`.
- [ ] `npm run build` чистый, без внешних fetch (`grep habr /tmp/build.log` пусто).
- [ ] ESLint-guard запрещает импорт `pipeline/**` из `app/**`.
- [ ] `EXPLAIN` публичного запроса показывает Index Scan на `idx_articles_live_ranked`.
- [ ] `lib/articles.ts:client()` использует `getPublicReadClient()` (anon).
- [ ] `pipeline_alerts` — 0 stale open.
- [ ] `anthropic_batches` — есть row за последние 24 часа.
- [ ] `article_attempts.duration_ms` — не все кратны 1000.
- [ ] `npm audit --omit=dev` — 0 high severity.
- [ ] `.nvmrc` в репо, `node -v` матчит `engines`.
- [ ] `curl -I https://news.malakhovai.ru/` показывает security headers.
- [ ] `/api/health?token=...` отвечает JSON’ом.
- [ ] `bot/bot.ts` либо webhook, либо отмечен dev-only в CLAUDE.md.

---

## 8. Риски и правила игры

1. **Не объединять PR.** Каждый PR — одна тема, ≤ 400 строк diff. Code-review даже от самого себя будет качественнее.
2. **Миграции — только additive**. Колонки не dropping. UNIQUE-индексы — только с partial WHERE по статусам.
3. **`CONCURRENTLY` для индексов**. Блокирующий CREATE INDEX на `articles` остановит приложение.
4. **Backfill `article_videos` делать с локальной машины**, не с GitHub Actions (IP ban).
5. **`FORCE_DIGEST=1` только с `FORCE_DIGEST_CONFIRM_DATE=<yyyy-mm-dd>`**. Случайный force из web UI не должен ломать idempotency.
6. **Тестовый Telegram-канал** для первых dry-run tg-digest после PR-1 — не лить сразу в production.
7. **VPS не размонтировать**, только остановить scheduler/bot. Откат через `docker compose up -d scheduler bot`.

---

## 9. Estimate

| Phase | Время (чистое) | Наружу |
|---|---|---|
| A. Merge + stash страховка | 30 мин | — |
| B. PR-1 idempotency | 3–4 ч | миграция 009 в Supabase |
| B. PR-2 no live fetch | 2–3 ч | backfill-скрипт |
| B. PR-3 perf | 2 ч | миграция 010 partial index |
| B. PR-4 hardening | 3–4 ч | миграция 011 verify_sample |
| C. PR-5 batch API | 2–3 ч (в основном review уже готового кода) | миграции 006/007/008 + fix (либо 011→012) |
| C. PR-6 security | 1 ч | npm i + audit |
| D. PR-7 tech debt | 3 ч | — |
| OUT-OF-CODE | 30 мин + smoke | перезапись secret, остановка VPS |

Итого: **2 полных рабочих дня** на всё, при условии что миграции и перезапись secret не упали в неожиданные edge cases.

---

## 10. Где лежит этот файл

Path: `/Users/malast/malakhov-ai-digest/docs/ORCHESTRATOR_fixes_2026-04-24.md`

Правило обновления: после каждого merge PR сюда коммитать 1-строчный tick в соответствующей Verification-секции (status: DONE). Старый план не удалять — он становится журналом исполнения.
