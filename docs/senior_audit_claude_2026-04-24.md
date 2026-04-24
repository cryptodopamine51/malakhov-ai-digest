---
title: Senior Audit — malakhov-ai-digest (Claude, 2026-04-24)
status: draft for comparison with senior_review_2026-04-24.md (Codex)
author: Claude (Opus 4.7)
scope: полный аудит актуального TS-стека: pipeline/, app/, src/, lib/, bot/, supabase/, .github/workflows/
---

# Senior Audit — malakhov-ai-digest

> Аналитика составлена до просмотра `docs/senior_review_2026-04-24.md` (Кодекс).
> Цель — выдать независимый срез, по которому на следующей итерации можно сравнить, что Кодекс уже закрыл, а что ещё висит.

## 0. Общее впечатление

Плюсы:
- Архитектура **чёткая**: ingest → scorer → batch submit → batch collect → publish verify → digest. Границы модулей соблюдены, инварианты CLAUDE.md подтверждены в коде.
- Pipeline устойчив к сбоям: lease/claim-token, attempt_count, next_retry_at, recover-stuck, retry-failed, publish-verify с MAX_VERIFY_ATTEMPTS, alerts с cooldown/dedupe.
- БД-слой **нормально нормализован**: `articles` + операционные таблицы (`enrich_runs`, `anthropic_batches/_items`, `llm_usage_logs`, `pipeline_alerts`, `article_attempts`, `digest_runs`, `source_runs`, `ingest_runs`).
- Есть идемпотентный apply через RPC (`apply_anthropic_batch_item_result`) с `FOR UPDATE`, state-машиной на batch_item и защитой от дублей в `article_attempts`.
- Observability: структурный `llm_usage_logs`, cost-guard с MSK-окном, published-verify, регрессии live-sample.
- Есть базовый test-suite (`tests/node/pipeline-reliability.test.ts`, `tests/node/batch-enrich.test.ts`).

Слабые места видны сразу:
- Страница статьи на лету дофетчит оригинал через `fetchArticleContent` (`app/articles/[slug]/page.tsx:368–372`) — это **прямое нарушение инварианта** «сайт не генерирует контент на лету» из CLAUDE.md.
- Главная (`app/page.tsx`) использует `force-dynamic` + `getArticlesFeed()` тянет **всю таблицу** (без `range()`), сортировка и пагинация в памяти — это O(всего каталога) на каждый хит.
- `client()` в `lib/articles.ts` молча падает обратно на anon при отсутствии service key — SEO и админские пути не отделены, RLS-политика покрывает, но отсутствие явного разделения делает поведение непредсказуемым.
- Защита от двойной отправки дайджеста в `bot/daily-digest.ts` завязана на `updated_at`, а его по статье обновляют и enrich, и verify — это **хрупкая** проверка, уже были инциденты (см. `docs/hotfix_plan_telegram_duplicate_2026-04-24.md`).
- В `bot/bot.ts` — long-polling Telegraf, но **нет workflow**, который бы его гонял, и нет supervisor’а. Скрипт на практике либо не запущен в prod, либо запускается вручную.
- Ключевые публичные индексы не partial и не учитывают `publish_status='live'`.

Ниже — по степени важности.

---

## 1. Critical (блокирующие / риск данных / безопасность)

### 1.1. Рендер статьи тянет внешний HTML на лету
**Файл:** `app/articles/[slug]/page.tsx:368–372`

```ts
const videosPromise = article.article_videos && article.article_videos.length > 0
  ? Promise.resolve(article.article_videos)
  : fetchArticleContent(article.original_url, { includeText: false })
      .then(({ inlineVideos }) => inlineVideos)
      .catch(() => [])
```

Проблемы:
- Нарушение инварианта из `CLAUDE.md` («сайт не генерирует контент на лету»).
- `fetchArticleContent` поднимает JSDOM + Readability — тяжело (CPU/RAM) и медленно в Next.js runtime, может уронить `/articles/[slug]` на Vercel при всплеске трафика.
- На `revalidate = 3600` каждое обновление ISR снова уходит за HTML внешнего сайта. При падении источника страница сломается.
- Встроенное ограничение тайм-аута 15 сек — при 404/429/медленном origin hangs fetch-ы ISR.
- Это происходит даже для статей, у которых `article_videos` просто пустой (но не null).

**Рекомендация:** удалить этот fallback. Видео должны быть предзаполнены в `article_videos` на этапе enrich (там уже есть `inlineVideos` из `fetcher.ts`). На странице читать только БД. Если миграция не проставила `article_videos`, дозаполнить отдельным backfill-скриптом (`scripts/backfill-article-videos.ts`).

