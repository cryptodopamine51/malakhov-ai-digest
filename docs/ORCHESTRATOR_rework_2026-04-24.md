---
title: Orchestrator fixes — доработки после прохода Codex (2026-04-24)
status: actionable punchlist
source: docs/ORCHESTRATOR_fixes_2026-04-24.md
reviewed_branch: codex/pipeline-reliability-finish @ 7d240d1 + uncommitted working tree
reviewer: Opus 4.7
---

# Доработки к проходу Codex по Orchestrator (2026-04-24)

Короткое резюме: **код в целом правильный и все проверки зелёные**, но есть два процессных прокола, из-за которых нельзя сразу переходить к OUT-OF-CODE шагам. Этот документ — явный punchlist того, что нужно доделать до ручных шагов (secret / VPS / migrations / backfill / tg-digest smoke).

Исходный план: `docs/ORCHESTRATOR_fixes_2026-04-24.md`.

---

## 0. Что проверено и работает

**Код, соответствующий плану:**

- PR-0 merge `origin/main` в `codex/pipeline-reliability-finish` (`7d240d1`); хотфикс `193729a` присутствует.
- PR-1 idempotency:
  - `supabase/migrations/009_telegram_digest_lock.sql`
  - `bot/daily-digest.ts:254-321` — `claimDigestSlot`, `finalizeDigestSuccess`, `finalizeDigestFailure`
  - `bot/daily-digest.ts:397` — `assertServiceRoleKey()` ДО всего остального
  - `bot/daily-digest.ts:407-411` — `FORCE_DIGEST_CONFIRM_DATE` guard
  - `bot/daily-digest.ts:133-135` — `sendTelegramMessage` возвращает `result.message_id`
- PR-2 no-live-fetch:
  - `app/articles/[slug]/page.tsx` — `fetchArticleContent` удалён, `inlineVideos = article.article_videos ?? []`
  - `generateStaticParams` ограничен 30 днями + `limit(300)`
  - `scripts/backfill-article-videos.ts`
  - `.eslintrc.json` — `no-restricted-imports` на `pipeline/*` из `app/**`
- PR-3 performance:
  - `supabase/migrations/010_live_articles_partial_index.sql` (CONCURRENTLY)
  - `lib/supabase.ts:286,302` — `getPublicReadClient`, `getAdminClient` (с backward-compat shim `getServerClient = getAdminClient`)
  - `lib/articles.ts:11-12` — `client()` использует `getPublicReadClient()`
  - `lib/articles.ts:175-205` — `getArticlesFeed` через `.range()` + `count: 'exact', head: true`
  - `app/page.tsx:7` — `export const revalidate = 300` вместо `force-dynamic`
- PR-4 hardening:
  - `pipeline/fetcher.ts` — одиночный JSDOM + Readability с `cloneNode`, `MAX_HTML_BYTES=2_000_000`, content-length/content-type guards
  - `pipeline/rss-parser.ts` — ручной `fetch` для заполнения `http_status`
  - `pipeline/claude.ts` — `MAX_TOKENS=4000`, `claude_truncated` error-code, `extractEditorialText`
  - `pipeline/recover-stuck.ts` — один UPDATE, без промежуточного `stuck`
  - `pipeline/publish-verify.ts` — cache-buster `?v=${Date.now()}`
  - `bot/daily-digest.ts:141-150` — `isArticleLive` с `AbortSignal.timeout(5000)`
  - `.github/workflows/retry-failed.yml:26-27` — шаг `Recover stuck articles`
  - `supabase/migrations/011_verify_sample_stage.sql` — `verify_sample` в `article_attempts.stage` CHECK
- PR-5 batch API:
  - `pipeline/{anthropic-batch,enrich-submit-batch,enrich-collect-batch,llm-usage,cost-guard,recover-batch-stuck}.ts`
  - `supabase/migrations/006_anthropic_batch_enrich.sql`, `007_article_videos.sql`, `008_llm_usage_observability.sql`
  - `supabase/migrations/012_fix_apply_duration_ms.sql` — корректный `floor(extract(epoch …) * 1000)`
  - `supabase/migrations/20260423195035_enable_public_article_rls.sql`
