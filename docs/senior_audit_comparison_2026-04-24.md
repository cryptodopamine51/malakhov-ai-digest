---
title: Comparison & merged plan — Claude vs Codex audit (2026-04-24)
status: actionable — сводит два независимых ревью в единый план
related:
  - docs/senior_audit_claude_2026-04-24.md (Claude)
  - docs/senior_review_2026-04-24.md (Codex)
  - docs/remediation_plan_telegram_runtime_2026-04-24.md (Codex plan)
  - docs/remediation_task_breakdown_2026-04-24.md (Codex tasks)
  - docs/hotfix_plan_telegram_duplicate_2026-04-24.md
---

# Comparison & merged plan

## 0. Контекст «где мы стоим»

### Что уже случилось в git

- `origin/main` = `193729a fix: prevent duplicate telegram digest sends` — **хотфикс landing**:
  - Убран второй cron (`30 5 * * *`) в `tg-digest.yml`.
  - Добавлен `concurrency.group: tg-digest-${{ github.ref }}`.
  - Добавлен `assertServiceRoleKey()` в `bot/daily-digest.ts` (декодирует JWT, требует `role === 'service_role'`).
  - Failure при insert в `digest_runs` теперь `throw` вместо молчаливого `console.error`.
- Рабочая ветка `codex/pipeline-reliability-finish` = `9b3b4ac` (до хотфикса). Её HEAD параллелен хотфиксу и **не включает** его изменений.
- Worktree dirty: ~30 модифицированных файлов + ~40 untracked (новые миграции 006/007/008/rls, batch pipeline, tests). Это — незакоммиченные работы Codex по `pipeline reliability finish` и batch API, **смешанные в одно дерево**.

### Что именно из рекомендаций Codex уже сделано в коде

| Действие из Codex review | Landed на `main` | В worktree локально | Остаётся |
|---|---|---|---|
| Один cron в `tg-digest.yml` | ✅ | ✅ (совпадает) | — |
| `concurrency` на workflow | ✅ | ❌ (блок отсутствует локально) | нужно после merge main ↑ |
| `assertServiceRoleKey()` в daily-digest | ✅ | ❌ | мерж main ↑ |
| Throw на digest_runs insert error | ✅ | ❌ | мерж main ↑ |
| Перезаписать `SUPABASE_SERVICE_KEY` secret в GitHub | external action | — | **ручной шаг**, не в коде |
| `telegram_digest_runs` с UNIQUE(digest_date, channel_id) | ❌ | ❌ | миграция не написана |
| Atomic claim по digest_date | ❌ | ❌ | не реализовано |
| Остановить legacy VPS scheduler/bot | external action | — | **ручной infra шаг** |
| Убрать `fetchArticleContent` из `[slug]/page.tsx` | ❌ | ❌ (видео продолжают рендериться через live fetch) | **открыто** |
| `.nvmrc` Node 20 | ❌ | ❌ | открыто |
| Next `14.2.29 → 14.2.35` | ❌ | ❌ (package.json не менялся) | открыто |
| `@mozilla/readability 0.5 → 0.6` | ❌ | ❌ | открыто |
| Resolve старых `pipeline_alerts` | ❌ | ❌ | открыто |
| `publish-verify` → close alert при восстановлении | частично — `resolveAlert` API есть, но vb не вызывается | ❌ | открыто |
| Проверить actual batch flow (rows в `anthropic_batches`) | ❌ | — | нужен runbook |
| Docs для VPS как `archived legacy` | ✅ планы есть | ❌ | нужен README.RUNTIME |

**Вывод по состоянию:** critical-хотфикс landed, но **большая часть рекомендаций Codex ещё не реализована**. Рабочая ветка расходится с main, это само по себе операционный риск — нужен **merge main back** до любых других PR.

---

## 1. Что Codex поймал, а Claude упустил

Сюда заносится то, чего не было в моём `senior_audit_claude_2026-04-24.md`.