---

### 1.2. Главная страница грузит весь каталог в память
**Файл:** `app/page.tsx:7, 17-20`, `lib/articles.ts:191–220`

```ts
export const dynamic = 'force-dynamic'
// ...
const { articles: feed, total } = await getArticlesFeed(page, PER_PAGE)
```
```ts
// lib/articles.ts
const { data, error, count } = await client()
  .from('articles').select('*', { count: 'exact' })
  .eq(...).eq(...).eq(...).eq(...)
  .order('score', ...).order('created_at', ...)
// Без .range() — тянет ВСЁ.
const pool = (data ?? []) as Article[]
const sorted = [...pool].sort((a,b) => b.score * freshnessMultiplier(b.created_at) - ...)
const offset = (page - 1) * perPage
return { articles: sorted.slice(offset, offset + perPage), total: count ?? pool.length }
```

Последствия:
- Full-table scan всего live-каталога на **каждый запрос главной** (force-dynamic отключает Next-кэш).
- Свежестный коэффициент считается только клиентом TS → нельзя перенести сортировку в БД.
- По мере роста каталога (сейчас сотни, цель — тысячи) это станет основным источником cost/latency Supabase.

**Рекомендация:**
- Вынести freshness в SQL-функцию или в SQL-выражение `ORDER BY score * CASE ... END DESC, created_at DESC` через `.rpc()` либо материализованное представление `articles_feed_ranked`.
- Использовать `.range(offset, offset + perPage - 1)` + отдельный `head:true, count:'exact'` для пагинации.
- Убрать `force-dynamic`, оставить `revalidate = 300` (5 минут), `revalidate-on-demand` при новом publish.

---

### 1.3. `client()` fallback с service key → anon маскирует сбой
**Файл:** `lib/articles.ts:11–21`

```ts
function client() {
  if (typeof window === 'undefined') {
    try { return getServerClient() }
    catch { /* Keep server rendering alive even if Vercel env is missing the service key. */ }
  }
  return getBrowserClient()
}
```

Проблемы:
- На сервере мы не должны втихую отваливаться на anon. Если service key пропал в env — это operational incident, его надо видеть.
- Service key на сервере для read-only страниц в целом избыточен: используем его только для админских мутаций. Для публичных выборок по уже включённой RLS-политике достаточно anon.
- Скрытое переключение ломает тест ожиданий RLS: в prod/dev поведение может расходиться.

**Рекомендация:** для публичных страниц создать отдельный клиент `getPublicReadClient()` на anon-ключе, с явным контрактом «читает только live-материалы». Service key оставить только для internal routes (`app/internal/articles/[slug]/route.ts`, бот/скрипты/pipeline). Fallback убрать, падать с явной ошибкой.

---

### 1.4. Защита от дубля TG-дайджеста завязана на `updated_at`
**Файл:** `bot/daily-digest.ts:236–253`

```ts
if (!force) {
  const eightHoursAgo = new Date(Date.now() - 8 * 60 * 60 * 1000).toISOString()
  const { count: recentlySent } = await supabase
    .from('articles')
    .select('*', { count: 'exact', head: true })
    .eq('tg_sent', true)
    .gte('updated_at', eightHoursAgo)
  if ((recentlySent ?? 0) > 0) { ...skip... }
}
```

Проблемы:
- `updated_at` у статьи меняется и от enrich, и от publish-verify, и от любого бэкфилла. То есть любой касаемый `tg_sent=true` апдейт 8-часовой давности «засчитывает» его как повторную отправку, даже если реально ничего не отправлялось.
- Обратный случай: если старая статья была помечена `tg_sent=true` давно и её `updated_at` никто не трогал последние 8 часов — то фильтр пропустит, и ничего не заблокирует; дубля тут не случится, но это не предусмотрено (полагаемся на `eq('tg_sent', false)` основного запроса).
- Нет атомарной «lock-in» записи в `digest_runs` до отправки: gap между «решили отправлять» и «пометили `tg_sent=true`» открыт.

**Рекомендация:** использовать `digest_runs` как источник истины.
- В начале `main()` инсертить строку `digest_runs {status:'running', date:<msk_date>}` с `UNIQUE(date)` → это и есть лок; повторный запуск за ту же дату упадёт на `23505` и аккуратно выйдет.
- По факту отправки обновлять `status='success'`.
- Смотреть на таблицу `digest_runs` вместо `tg_sent + updated_at`.

---

### 1.5. `bot/bot.ts` без supervisor’а / workflow’а
**Файлы:** `bot/bot.ts`, отсутствие `.github/workflows/bot.yml`