- PR-6 runtime:
  - `.nvmrc` = `20`
  - `@mozilla/readability@^0.6.0`
  - `entities@^8.0.0`
- PR-7 tech debt:
  - `next.config.mjs:17-29` — security headers (HSTS, X-CTO, X-Frame-Options, Referrer-Policy, Permissions-Policy)
  - `app/privacy/page.tsx`
  - `src/components/MetrikaGate.tsx`
  - `pipeline/deepl.ts` удалён, `DEEPL_API_KEY` вычищен из workflows
  - `src/components/ThemeToggle.tsx` — `useIsomorphicLayoutEffect`
  - `scripts/resolve-stale-alerts.ts`
  - `pipeline/rss-parser.ts` — `decodeHTML` из `entities`
- Phase D:
  - `app/api/health/route.ts` с `HEALTH_TOKEN` gate

**Зелёные проверки:**

- `npm run lint` — 0 warnings/errors
- `npx tsx --test tests/node/tg-digest-idempotency.test.ts` — 4/4 pass
- `npm run test:pipeline-reliability` — 12/12 pass
- `npm run test:batch-enrich` — 7/7 pass
- `npm run build` — чистый, 334 страницы, без внешних fetch в логе
- `npm audit --omit=dev` — 0 vulnerabilities

---

## 1. Блокер #1 — Всё лежит uncommitted, как одна монолитная диффа

### Что видно в git

```
Branch: codex/pipeline-reliability-finish
Ahead of origin by: 4 старых коммита (хотфикс + merge, ничего нового)
Modified: 46 файлов
Untracked: ~30 файлов (batch API, миграции 006–012, тесты, scripts, docs)
Diff total: ~2027 вставок / ~1587 удалений в working tree
```

### Почему это проблема

Orchestrator (`docs/ORCHESTRATOR_fixes_2026-04-24.md §1 + §8 п.1`) явно требовал:

> Работы разбиваются на 8 PR, которые нужно мерджить в этом порядке.
> Команда «не смешивать темы» (Codex): строго один PR — одна тема. Размер PR ≤ 400 строк diff.

Сейчас фиксы PR-1 … PR-7 **слиплись в один working tree**, нет ни веток, ни коммитов, ни PR. Это значит:

- Code review невозможен — ревьюеру предъявить нечего, кроме голой дельты.
- Откат отдельной темы невозможен — только `git checkout -- .`, что убьёт всё.
- Orchestrator §2.3 smoke-test запускает `gh workflow run tg-digest.yml` на уже отмёржанной ветке — но она не существует.
- Rollback-секции PR-1..PR-7 (каждая опирается на `git revert <merge-commit>`) не применимы.

### Что делать — варианты

**Вариант A (честный, по плану).** Разбить working tree на 7 веток/PR. Используем `git add -p` + серию `git stash`/`git worktree`. Примерная последовательность:

1. Временно уйти в `git stash push -u -m "wip-full-orchestrator"`.
2. Для каждой темы в orchestrator'е завести ветку от текущего HEAD:
   - `fix/tg-digest-idempotency` — миграция 009 + правки `bot/daily-digest.ts` + `tests/node/tg-digest-idempotency.test.ts` + изменения в `pipeline-reliability.test.ts` (если относятся к idempotency)
   - `fix/no-live-fetch-in-build` — `app/articles/[slug]/page.tsx` + `scripts/backfill-article-videos.ts` + `.eslintrc.json`
   - `fix/public-read-performance` — миграция 010 + `lib/articles.ts` + `lib/supabase.ts` (split client) + `app/page.tsx` revalidate + `app/internal/articles/[slug]/route.ts`
   - `fix/pipeline-hardening-small` — миграция 011 + `pipeline/{fetcher,rss-parser,claude,recover-stuck,publish-verify,types,enricher,provider-guard,claims,alerts,retry-failed,slug}.ts` + `bot/daily-digest.ts:isArticleLive` + `.github/workflows/retry-failed.yml`
   - `feat/batch-api-finish` — все untracked `pipeline/{anthropic-batch,enrich-submit-batch,enrich-collect-batch,llm-usage,cost-guard,recover-batch-stuck}.ts` + миграции 006/007/008/012 + RLS + `tests/node/batch-enrich.test.ts` + workflow `enrich-collect-batch.yml` + `recover-batch-stuck.yml`
   - `chore/runtime-security` — `.nvmrc` + bump зависимостей (см. Блокер #2 ниже)
   - `chore/tech-debt-sweep` — `next.config.mjs` headers + `/privacy` + `MetrikaGate` + `ThemeToggle` + `pipeline/deepl.ts` delete + `scripts/resolve-stale-alerts.ts` + cache-buster + `decodeHTML` + `schema.sql` cleanup + `CLAUDE.md` rewrite + docs-guard workflow + все `docs/*.md` untracked
   - `feat/health-endpoint` — `app/api/health/route.ts`

3. Каждый PR — ≤ 400 строк diff. Если превышает, дробить дальше.
4. Мерджить в порядке из orchestrator §1.

**Вариант B (прагматичный компромисс).** Коммитить не 7 PR, а 3 атомарных коммита в одной ветке + открыть 1 PR, но с явной согласованной с владельцем фиксацией: «план по 7 PR не выполнен, делаем одним большим PR». Тогда в этом документе надо явно проставить decision log. Риск — тяжёлый code review.

**Вариант C (минимум).** Принять как есть, закоммитить единым коммитом «orchestrator fixes 2026-04-24» и сразу идти в OUT-OF-CODE. Формально нарушает orchestrator §8 п.1; допустимо только если владелец осознанно снимает требование.

**Рекомендация:** Вариант A или B. Вариант C → только с письменным снятием требования.

### Acceptance

- `git log --oneline origin/main..HEAD` показывает ≥ 3 новых коммита с осмысленными сообщениями.
- `git diff main..HEAD --stat` на каждой отдельной ветке ≤ 400 строк (для Варианта A).
- Все rollback-секции orchestrator'а снова применимы (`git revert <hash>` работает).

---

## 2. Блокер #2 — Next.js 14.2.29 → 15.5.15 вместо pin на 14.2.35

### Что случилось

В `package.json`:

```
-    "next": "14.2.29",
+    "next": "^15.5.15",
-    "eslint-config-next": "14.2.29",
+    "eslint-config-next": "^15.5.15",
```

Orchestrator PR-6 (`§5`) предписывал:

> `npm i next@14.2.35` — security pin внутри 14.x.
> `npm i @mozilla/readability@^0.6.0` — отдельным коммитом, semver-major.

То есть план был **pinned minor bump** в пределах 14.x. Codex сделал **major version bump до 15.5.15** — это совсем другая история:

- меняется runtime (React Server Components semantics, caching defaults, `dynamic` семантика и т.п.);
- `CLAUDE.md` после переписывания всё ещё содержит строку «Next.js 14, App Router» (рассинхрон с реальностью);
- в `CLAUDE.md» таблица стека и вся документация опирается на Next.js 14;
- нет отдельного коммита/PR с smoke-test и rollback — orchestrator'ом это вообще не предусмотрено.

Формально build проходит, сайт рендерится (334 страницы), но это **крупное scope-расширение без санкции плана**.

### Что делать — варианты

**Вариант A (вернуться к плану).** Откатить Next.js до 14.2.35:

```bash
npm i next@14.2.35 eslint-config-next@14.2.35
npm run build
npm run lint
npm run test:pipeline-reliability
npm run test:batch-enrich
npx tsx --test tests/node/tg-digest-idempotency.test.ts
```

Если всё зелёное — это восстановленный scope PR-6. Major upgrade на 15 можно оформить отдельной волной позже.

**Вариант B (сознательно остаться на 15).** Принять апгрейд как отдельное решение, но:

- завести `docs/DECISIONS.md` запись: «2026-04-24 — upgrade Next.js 14 → 15.5.15 в рамках orchestrator fixes. Причина: <что именно>. Риски: <что проверено>.»
- выделить апгрейд в отдельный коммит/PR `chore/nextjs-15-upgrade`
- в `CLAUDE.md` поменять «Next.js 14, App Router» → «Next.js 15, App Router»
- прогнать ручной smoke на dev: `/`, `/articles/[slug]`, `/sources/[source]`, `/topics/[topic]`, `/privacy`, `/api/health`, `/rss.xml`, `/llms.txt`, `/robots.txt`, `/sitemap.xml`
- проверить, что Vercel билд тоже зелёный (dry-run `vercel build --prod`)
- сверить, что `force-dynamic`/`revalidate`/`generateStaticParams` ведут себя в 15 так же, как предполагала миграция PR-3

**Рекомендация:** обсудить с владельцем. В orchestrator'е 15.x не было — по умолчанию Вариант A.

### Acceptance

- `grep '"next"' package.json` совпадает с принятым решением (14.2.35 **или** 15.5.15 с зафиксированным решением в `docs/DECISIONS.md`).
- `CLAUDE.md` отражает актуальную мажорную версию.
- Если остаёмся на 15 — в `docs/DECISIONS.md` есть ADR с причиной, рисками, smoke-планом.

---

## 3. Мелочи, которые стоит вычистить одним проходом

Не блокеры, но чтобы не возвращаться:

| # | Что | Файл | Фикс |
|---|---|---|---|
| 3.1 | `CLAUDE.md` говорит «Next.js 14» | `CLAUDE.md` строка таблицы стека | Синхронизировать с package.json после решения по Блокеру #2 |
| 3.2 | `tsconfig.json` получил `"target": "ES2017"` | `tsconfig.json` | Убедиться, что это намеренно (в плане не было); если да — оставить, если нет — откатить |
| 3.3 | Untracked `docs/*.md` (senior_audit, remediation, hotfix, etc.) не тречатся git'ом | `docs/` | Решить: закоммитить как исторические артефакты или `.gitignore` |
| 3.4 | `docs/ARCHITECTURE.md`, `docs/ARTICLE_SYSTEM.md`, `docs/OPERATIONS.md`, `docs/PROJECT.md`, `docs/DECISIONS.md`, `docs/INDEX.md` untracked | `docs/` | Включить в `chore/tech-debt-sweep` PR — они новые канонические файлы из новой CLAUDE.md |
| 3.5 | `README.md` изменён (30 строк) | `README.md` | Проверить, что описание stack/scripts актуально |
| 3.6 | `package-lock.json.bad`, `package.json.bad.rtf` в корне `/Users/malast/` — мусор из прошлой сессии | `/Users/malast/` | Удалить (не в этом репо) |

---

## 4. План на этот заход — porядок работы

1. **Решение по Блокеру #2** (Next.js 14 vs 15). Нужно короткое владельческое «да/нет». Пока не решено — не коммитить.
2. **Коммитинг** по Варианту A или B из §1. Выбрать с владельцем.
3. **Пуш ветки/веток** в `origin`.
4. **Локальный полный smoke** на dev после каждого коммита/PR:
   - `npm run build`
   - `npm run lint`
   - `npm run test:pipeline-reliability`
   - `npm run test:batch-enrich`
   - `npx tsx --test tests/node/tg-digest-idempotency.test.ts`
5. Только **после** этого переходить к OUT-OF-CODE шагам из orchestrator §2 (secret, VPS, миграции, backfill, tg-digest smoke).

---

## 5. Что нельзя делать до завершения §4

- Применять миграции 006–012 и RLS в Supabase «из рабочего стола», пока код в working tree не зафиксирован. Иначе при откате кода схема БД уйдёт вперёд.
- Запускать `npx tsx scripts/backfill-article-videos.ts` — скрипт untracked, после возможного отката его просто не будет.
- Перезаписывать GitHub secret `SUPABASE_SERVICE_KEY` — это можно делать в любом порядке, но практически полезнее **после** merge в `main`, чтобы новый workflow-run уже прошёл с корректным кодом.
- Останавливать VPS scheduler/bot — делается только после Verification §2.3 в orchestrator'е, которая требует наличия PR-0 в `main` и зелёного `gh workflow run tg-digest.yml`. Пока нет коммитов — нет и workflow-run'а.

---

## 6. Где лежит этот файл

Path: `/Users/malast/malakhov-ai-digest/docs/ORCHESTRATOR_rework_2026-04-24.md`

Правило: после каждого закрытого пункта — tick в §0 / §1 / §2 / §3. Файл удалять после полной готовности (или переносить в исторический архив).