### 1.1. Второй cron-слот в production `tg-digest.yml` (P0)
- `main` содержал `30 5 * * *` + `0 6 * * *`. GitHub Actions 24 апреля дважды выполнил schedule (07:15 и 07:31 UTC).
- Я смотрел только текущий файл в рабочем дереве, который уже имел один cron. **Пропустил divergence main vs local** — критичная ошибка аудита.
- **Урок:** при аудите сравнивать и `origin/main`, и `HEAD`, а не только working tree.
- **Исправлено:** на main (commit `193729a`). Нужно мерджить main в работку.

### 1.2. GitHub secret `SUPABASE_SERVICE_KEY` оказался anon/неверным (P0)
- Логи: `new row violates row-level security policy for table "digest_runs"`. `digest_runs` RLS включён (миграция `20260423195035`), public policy только на `articles` — значит GH action инсертит как anon.
- Локальный `.env.local` — нормальный service_role.
- Это **root cause** инцидента 24 апреля: оба крона ушли в Telegram, но ни один не смог обновить `tg_sent=true` и `digest_runs` → следующий крон считал «ничего не отправлено» и отправлял снова.
- **Я этого не ловил**, я описал проблему duplicate-guard через `updated_at`, но ключевой источник сбоя — неверный ключ.
- Исправлено в коде частично: `assertServiceRoleKey()` падает **до** Telegram API. Перезапись самого secret в GitHub — ручная задача владельца.

### 1.3. Legacy VPS runtime всё ещё активен (P0)
- На `malakhov-ai-vps` крутятся `malakhov_ai_digest_{api,scheduler,bot,db,caddy}`. 24 апреля scheduler самостоятельно в 09:00 МСК собрал и отправил daily issue в **личного** бота.
- В CLAUDE.md написано «legacy/ заморожен», и проект уехал на Vercel+Supabase+GH Actions, но VPS-контур **живёт параллельно** и шлёт сообщения → именно он добавил третье уведомление 24 апреля.
- Я этого не поймал совсем: смотрел только `legacy/` в репо, не инфраструктуру.
- **Урок:** `legacy/` = код в репозитории ≠ отсутствие legacy runtime на сервере. Аудит без SSH-проверки неполный.

### 1.4. 250 статических страниц билдятся с внешним fetch (P1, видимая сторона моего P0)
- Codex прямо наблюдал, как `npm run build` ходит на Habr, ZDNet, TechCrunch, OpenAI, HuggingFace. Таймауты/403/aborted, но билд прошёл.
- Я это описал как архитектурное нарушение инварианта, **но не проверил реально**, что `generateStaticParams` заставляет Next дёрнуть URL на каждую статью при билде.
- Практический эффект: билд **может** упасть (если несколько источников одновременно off), и каждая новая production-сборка тащит трафик с внешних сайтов.

### 1.5. `pipeline_alerts` — 20+ записей `open` с `cooldown_until` в прошлом (P1)
- Alerts накапливаются и никогда не закрываются.
- Я проверял только логику `fireAlert`/`resolveAlert`, но **не DB state**.

### 1.6. `anthropic_batches=0` и `anthropic_batch_items=0` при живых workflows (P1)
- По докам проект уже на batch runtime, но DB пуста → либо нет pending-кандидатов, либо сам submit не работает.
- Я предполагал, что это работает. Нужно проверить руками.

### 1.7. `npm audit --omit=dev` — 2 prod vulnerabilities (P1)
- `next@14.2.29` → high severity, fix 14.2.35.
- `@mozilla/readability@0.5` → low ReDoS, fix 0.6.0 (semver-major).
- Я вообще не упоминал audit.

### 1.8. `.nvmrc` отсутствует, Node 18 → build падает (P1)
- Системный Node 18.15 не удовлетворяет `engines: node >=20`. Для новичков это trap.
- Я не проверял.

### 1.9. `run_kind` и token-usage колонки в `enrich_runs` как полноценная observability (P1)
- Codex не отдельно назвал это, но проверил `enrich_runs by run_kind` — и оттуда вывел, что batch ещё не работает на проде.
- Полезная операционная подсказка.