- `bot.ts` использует long-polling Telegraf и должен работать **постоянно**. Vercel serverless это не подходит, GitHub Actions тоже (cron с 10-минутным job тоже не годится).
- В репо нет ни workflow, ни docker/systemd/pm2-конфига, ни инструкции «как запустить бота». README упоминает `npm run bot` как локальный dev.
- Если пользователь напишет боту — никто не ответит.

**Рекомендация:** либо переехать на webhook-режим (`bot.telegram.setWebhook`) + один Next.js route `/api/telegram/webhook` (serverless-friendly), либо явно задокументировать, что `bot/bot.ts` — dev-only, а прод-ответы на /start не поддерживаются. Webhook-вариант — правильный.

---

### 1.6. Yandex Metrika с `webvisor:true` без cookie-баннера
**Файл:** `app/layout.tsx:62, 120-124`

- Включена запись сессий (вебвизор). В РФ формально нужен согласие на обработку ПД (ФЗ-152); у сайта нет баннера согласия и нет политики конфиденциальности (нет `/privacy` в robots/sitemap).
- Формально это risk, не blocker для деплоя, но аудиторски помечаю.

**Рекомендация:** добавить `/privacy` и `/cookies`, минимальный баннер согласия перед инициализацией Метрики, либо отключить webvisor (оставить clickmap+trackLinks).

---

## 2. Major (надёжность / производительность / корректность)

### 2.1. Публичные индексы не partial и не включают `publish_status`
**Файл:** `supabase/migrations/005_pipeline_reliability.sql:163`

```sql
create index if not exists idx_articles_verified_public
  on articles(published, quality_ok, verified_live, score desc, created_at desc);
```

- Индекс не partial и включает три булевых, которые в live-выборке всегда `true` — они дают нулевую селективность.
- В выборках используется ещё `publish_status = 'live'`, которого в индексе нет.
- Для queries `getLatestArticles / getArticlesFeed / getTopTodayArticles / getArticlesByTopic / rss.xml / sitemap` бэк всегда применяет одинаковый набор из четырёх условий.

**Рекомендация:** добавить partial index:
```sql
create index idx_articles_live_ranked on articles (score desc, created_at desc)
  where published and quality_ok and verified_live and publish_status = 'live';
```
Отдельно partial по `pub_date` для `getArticlesByDate`. Отдельно GIN по `topics` уже есть.

### 2.2. `getArticlesFeed` и `getSourcesStats` — агрегации в приложении
**Файл:** `lib/articles.ts:191, 249`

- `getSourcesStats` тянет 1000 последних статей и считает агрегаты в JS. При каждом просмотре `/sources`.
- `getArticlesFeed` — описано выше.

**Рекомендация:** SQL `group by source_name` (через `.rpc` или `SELECT ... FROM articles_live_view`). Кешировать `/sources` на `revalidate=3600`.

### 2.3. `getAllSlugs` возвращает дубли и делает дедуп в JS
**Файл:** `lib/articles.ts:135–156`

- `.filter((slug, index, arr) => arr.indexOf(slug) === index)` — O(N²) по slug’ам каталога.
- При этом у нас `UNIQUE(slug)` в схеме. Дубли возможны только после `toPublicArticleSlug` (обрезание hex-хвоста): разные исходные slug’и после обрезки могут дать один `publicSlug`. Но тогда в продакшене для этих статей невозможно однозначно резолвить URL (`getArticleBySlug` делает `matches.length === 1 ? matches[0] : null` → просто отдаст 404).

**Рекомендация:** ввести отдельное поле `public_slug` в схеме + `UNIQUE(public_slug)`, и при конфликтующих обрезаниях генерировать корректный publicSlug в SQL-триггере. Тогда и sitemap/generateStaticParams будут без JS-дедупа.

### 2.4. `generateStaticParams` отдаёт все slug’и без ограничения
**Файл:** `app/articles/[slug]/page.tsx:323–326`

- Сейчас статические params генерятся из **всего** каталога при каждом Next build → длинные билды, раздутый роутинг.
- При `revalidate = 3600` ISR всё равно покроет старые страницы по запросу.

**Рекомендация:** отдавать только последние 14–30 дней (например 300 последних), остальное рендерить on-demand.

### 2.5. `fetcher.ts` создаёт JSDOM дважды
**Файл:** `pipeline/fetcher.ts:257, 316`

- `extractReadableText(html, url)` создаёт JSDOM.
- В `fetchArticleContent` создаётся второй JSDOM для `extractTables/Images/Videos`.
- На статью — два тяжёлых парсинга HTML.

Плюс:
- Нет лимита на размер `response.text()` — ответ 20 MB честно грузится в память.
- Нет проверки `content-type` (если это application/pdf — JSDOM упадёт или даст мусор).
- `User-Agent` — статичный desktop Chrome; часть источников баннят single UA от одного IP (GitHub Actions IP-пул).

**Рекомендация:** один JSDOM per fetch, ограничить `response` по `content-length`, пропускать не-HTML, чередовать UA или честно отдаваться MalakhovAIDigestBot.

### 2.6. `publish-verify.ts` удваивает COUNT-запрос
**Файл:** `pipeline/publish-verify.ts:71–106`

- `countVerifyAttempts` делает `count` запрос, потом `writeVerifyAttempt` делает ещё один `count` **для того же article_id** перед INSERT. Два раунд-трипа под каждую статью → при 30 статьях в пачке — 60 лишних SELECT count’ов.
- Потенциально race: между двумя count-ами другой воркер может дописать attempt.

**Рекомендация:** брать `attemptNo` через SQL `MAX(attempt_no)+1` в одном запросе или CTE-INSERT. Либо вычислить один раз и прокинуть параметром.

### 2.7. `publish-verify.ts` помечает live-sample как `verification_failed` при первой ошибке
**Файл:** `pipeline/publish-verify.ts:215–238`

- Один транзиентный timeout к site-sample → страница получает `verification_failed`, `verified_live=false` и **перестаёт быть публичной** (RLS сразу скроет).
- Это жёстко для «просто чекаем кеш», ретрай не предусмотрен.

**Рекомендация:** для live_sample вести отдельный счётчик неудач (например `article_attempts.stage='verify_sample'`) и переводить в failed только после 2–3 подряд фейлов.

### 2.8. `recover-stuck.ts` делает два апдейта без транзакции
**Файл:** `pipeline/recover-stuck.ts:53–98`

- Шаг 1: `enrich_status = 'stuck'`.
- Шаг 2: `enrich_status = 'retry_wait'` / `'failed'`.
- Если между шагами процесс упадёт, статья застрянет в `stuck` — для неё нет выборки ни в enrich, ни в retry-failed.

**Рекомендация:** одну `UPDATE ... SET enrich_status = <target>, next_retry_at=...` + фильтр по claim_token и `processing` → `stuck`-промежутка не нужно. Либо RPC с транзакцией.

### 2.9. `rss-parser.ts` отбрасывает подсказки об ошибках фида
**Файл:** `pipeline/rss-parser.ts:167–177, 263–269`

- `parseFeedWithRetry` — один повтор без sleep/jitter, без логирования причины.
- `RSSParser.parseURL` сам делает запрос — мы не знаем `httpStatus` (`sourceResult.httpStatus` всегда null).
- Для `source_runs` `http_status` остаётся null → нельзя отличить 403/429/500/timeout в source-health.

**Рекомендация:** делать `fetch(feedUrl)` вручную (как в fetcher), затем передавать строку в `parseString` → `httpStatus` известен. Плюс логировать причину фэйла (в `source_runs.error_message` уже пишем, но без статуса).

### 2.10. `generateEditorialSync` повторяет `writeLlmUsageLog` 4 раза
**Файл:** `pipeline/claude.ts:266–406`

- Четыре почти одинаковых вызова `writeLlmUsageLog` с одинаковым контекстом. Легко пропустить один при рефакторинге.
- `extractEditorialText` читает только первый `content` block: если провайдер вернёт `thinking`-blocks или multiple text blocks (что формально возможно при включении extended thinking), мы потеряем текст.
- Нет проверки `stop_reason === 'max_tokens'` → частичный JSON интерпретируется как parse_failed, без явного `truncated`-кода.

**Рекомендация:**
- Вытащить хелпер `logUsage(resultStatus, errorMessage?)`, уменьшив копипасту.
- `extractEditorialText` — join всех `type === 'text'` блоков.
- Возвращать новый `errorCode = 'claude_truncated'` и учитывать в retryable.

### 2.11. Нет лимитов на размер Claude-input
**Файлы:** `pipeline/enrich-submit-batch.ts:193–199`, `pipeline/claude.ts`

- В промпте мы подаём `originalText` до 8000 символов + системный промпт. На статью уходит ~2–3k input tokens. Для 15 статей в batch — 30–45k. Для Sonnet 4.6 это нормально, но нет guard-rail.
- Нет проверки на входе, что `originalText` действительно присутствует (fallback: `text || article.original_text || ''` — может быть '').

**Рекомендация:** rejected на этапе stage, если итоговый `originalText` короче N (например 400) символов с errorCode `source_too_short`. Сейчас такой фильтр полностью в scorer’е (через `.original_text.length > 200` как +1 балл), но этого мало.