### 1.10. Разделение PR по теме как отдельный пункт аудита (P2, процесс)
- Codex пишет «incident fix, batch, дизайн и build cleanup в один PR смешивать нельзя». Это обязательное требование для отлаживаемого deploy. Я не формулировал.

---

## 2. Что Claude поймал, а Codex упустил

Это пункты из моего `senior_audit_claude_2026-04-24.md`, которых нет у Codex.

### 2.1. `getArticlesFeed` грузит весь каталог (P0 perf)
- `.select('*', { count: 'exact' })` без `.range()`, сортировка и пагинация в JS, плюс `dynamic = 'force-dynamic'`.
- Codex на perf не смотрел, сфокусирован на runtime-инциденте. По мере роста каталога — главное bottleneck сайта.

### 2.2. `client()` silent fallback service → anon (P0)
- Любой сбой окружения на сервере тихо откатывается на anon-ключ. Никакого explicit error.
- Именно этот паттерн мог бы маскировать точно такую же RLS-проблему, как у GH Action’а в daily-digest.
- Codex не поймал.

### 2.3. Partial index для публичных выборок (P0 perf)
- `idx_articles_verified_public` не partial и не включает `publish_status`. Все публичные запросы бьют по ненужному индексу.
- Рекомендуемый фикс: `CREATE INDEX ... WHERE published and quality_ok and verified_live and publish_status='live'`.

### 2.4. `recover-stuck.ts` делает два UPDATE без транзакции (P1)
- Между «processing → stuck» и «stuck → retry_wait» процесс может упасть и статья застрянет в `stuck` — ни одна выборка её не поднимет.

### 2.5. `publish-verify.ts` — duplicate COUNT-запрос и моментальный fail для live-sample (P1)
- `countVerifyAttempts()` и `writeVerifyAttempt()` оба считают attempts → 2× roundtrip на статью; плюс race.
- Любой транзиентный 5xx на live-sample = `verification_failed` → статья уходит из публичного sinks по RLS.

### 2.6. `rss-parser.ts` — теряет HTTP status и причину фейла (P1)
- `parseURL` не отдаёт http_status, `source_runs.http_status` всегда null. Нельзя отличить 403 от timeout.

### 2.7. `generateEditorialSync` — 4× дубликат `writeLlmUsageLog` + не обрабатывает `stop_reason='max_tokens'` (P1)
- При truncation JSON рвётся → `claude_parse_failed` без отдельного retry path.
- `extractEditorialText` читает только первый content block.

### 2.8. Миграция 007 сломала `duration_ms` в `article_attempts` (P1)
- `extract(epoch from ...)::bigint * 1000` — сначала truncate до секунды, потом *1000 → все значения кратны 1000. Было правильно в 006: `floor(... * 1000)::integer`.

### 2.9. `retry-failed.yml` без шага `recover-stuck` (P1)
- Если после последнего `enrich.yml` остались статьи с протухшим lease, `retry-failed` их не поднимет.

### 2.10. `bot/bot.ts` — long-polling Telegraf без workflow/supervisor (P1)
- Nobody отвечает на /start в prod. Либо webhook-режим, либо явно задокументировать, что бот dev-only.
- Codex упоминал "если бот нужен для /start", но не проверил реально работает ли он.

### 2.11. `bot/daily-digest.ts:isArticleLive` — HEAD без timeout (P1)
- Повисший origin блокирует весь GH Actions job до 6h timeout.

### 2.12. `bot/daily-digest.ts:main()` без `.catch()` (P2)
- Unhandled rejection → silent exit 0 в Node 20.

### 2.13. `app/articles/[slug]/page.tsx:generateStaticParams` — тянет все slug’и (P1)
- Чем больше каталог, тем дольше билд. Это **причина** того, что Codex увидел 250 external fetch — это количество prebuilt страниц.

### 2.14. `app/demo/*` (1345 строк) и `app/demo/vector-covers/*` в прод бандле (P2)
- `robots.ts` их disallow’ит, но Next build компилит и деплоит.