### 2.12. `enrich-collect-batch` и legacy-RPC fallback
**Файл:** `pipeline/enrich-collect-batch.ts:354–359, 26–32`

- Есть fallback если RPC падает на `p_article_videos` — тогда переходим на legacy-сигнатуру без этого параметра.
- Это shim ради старой миграции 006. Миграция 007 его убирает.
- Если prod уже накатил 007 — fallback мёртв. Если ещё нет — мёртвым может стать сам апдейт.

**Рекомендация:** после подтверждения, что 007 накатана в prod (можно проверить `pg_get_functiondef`), убрать shim и `shouldRetryLegacyApplyRpc`.

### 2.13. `retry-failed.yml` вызывает `npm run enrich` (== submit-batch) без `recover-stuck` перед
**Файл:** `.github/workflows/retry-failed.yml`

- В `enrich.yml` порядок правильный: сначала recover-stuck, потом submit-batch.
- В `retry-failed.yml` — нет recover-stuck → если какая-то статья с экспайренным lease осталась висеть, она не попадёт в claim, мы сразу занимаемся другими.
- Не критично, но логически непоследовательно.

**Рекомендация:** перед `npm run enrich` в retry-failed.yml добавить шаг `npm run recover-stuck`.

### 2.14. Отсутствие OPs workflow’а для TG-digest resilience
**Файл:** `.github/workflows/tg-digest.yml`

- Один cron `0 6 * * *`. Если GitHub Actions лежит — дайджест не отправляется, нет повтора.
- История падений известна (см. `docs/hotfix_plan_telegram_duplicate_2026-04-24.md`).

**Рекомендация:** второй cron на 06:30 UTC, внутри — `npm run tg-digest` с той же `digest_runs`-защитой по уникальному дате. Либо отдельный external scheduler (Hetzner/Fly) на pg-job.

### 2.15. `deepl.ts` — мёртвый код
**Файл:** `pipeline/deepl.ts`

- Документация и архитектура: «нет DeepL». Переводы делает Claude.
- Файл не импортирован никем в текущем пайплайне, но `.github/workflows/rss-parse.yml` и `retry-failed.yml` передают `DEEPL_API_KEY` в env — видимо исторически.

**Рекомендация:** удалить `pipeline/deepl.ts`, убрать `DEEPL_API_KEY` из workflow env.

---

## 3. Minor (код, стиль, хвосты)

### 3.1. Hydration-flash в `ThemeToggle`
**Файл:** `src/components/ThemeToggle.tsx`

- Начальный `dark = false`, после mount читает localStorage и переключает. При тёмной теме на первом paint отображается солнце, потом мелькает на луну.
- `themeScript` в `layout.tsx` ставит `data-theme='dark'` до hydration → стили правильные, но иконка мигает.

**Рекомендация:** читать `document.documentElement.getAttribute('data-theme')` в первичной инициализации (c `useLayoutEffect`) или через server-side cookie.

### 3.2. `lib/supabase.ts` — модульный singleton под browser
**Файл:** `lib/supabase.ts:269–283`

- `browserClientInstance` — это модуль-level singleton. Для Vercel-функций и серверных сборок при reuse лямды теоретически переживёт несколько invocation’ов, но окружение SSR не должно его использовать (branch `if typeof window === 'undefined'` уводит на server client). Ок, но хрупко.

### 3.3. Дубли `log`-функции в каждом pipeline-скрипте
**Файлы:** `pipeline/ingest.ts:17`, `pipeline/publish-verify.ts:26`, `pipeline/recover-stuck.ts:19`, `pipeline/retry-failed.ts:17`, `pipeline/cost-guard.ts:12`, `bot/daily-digest.ts:22`...

- 6 одинаковых `log(msg)` с `toTimeString().slice(0,8)`.

**Рекомендация:** один экспорт `pipeline/logger.ts` (или взять уже существующий `log` из `pipeline/enrich-runtime.ts:log`).

### 3.4. `decodeHtmlEntities` неполный
**Файл:** `pipeline/rss-parser.ts:74–84`

- Покрыты только `&amp; &lt; &gt; &quot; &#039; &#N;`.
- Не декодируются `&nbsp; &laquo; &raquo; &mdash; &hellip; &ndash; &#x...;`, что для кириллических источников и многих западных важно.

**Рекомендация:** использовать `entities` npm-пакет или `he`.

### 3.5. `cleanText` в fetcher.ts — цепочка .replace
**Файл:** `pipeline/fetcher.ts:65–84`

- Много похожих regexp, часть перекрывается (`Охват и читатели[\d...]` + `Охват и читатели\s*[\d...]`), и всё на одном тексте.
- Для Habr/vc.ru — ок, для новых источников поведение непредсказуемо.

**Рекомендация:** вынести правила в таблицу per-source: `{ sourceName: 'Habr', stripPatterns: [...] }`.

### 3.6. `schema.sql` помечен «LEGACY» и говорит про «Python/FastAPI runtime»
**Файл:** `supabase/schema.sql:1–4`

- Контент противоречит CLAUDE.md («legacy/ заморожен, Python убран»). Из комментария выше кажется, что schema.sql уже не актуален — но это главный файл схемы в репо (и ссылается README).

**Рекомендация:** заменить комментарий на актуальный; это один из первых файлов, которые читает новый инженер.

### 3.7. `lib/articles.ts:resolveAnchorLinks` — медленный ilike
**Файл:** `lib/articles.ts:341–371`

- Делаем до 3 `ilike '%searchTerm%'` на каждой статье при рендере — 3 roundtrip’а без индекса.
- Со временем (много статей) это станет узким местом.

**Рекомендация:** pg_trgm index на `ru_title`, либо предсчитанный `article_anchor_links` (id, anchor, target_slug) — пере стройка в enrich/publish-verify.

### 3.8. `pipeline/claude.ts:MAX_TOKENS = 3000`
**Файл:** `pipeline/claude.ts:6`

- Editorial_body ≥ 1200 символов, plus summary/glossary/JSON — 3000 токенов иногда маловато. Частые truncation’ы могут скрываться под `claude_parse_failed`. Не видел метрик, но стоит поднять до 4000 или оставить trace.

### 3.9. `publish-verify.ts` — HEAD без cache-buster
**Файл:** `pipeline/publish-verify.ts:45`

- CDN Vercel отдаёт HEAD из кэша; если ISR вернул 200 ранее, страница может продолжать отдавать 200, даже если DB-ряд уже недоступен (RLS поменялась) — ложное verified_live.

**Рекомендация:** добавить `?verify_ts=${Date.now()}` или заголовок `Cache-Control: no-cache` в fetch.

### 3.10. `daily-digest.ts` — `main()` без await/catch
**Файл:** `bot/daily-digest.ts:393`

- Вызов `main()` в конце файла без `.catch`. Любая необработанная ошибка → unhandledRejection и silent exit 0 в Node 20.

**Рекомендация:**
```ts
main().catch((err) => { logError('Unhandled', err); process.exit(1) })
```

### 3.11. `bot/daily-digest.ts:isArticleLive` — HEAD без таймаута
**Файл:** `bot/daily-digest.ts:112–119`

- Нет AbortController. Если сайт повис → Promise.all пятерых запросов висит, джоб GH Actions ждёт таймаута `ubuntu-latest` (6h).

**Рекомендация:** `AbortController` на 5 секунд, как в publish-verify.

### 3.12. Yandex Metrika script inline с eval-like кодом
**Файл:** `app/layout.tsx:120–124`

- CSP будущего времени запретит inline script. Уже сейчас `next-safe-action` стиль требует `nonce`.

**Рекомендация:** вынести в `.js` файл в `/public` и подгрузить через `<Script src>`.

### 3.13. `pipeline/enrich-submit-batch.ts` — no-op `tg_teaser`-free проверка
**Файл:** `pipeline/enrich-submit-batch.ts:110–143`

- `rejectLowScore` пишет `quality_ok = false, quality_reason = 'low_score'`, но не обновляет `score` корректно для следующих проходов (fine, но logging может ввести в заблуждение: мы уже потратили fetch).

### 3.14. `articles.verified_live BOOLEAN null-able` + legacy backfill
**Файл:** `supabase/migrations/005_pipeline_reliability.sql:25, 181–192`

- После backfill для old-published статей `verified_live` может остаться null (их легаси код публиковал напрямую). Публичная RLS-политика требует `verified_live = true` → такие ряды больше не видны.
- В `publish-verify.ts` есть legacy-backfill (`verified_live is null`), который ищет их и верифицирует. Это работает, но нет метрики «сколько legacy ещё без verify».

**Рекомендация:** добавить в `pipeline-health` простую проверку: `count(*) from articles where publish_status='live' and verified_live is null` → pipeline_alert если > 0.

### 3.15. `apply_anthropic_batch_item_result` — разный `duration_ms`
**Файлы:** миграции `006_anthropic_batch_enrich.sql:348`, `007_article_videos.sql:172`

- В 006: `floor(... * 1000)::integer` (корректно).
- В 007: `extract(epoch from ...)::bigint * 1000` (сначала `::bigint` — обрезает до секунды, потом `* 1000` — все значения кратны 1000).
- Метрика `duration_ms` в `article_attempts` после 007 деградирует.