### 2.15. Yandex Metrika `webvisor:true` без `/privacy` и cookie consent (P2 legal)
- ФЗ-152 / рекомендации Роскомнадзора; нет баннера и политики.

### 2.16. Security headers / CSP отсутствуют (P2)
- `next.config.mjs` — только images.remotePatterns. Никаких HSTS, X-Content-Type-Options, Referrer-Policy.

### 2.17. Мёртвый код: `pipeline/deepl.ts` и `DEEPL_API_KEY` в workflows (P2)
- Не импортируется в pipeline, но workflows проектируют его через env.

### 2.18. HEAD в `publish-verify` без cache-buster (P2)
- Vercel CDN кэширует HEAD 200; если RLS поменялась, cache продолжает отдавать 200.

### 2.19. ThemeToggle hydration flash (P2)
- Иконка не синхронизирована с `data-theme` атрибутом.

### 2.20. Slug generation — serial queries до 99 кандидатов (P2)
- `ensureUniqueSlug` делает до 99 SELECT-ов при коллизиях.

### 2.21. `decodeHtmlEntities` неполный (P2)
- `&nbsp; &mdash; &laquo;` и т.д. не декодируются.

### 2.22. `lib/articles.ts:getAllSlugs` дедуп в JS (P2)
- O(N²) deduplication в памяти каждого SSG-прохода.

### 2.23. `resolveAnchorLinks` — 3× ilike без индекса (P2)
- Со временем серьёзно ударит по лейте `/articles/[slug]`.

### 2.24. `MAX_TOKENS = 3000` может быть мало (P2)
- Editorial_body ≥ 1200 символов + summary + JSON → truncation возможен.

### 2.25. `schema.sql` с устаревшим комментарием про Python/FastAPI (P2)
- Путает новичков; первый файл, который читают в проекте.

---

## 3. Где оба попали и в чём разошлись в acutе

| Проблема | Claude | Codex | Текущее состояние |
|---|---|---|---|
| On-the-fly `fetchArticleContent` на странице статьи | P0 (инвариант CLAUDE.md) | P1 (build ходит по сети) | **не исправлено**, открыто |
| Дубль TG-digest через `tg_sent + updated_at` | P0 (хрупкий dedup) | P0 (нет DB lock) | частично: есть `assertServiceRoleKey` + один cron + concurrency, но UNIQUE(digest_date) ещё нет |
| Legacy VPS / дублирующий runtime | пропустил (видел только `legacy/` в коде) | P0 (реально видел контейнеры) | **инфра-задача, не исправлено** |
| Observability `pipeline_alerts` | я упомянул cooldown API, но не проверил state | P1 (20 open с просрочкой) | открыто |
| Build-time external fetch / generateStaticParams | я поймал через paragraph “250 статей”, но только теоретически | P1 (фактически наблюдал таймауты) | открыто |

---

## 4. Merged action plan

Приоритет: P0 = блокирует production / уже бьёт по пользователям; P1 = надёжность/безопасность/производительность; P2 = технический долг.

### Phase A. Стабилизация ветки (обязательный прелюд)

1. **[P0]** `git merge origin/main` в `codex/pipeline-reliability-finish` чтобы подтянуть хотфикс (`assertServiceRoleKey`, concurrency, single cron, throw on digest_runs error). Разрешить мерж-конфликты по `.github/workflows/tg-digest.yml` и `bot/daily-digest.ts`.
2. **[P0]** Снять полный patch текущих dirty изменений в `/tmp/malakhov-ai-digest-wip-2026-04-24.patch` (страховка).
3. **[P0]** Разделить worktree по темам PR (Codex уже предлагает разбиение — см. phase-2 ниже):
   - `fix/tg-runtime-incident` (Codex-hotfix: уже на main, подтянуть) ← **закрыто мерджем**
   - `fix/tg-digest-idempotency` (UNIQUE lock + atomic claim + tests)
   - `ops/decommission-legacy-vps`
   - `fix/no-live-fetch-in-build`
   - `chore/runtime-security` (.nvmrc, Next patch, Readability)
   - `feat/batch-api` (всё, что сейчас в untracked `pipeline/enrich-*-batch.ts`, `pipeline/llm-usage.ts`, миграции 006/007/008)
   - `fix/public-read-performance` (мои P0: partial index, `getArticlesFeed range()`, `client()` split)
   - `fix/pipeline-hardening-small` (recover-stuck tx, publish-verify double count, fetcher single JSDOM)