**Рекомендация:** привести 007-версию к варианту 006 (`floor(extract(epoch from (now() - coalesce(v_article.processing_started_at, now()))) * 1000)::integer`).

### 3.16. `CLAUDE_DAILY_BUDGET_USD = 1` по дефолту
**Файл:** `.github/workflows/pipeline-health.yml`, `pipeline/cost-guard.ts`

- $1/сутки ≈ $30/мес. На batch API и sonnet 4.6 реальный recurring cost скорее $3–10/сутки. Если budget занижен, алёрт звенит каждый день.
- По логике алёртов есть cooldown 6h (`claude_daily_budget_exceeded`).

**Рекомендация:** выставить адекватный budget по факту (по `llm_usage_logs` за месяц) + добавить budget для batch-режима отдельно.

### 3.17. Нет `next.config.mjs`-security-заголовков и CSP
**Файл:** `next.config.mjs`

- Нет `headers()`, нет Content-Security-Policy, `X-Frame-Options`, `Strict-Transport-Security`. Для RU-news с пользовательскими сессиями (Metrika, Telegram-редиректы) — must-have.

**Рекомендация:** добавить:
```ts
async headers() {
  return [{
    source: '/(.*)',
    headers: [
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
      { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
    ],
  }]
}
```
CSP — отдельной задачей (инлайн-скрипты Metrika/JSON-LD потребуют nonce).

### 3.18. Демо-страницы в `app/demo/*` попадают в прод
**Файлы:** `app/demo/page.tsx` (281 строка), `app/demo/vector-covers/page.tsx` (1345 строк)

- В `robots.ts` они `disallow`’ены, но сами файлы собираются в Next build и деплоятся. Это занимает bundle size и увеличивает cold start.

**Рекомендация:** вынести в отдельный branch / `NEXT_PUBLIC_DEMO=true`-gate или удалить из прод-ветки.

### 3.19. Нет `tsconfig paths` из `@/*` в реальных импортах
**Файл:** `tsconfig.json:17` (`"@/*": ["./src/*"]`)

- Но в коде всё импортируется через относительные пути (`../../../lib/...`). Path-alias декларирован и не используется.

**Рекомендация:** либо включить `@/components/...` в импорты, либо убрать alias.

### 3.20. `tests/` только на 2 модуля; нет тестов на:
- `lib/articles.ts` (queries, RLS-контракт)
- `pipeline/ingest.ts` (dedup, canonicalize, source_runs)
- `pipeline/fetcher.ts` (table/image/video extraction, cleanText)
- `pipeline/slug.ts` (collisions, translit corner cases)
- `bot/daily-digest.ts` (форматирование, дата-окно МСК, dedup)
- `app/articles/[slug]` smoke test (snapshot)

---

## 4. Инфраструктура и операции

1. `npm ci` на **каждом** cron-тике (каждые 15–30 минут) — 7 параллельных workflows. Можно перейти на `actions/cache@v4` c `~/.npm` + запуск `npx tsx` без установки: либо `pnpm deploy --prod` один раз и артефакты.
2. `enrich.yml` и `enrich-collect-batch.yml` независимые → при расхождении расписания батчи могут накапливаться. Свести в один workflow с двумя шагами, либо делать `needs:` (хотя cron-triggered jobs не могут `needs` друг друга).
3. `.env.example` есть, но нет `.env.schema` (типизированный `zod`) — pipeline-скрипты молча падают при отсутствии значения.
4. Нет health-бейджика в README (`Schedule running` / `Last digest`) — полезно иметь https-эндпоинт `/api/health` с сводкой `ingest_runs last_finished`, `enrich_runs last_finished`, `digest_runs today`.

---

## 5. Рекомендованный план (приоритет → быстро решаемое сначала)

### P0 (делать в этой же волне)

1. **Убрать on-the-fly `fetchArticleContent` из `app/articles/[slug]/page.tsx`.** Писать `article_videos` только на этапе enrich.
2. **Переписать `getArticlesFeed` с `.range()`** и перенести freshness-ranking в SQL (`articles_live_feed` view или rpc). Снять `dynamic = 'force-dynamic'` с главной.
3. **Разделить `client()` на `getPublicReadClient()` (anon) и `getAdminClient()` (service).** Убрать silent fallback.
4. **Заменить защиту от дубля TG на `digest_runs UNIQUE(date)`-лок.**
5. **Webhook-режим для `bot/bot.ts`** или явная доктрина «в prod выключен» + удалить `npm run bot` из docs.
6. **Partial index** `idx_articles_live_ranked` как описано в 2.1.

### P1 (следующая волна)

7. Привести 007-версию RPC к корректному `duration_ms` (3.15).
8. Live-sample verify → retry, а не мгновенный failed (2.7).
9. Cache-busting в `publish-verify` HEAD (3.9).
10. Таймаут + robust-retry в `isArticleLive` daily-digest (3.11).
11. Один SQL-path на `getSourcesStats` и `getAllSlugs` без JS-дедупа.
12. Security-headers + CSP в `next.config.mjs` (3.17).
13. `/privacy` + cookie consent для Metrika webvisor.

### P2 (технический долг)

14. Удалить `pipeline/deepl.ts` и DEEPL_API_KEY из workflows (2.15).
15. Вынести duplicate `log` функции в `pipeline/logger.ts` (3.3).
16. Использовать `entities`/`he` вместо ручного `decodeHtmlEntities` (3.4).
17. `generateStaticParams` → последние 30 дней (2.4).
18. Очистить `schema.sql`-комментарий и зафиксировать actual schema (3.6).
19. Увеличить покрытие тестами `lib/articles`, `pipeline/fetcher`, `pipeline/ingest`, `pipeline/slug` (3.20).
20. Вынести `app/demo/**` из прод-бандла (3.18).

---

## 6. Сравнение с Кодексом (на следующей итерации)

Файл `docs/senior_review_2026-04-24.md` ещё не открывал.
После сравнения сюда допишем колонку:

| Область | Claude поймал | Codex поймал | Закрыто в коде | Осталось |
|---|---|---|---|---|
| 1.1 on-the-fly fetch в `[slug]` | ✅ | ? | ? | ? |
| 1.2 feed загружает весь каталог | ✅ | ? | ? | ? |
| 1.3 client() fallback | ✅ | ? | ? | ? |
| 1.4 tg dedup по updated_at | ✅ | ? | ? | ? |
| 1.5 bot/bot.ts без supervisor | ✅ | ? | ? | ? |
| 1.6 Metrika webvisor без баннера | ✅ | ? | ? | ? |
| 2.1 partial index | ✅ | ? | ? | ? |
| 2.7 verify live-sample first-fail | ✅ | ? | ? | ? |
| 2.8 recover-stuck without tx | ✅ | ? | ? | ? |
| 2.9 rss-parser без http_status | ✅ | ? | ? | ? |
| 2.10 generateEditorialSync дубли + truncated | ✅ | ? | ? | ? |
| 2.13 retry-failed workflow без recover-stuck | ✅ | ? | ? | ? |
| 2.15 deepl мёртвый | ✅ | ? | ? | ? |
| 3.1 hydration flash | ✅ | ? | ? | ? |
| 3.9 HEAD cache-buster | ✅ | ? | ? | ? |
| 3.10 main() без catch | ✅ | ? | ? | ? |
| 3.11 isArticleLive без таймаута | ✅ | ? | ? | ? |
| 3.15 duration_ms в 007 RPC | ✅ | ? | ? | ? |
| 3.17 security headers | ✅ | ? | ? | ? |
| 3.18 app/demo в проде | ✅ | ? | ? | ? |

Отдельно проверить:
- какие пункты Codex назвал, а Claude пропустил (скорее всего что-то по Telegram webhook, по CI cache, по observability дашбордам);
- где формулировки расходятся (Codex может иначе ранжировать критичность);
- какие пункты уже closed-by-code после Codex-review (тогда диф между чек-листом и актуальным `git log` закроет хвосты).

---

## 7. Quick wins за 1 день

- Удалить `fetchArticleContent`-fallback в article page и завести `scripts/backfill-article-videos.ts`.
- `dynamic = 'force-dynamic'` → `revalidate = 300` на `app/page.tsx`.
- Partial index `idx_articles_live_ranked`.
- `digest_runs UNIQUE(date)` + `bot/daily-digest.ts` использует его как lock.
- Убрать legacy-fallback RPC (2.12) после подтверждения миграции 007.
- Удалить `pipeline/deepl.ts` и `DEEPL_API_KEY` из workflows.

---

## Итог

Кодовая база в приличном состоянии для pet-проекта на одного владельца: pipeline идемпотентен, observability местами лучше, чем у среднего стартапа. Основная уязвимая зона — **публичный web-слой** (ведёт себя как prototype) и **несколько инвариантов** CLAUDE.md, нарушенных по мелочам. Фикс P0-списка закрывает больше 80% эксплуатационного риска и ускоряет сайт в разы.

Путь локально: `docs/senior_audit_claude_2026-04-24.md`.