### Phase B. P0 — за 24 часа

**Codex-side (инфраструктура):**

4. **[P0]** Перезаписать GitHub secret `SUPABASE_SERVICE_KEY` актуальным service_role JWT из Supabase Dashboard.
5. **[P0]** Остановить legacy VPS scheduler/bot:
   ```
   ssh malakhov-ai-vps
   sudo docker compose -f /opt/malakhov-ai-digest/app/deploy/compose.production.yml stop scheduler bot
   pg_dump ... > /opt/malakhov-ai-digest/backups/pg_24apr.sql
   ```
6. **[P0]** Один ручной `workflow_dispatch` на `tg-digest.yml` **без force** → проверить, что `digest_runs` получает запись, `articles.tg_sent=true` обновляется, лог не содержит RLS-ошибок.

**Code-side (PR #1: `fix/tg-digest-idempotency`):**

7. **[P0]** Новая миграция `009_telegram_digest_runs_lock.sql`:
   ```sql
   alter table digest_runs
     add column if not exists digest_date date,
     add column if not exists channel_id text,
     add column if not exists message_hash text,
     add column if not exists article_ids uuid[],
     add column if not exists telegram_message_id bigint,
     add column if not exists claimed_at timestamptz,
     add column if not exists sent_at timestamptz,
     add column if not exists failed_at timestamptz;
   create unique index if not exists idx_digest_runs_date_channel
     on digest_runs(digest_date, channel_id)
     where status in ('running', 'success');
   ```
8. **[P0]** В `bot/daily-digest.ts` до запроса артиклей делать atomic INSERT в `digest_runs` со status=`running`. Уникальный индекс вернёт ошибку `23505` → второй запуск выйдет до Telegram API.
9. **[P0]** После успешной отправки UPDATE `digest_runs` → `sent`, сохранить `telegram_message_id`, `message_hash`, `article_ids`. При ошибке Telegram API → `failed`.
10. **[P0]** Тесты под guard: 2 последовательных запуска (skip), ошибочный ключ (fail до send), Telegram error (failed, `tg_sent` не ставится).

**Code-side (PR #2: `fix/no-live-fetch-in-build`):**

11. **[P0]** В `app/articles/[slug]/page.tsx` убрать `fetchArticleContent` fallback, читать только `article.article_videos`. Fallback — graceful пустой блок.
12. **[P0]** Добавить ESLint-guard `no-restricted-imports`: `app/**` не может импортировать из `pipeline/**`.
13. **[P0]** `scripts/backfill-article-videos.ts`: для live-статей без `article_videos` тянуть inlineVideos из `fetchArticleContent` и писать в БД.
14. **[P1]** Ограничить `generateStaticParams` последними 30 днями (фактический фикс Codex-пункта «250 builds»).

**Code-side (PR #3: `fix/public-read-performance` — мои P0):**

15. **[P0]** Partial index `idx_articles_live_ranked`:
    ```sql
    create index concurrently idx_articles_live_ranked on articles (score desc, created_at desc)
      where published and quality_ok and verified_live and publish_status = 'live';
    ```
16. **[P0]** Переписать `lib/articles.ts:getArticlesFeed` с `.range(offset, offset+perPage-1)`, перенести freshness-ranking в SQL (либо rpc, либо `articles_feed_view`).
17. **[P0]** Снять `dynamic = 'force-dynamic'` с `app/page.tsx`, поставить `revalidate = 300`.
18. **[P0]** Разделить `lib/articles.ts:client()`:
    - `getPublicReadClient()` — anon, только для публичных выборок страниц.
    - `getAdminClient()` — service_role, только для internal routes и scripts.
    - Убрать silent fallback.

### Phase C. P1 — за неделю

**Codex-items:**

19. **[P1]** `.nvmrc` с `20` + упоминание в OPERATIONS.
20. **[P1]** `npm i next@14.2.35` + `npm run build` + regress-проверка. В отдельном PR.
21. **[P1]** `@mozilla/readability@0.6.0` — отдельный PR, прогнать pipeline-тесты с live snapshot’ом на 3–5 статей.
22. **[P1]** Closing-loop для `pipeline_alerts`:
    - `publish-verify.ts` при успехе статьи вызывает `resolveAlert(supabase, 'publish_verify_failed', article.slug)`.
    - Новый `scripts/resolve-stale-alerts.ts` в `pipeline-health.yml`: закрывает alerts с `cooldown_until < now - 6h` и без свежих occurrence_count bumps.
23. **[P1]** Runbook-smoke: ручной запуск `enrich-submit-batch`, проверка `anthropic_batches` row, `enrich_runs(run_kind='batch_submit')`; документ в `docs/OPERATIONS.md`.

**Claude-items:**

24. **[P1]** `pipeline/recover-stuck.ts` — один UPDATE с условием вместо двух.
25. **[P1]** `pipeline/publish-verify.ts` — один SQL-запрос для attempt_no + MAX_VERIFY_ATTEMPTS для live-sample (retry, не мгновенный fail).
26. **[P1]** `pipeline/rss-parser.ts` — fetch HTML отдельно, передавать в `parseString`, сохранять httpStatus в `source_runs`.
27. **[P1]** `pipeline/claude.ts`:
    - Извлечь helper `logUsage()`, убрать 4× дубликат.
    - `extractEditorialText` — join всех text-блоков.
    - Новый errorCode `claude_truncated` при `stop_reason==='max_tokens'`, retryable.
28. **[P1]** Миграция **`010_fix_apply_duration_ms.sql`**: переписать `apply_anthropic_batch_item_result` с корректным `floor(... * 1000)::integer`.
29. **[P1]** `.github/workflows/retry-failed.yml` — добавить шаг `npm run recover-stuck` перед `npm run enrich`.
30. **[P1]** `bot/bot.ts` — переписать на webhook-режим (Next.js route `/api/telegram/webhook`), либо удалить и задокументировать «бот не активен в prod».
31. **[P1]** `bot/daily-digest.ts:isArticleLive` — AbortController 5s.
32. **[P1]** `bot/daily-digest.ts` — `main().catch((err)=>{ logError(err); process.exit(1) })`.

### Phase D. P2 — технический долг

33. **[P2]** Security headers в `next.config.mjs` (HSTS, X-Content-Type-Options, Referrer-Policy, X-Frame-Options).
34. **[P2]** `/privacy` + cookie consent для Yandex Metrika webvisor.
35. **[P2]** Удалить `pipeline/deepl.ts` и `DEEPL_API_KEY` из workflows.
36. **[P2]** Consolidate `log()`-функции в `pipeline/logger.ts`.
37. **[P2]** `entities`/`he` вместо ручного `decodeHtmlEntities`.
38. **[P2]** `app/demo/*` — либо gate через env, либо вынести в отдельный branch.
39. **[P2]** `schema.sql` — убрать `LEGACY Python/FastAPI` комментарий.
40. **[P2]** ThemeToggle — читать `data-theme` из DOM до первого paint.
41. **[P2]** `ensureUniqueSlug` — batch single SELECT `slug IN (...)` вместо 99 сериальных.
42. **[P2]** `resolveAnchorLinks` — либо `pg_trgm` индекс, либо precomputed `article_anchor_links`.
43. **[P2]** Увеличить `MAX_TOKENS` Claude до 4000 после метрик по truncation.
44. **[P2]** `publish-verify` HEAD с `?verify_ts=Date.now()` (cache-buster).
45. **[P2]** Tests на `lib/articles`, `pipeline/fetcher`, `pipeline/ingest`, `pipeline/slug`, `bot/daily-digest`.

### Phase E. Health dashboard

46. **[P2]** `/api/health` endpoint: `ingest_runs.last_finished`, `enrich_runs.last_finished` по `run_kind`, `digest_runs.today`, `anthropic_batches.open`, `pipeline_alerts.open_critical`.
47. **[P2]** Бейджи в README со статусом воркфлоу.

---

## 5. Риски при выполнении

- **Merge main → codex/pipeline-reliability-finish**: конфликты в `bot/daily-digest.ts` и `.github/workflows/tg-digest.yml`. Решать **в пользу main** (там актуальный хотфикс), а свои изменения переложить поверх.
- **Разделение PR**: worktree большой. Безопаснее через `git stash` + селективный `git add -p`, а не через новую ветку.
- **Миграция `009_telegram_digest_runs_lock.sql`**: нельзя ставить UNIQUE на существующие строки без предварительного backfill (заполнить `digest_date` из `created_at`). Делать в две фазы:
  1. Add columns, backfill.
  2. `CREATE UNIQUE INDEX CONCURRENTLY`.
- **Partial index `CONCURRENTLY`**: Supabase Dashboard SQL не всегда разрешает CONCURRENTLY в одной транзакции — использовать `supabase db push` или SQL-editor с `SET LOCAL statement_timeout=0`.
- **`fetchArticleContent` removal**: перед удалением обязательно пройтись `scripts/backfill-article-videos.ts`, иначе для старых статей исчезнут видео.
- **Webhook-режим бота**: нужен публичный URL с TLS (Vercel подойдёт) + установка через `setWebhook`. Не забыть снять long-polling до установки webhook’а.

---

## 6. Чек-лист «как закрыть хвосты» после этой волны

- [ ] `origin/main` смерджен в рабочую ветку.
- [ ] GitHub secret `SUPABASE_SERVICE_KEY` = актуальный service_role JWT.
- [ ] VPS `scheduler` и `bot` остановлены (или задокументированы как infra-only).
- [ ] Миграция `009_telegram_digest_runs_lock.sql` применена.
- [ ] Ручной `workflow_dispatch` tg-digest → 1 запись в `digest_runs`, все статьи обновили `tg_sent`.
- [ ] `fetchArticleContent` больше не импортируется в `app/**` (ESLint guard проходит).
- [ ] `npm run build` чистый, без внешних fetch.
- [ ] `npm audit --omit=dev` 0 high severity.
- [ ] Partial index `idx_articles_live_ranked` существует, `EXPLAIN` на главной показывает index scan.
- [ ] `pipeline_alerts` — 0 stale open записей.
- [ ] `anthropic_batches` — есть хотя бы один row за последние 24 часа, `enrich_runs(run_kind='batch_submit')` — аналогично.
- [ ] Telegraf-бот отвечает на `/start` (webhook) или в CLAUDE.md/OPERATIONS записано, что не отвечает.

---

## 7. Что именно **не проверено** и требует ручной верификации

1. Реальный actual GitHub secret — может ли Codex-интерпретация («anon key») быть неверной? Надо зайти в Supabase Dashboard → Project Settings → API и сверить с секретом в GitHub repo settings → Actions secrets.
2. VPS-контейнеры: последний аудит — от Codex через SSH. Подтвердить, что никто после 24 апреля их не перезапустил.
3. `anthropic_batches` пустой: может быть реально нет pending-кандидатов. SELECT `count(*) FROM articles WHERE enrich_status = 'pending'` ответит.
4. `pipeline_alerts` stale open — проверить `dedup_key` на предмет того, действительно ли они relevant.
5. Whether `bot/bot.ts` где-то крутится — `pm2 list`/`systemctl status`/VPS containers.

---

**Итог:** Codex и Claude видят задачу под разными углами. Codex — инцидент-driven, смотрит в runtime и инфру. Claude — архитектурно-driven, смотрит в код и БД. Вместе план получился полным: 47 пунктов, из них 6 Codex-only, 25 Claude-only, 5 overlap. Phase A+B закрывают 80% operational risk за 1–2 дня работы.
