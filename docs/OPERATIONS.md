# Operations

## Базовые требования среды

- Node.js 20+
- npm 9+
- `.env.local` для локального запуска

## Основные команды

```bash
npm run context
npm run build
npm run ingest
npm run enrich
npm run enrich-submit-batch
npm run enrich-collect-batch
npm run retry-failed
npm run publish-verify
npm run recover-batch-stuck
npm run cost:report
npm run cost:guard
npm run tg-digest
npm run docs:check
```

## Переменные окружения

Обязательный минимум:

```bash
SUPABASE_URL
SUPABASE_SERVICE_KEY
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
ANTHROPIC_API_KEY
NEXT_PUBLIC_SITE_URL
```

Для дополнительных функций:

```bash
DEEPL_API_KEY
TELEGRAM_BOT_TOKEN
TELEGRAM_CHANNEL_ID
TELEGRAM_ADMIN_CHAT_ID
PUBLISH_VERIFY_SECRET
HEALTH_TOKEN
NEXT_PUBLIC_METRIKA_ID
CRON_SECRET
```

`CRON_SECRET` обязателен для эндпоинтов под Vercel Cron (см. `vercel.json`):
Vercel автоматически добавляет `Authorization: Bearer ${CRON_SECRET}` к
исходящим cron-запросам, route-ы (`/api/cron/*`) проверяют этот заголовок и
отвечают 401 без него.

Аварийные/настроечные переменные:

- `PUBLISH_RPC_DISABLED=1` — только emergency bypass для `publish-verify`: временно возвращает legacy update вместо RPC `publish_article` и поднимает warning alert `publish_rpc_bypass_active`.

### Инвариант для URL-переменных

`NEXT_PUBLIC_SITE_URL` (и любые другие host-env) **обязательно** читать через `readSiteUrlFromEnv()` из `lib/site.ts`. Helper делает `trim()`, срезает trailing `/`, и валидирует формат `^https?://[^\s]+$`. Сырое чтение `process.env.NEXT_PUBLIC_SITE_URL` запрещено.

Почему: 2026-05-04 в Vercel UI значение `NEXT_PUBLIC_SITE_URL` сохранилось с trailing `\n` (вероятно, при сохранении ввели Enter в поле значения). Старая нормализация `(env ?? '').replace(/\/$/, '')` срезала только slash, `\n` доезжал до `<a href="...">` в Telegram-дайджесте, ссылка переставала быть кликабельной (HTML parse ломался на whitespace внутри атрибута). Helper кидает на любой невалидный формат — preflight дайджеста после этого вернёт `preflight_failed` вместо тихой отправки битой разметки.

## GitHub Actions

| Workflow | Расписание | Назначение |
|---|---|---|
| `rss-parse.yml` | каждые 30 минут | ingest RSS-источников |
| `enrich.yml` | каждые 30 минут | recover + cost-guard pre-check + batch submit |
| `enrich-collect-batch.yml` | каждые 15 минут | collect/apply готовых batch results |
| `recover-batch-stuck.yml` | каждые 30 минут | recovery для stuck batch poll/apply (включая null-poll auto-rescue) |
| `publish-verify.yml` | каждый час, на 20 минуте | проверка live-публикации |
| `retry-failed.yml` | каждые 4 часа, на 30 минуте | возврат retryable статей |
| `pipeline-health.yml` | каждые 2 часа, на 45 минуте | source health, backlog, provider guard, cost guard |
| `docs-guard.yml` | push/pull request | проверка doc-impact |

> **Telegram-дайджест с 2026-05-02 ушёл из GitHub Actions в Vercel Cron** —
> см. ниже. `tg-digest.yml` удалён.

## Cron-расписание Telegram-дайджеста

Дайджест дёргается **двумя независимыми планировщиками одновременно**. UNIQUE-claim в `digest_runs (digest_date+channel_id)` гарантирует, что отправится **ровно один** пост — кто пришёл первым, тот и отправил, остальные ответят 200 с `status: 'skipped_already_claimed'`.

### Primary — Supabase pg_cron + pg_net (минутная точность)

| Job | Расписание (UTC) | МСК | Дни |
|---|---|---|---|
| `tg-digest-weekday` | `30 6 * * 1-5` | 09:30 | Пн–Пт |
| `tg-digest-weekend` | `30 8 * * 6,0` | 11:30 | Сб + Вс |

`pg_cron` работает внутри Supabase Postgres, расписания исполняются с точностью до секунд. `pg_net.http_get` дёргает `https://news.malakhovai.ru/api/cron/tg-digest` с заголовком `Authorization: Bearer <secret>`, секрет хранится в `vault.secrets` под именем `cron_bearer_token` и читается через `vault.decrypted_secrets`.

Конфигурация — в `supabase/migrations/016_pg_cron_tg_digest.sql`. Секрет в Vault создаётся **один раз** руками:

```sql
SELECT vault.create_secret('Bearer <CRON_SECRET>', 'cron_bearer_token', '...');
```

Диагностика:

```sql
SELECT jobid, jobname, schedule, active FROM cron.job WHERE jobname LIKE 'tg-digest-%';
SELECT jobid, runid, start_time, status, return_message
  FROM cron.job_run_details
 WHERE jobid IN (SELECT jobid FROM cron.job WHERE jobname LIKE 'tg-digest-%')
 ORDER BY runid DESC LIMIT 10;
SELECT id, status_code, content::text, created FROM net._http_response ORDER BY id DESC LIMIT 5;
```

### Fallback — Vercel Cron (best-effort)

`vercel.json` содержит резервные cron-entries — на случай, если Supabase pg_cron не сработает (outage, миграция вылетела, секрет ротировали и забыли):

| Path | Расписание (UTC) | МСК | Дни |
|---|---|---|---|
| `/api/cron/tg-digest` | `30 6 * * 1-5` | 09:30 (best-effort) | Пн–Пт |
| `/api/cron/tg-digest` | `30 8 * * 6,0` | 11:30 (best-effort) | Сб + Вс |

Vercel Cron на Hobby plan имеет два жёстких ограничения:

1. **Один firing в день** на entry. Multi-firing expression вроде `0,30 6,7 * * 1-5` отклоняется при deploy с ошибкой `deploy_failed: Hobby accounts are limited to daily cron jobs`.
2. **Best-effort timing** — задержка до часа от запланированного времени.

То есть Vercel в одиночку не даёт «строгий 09:30 ± 1 мин» на Hobby. С pg_cron как primary это уже не проблема — Vercel практически всегда стучится постфактум и получает `skipped_already_claimed` (это нормально, не алёрт).

Если когда-нибудь решим уйти от Vercel Cron совсем — просто убрать `crons` из `vercel.json`. Если хотим, наоборот, сделать Vercel primary — нужен Pro tier ($20/мес), снимающий оба лимита.

Реализация: `app/api/cron/tg-digest/route.ts` → `runDailyDigest()` из `bot/daily-digest-core.ts`. Авторизация через `Authorization: Bearer ${CRON_SECRET}` (Vercel подставляет заголовок автоматически, если `CRON_SECRET` задан в Project Settings → Environment Variables).

**Safety-net против stuck-running:** `runDailyDigest()` оборачивает `runClaimedDigest()` в top-level try/catch. Любой неожиданный throw после успешного `claimDigestSlot` (CHECK violation на статус, network glitch, function timeout не успевший добежать до finalize) переводит slot в `failed_send` через safety-net catch. До этого фикса incident 2026-05-03 оставил slot в `running` навсегда из-за того, что миграция 015 не была применена в проде, а код пытался писать новый статус.

Ручной триггер: `curl -H "Authorization: Bearer $CRON_SECRET" https://news.malakhovai.ru/api/cron/tg-digest`. Для force-режима (обход даты) — запустить локально `FORCE_DIGEST=1 FORCE_DIGEST_CONFIRM_DATE=YYYY-MM-DD npm run tg-digest`; роут force-режим не поддерживает специально, чтобы случайный курл не пробил guard.

### Cost-guard и hard-stop

`pipeline/cost-guard.ts` теперь экспортирует `getDailyBudgetStatus()`. Эта функция используется в начале `enrich-submit-batch` для **проактивной** блокировки submit, если расход за сегодня (МСК) уже превысил `CLAUDE_DAILY_BUDGET_USD` (по умолчанию `$1`). Submit пропускается без claim, алёрт `enrich_submit_blocked_budget` идёт админу. Это hard-stop, работающий на уровне функции независимо от cron-расписания cost-guard.

Дополнительно cost-guard теперь запускается как pre-step в `enrich.yml` каждые 30 минут (а не только раз в 2 часа в `pipeline-health.yml`).

### Pipeline alerts

- `claude_parse_failed` — warning, cooldown 4 часа, dedupe по `batch_id`. Срабатывает
  в `enrich-collect-batch`, когда Claude batch result не содержит `output_text`, JSON не
  парсится или editorial validation отвергает структуру ответа.
- `lease_expired_spike` — warning, cooldown 2 часа. `recover-stuck` поднимает его,
  если за один запуск восстановлено больше 3 pre-submit статей с истёкшей lease.
- `llm_usage_log_write_failed` — warning, cooldown 4 часа. `writeLlmUsageLog`
  поднимает его при ошибке записи в `llm_usage_logs`; ошибка не пробрасывается наружу,
  чтобы collect-batch не падал из-за cost-observability.
- `publish_rpc_bypass_active` — warning, cooldown 6 часов. Срабатывает, если
  `PUBLISH_RPC_DISABLED=1` и `publish-verify` вынужден публиковать legacy update-ом
  вместо RPC `publish_article`. После снятия флага первый успешный RPC-переход
  resolve-ит этот alert.

### Slug нормализация

При больших backfill-операциях запускать `scripts/normalize-slugs.ts`:
- Без аргументов — dry-run, печатает что будет изменено.
- `APPLY=1 npx tsx scripts/normalize-slugs.ts` — реальное обновление. Конфликты slug-ов разрешаются через `-2/-3/...` суффикс.

`pipeline/enrich-collect-batch.ts` после `ensureUniqueSlug` вызывает `assertAsciiSlug` — невалидный slug приведёт item в `apply_failed_terminal` вместо записи мусора в `articles.slug`.

### Media sanitizer backfill

Для очистки старых live-статей от рекламных, promo и author/byline изображений используется
`scripts/sanitize-existing-article-media.ts`.

Команды:

```bash
npx tsx scripts/sanitize-existing-article-media.ts --dry-run
npx tsx scripts/sanitize-existing-article-media.ts --dry-run --limit=50
npx tsx scripts/sanitize-existing-article-media.ts --dry-run --slug=<slug>
npx tsx scripts/sanitize-existing-article-media.ts --apply --limit=50
```

Правила:

- default mode — dry-run, без DB writes;
- `--apply` обязателен для записи;
- скрипт обновляет только `cover_image_url` и `article_images`;
- перед apply нужно просмотреть summary `changed`, `by_reason`, `by_source` и examples;
- apply пишет rollback-audit в `tmp/media-sanitizer-audit-*.jsonl`.

### Stock cover backfill

Для тестового или ручного заполнения обложек у live-статей без usable cover используется
`scripts/backfill-stock-covers.ts`.

Команды:

```bash
npx tsx scripts/backfill-stock-covers.ts --date=YYYY-MM-DD --limit=12
npx tsx scripts/backfill-stock-covers.ts --date=YYYY-MM-DD --limit=12 --apply
npx tsx scripts/backfill-stock-covers.ts --latest-day --limit=12
```

Правила:

- default mode — dry-run, без DB writes и Storage upload;
- `--apply` скачивает stock image, накладывает editorial treatment через `sharp`, загружает WebP в Supabase Storage bucket `article-images` и обновляет только `articles.cover_image_url`;
- дата трактуется как календарный день по МСК;
- если `--date` не задан, скрипт берёт последний день по `created_at` среди опубликованных статей;
- для ключей поддерживаются `.env.local` и `malakhov-ai-keys.env` (включая RTF-файл через `textutil`);
- primary provider — Pexels; Unsplash и Pixabay используются как fallback, если ключи заданы и Pexels не дал кандидатов.

### AI cover backfill

Для ручного улучшения верхних карточек используется `scripts/generate-ai-covers.ts`.
Скрипт генерирует 1536x1024 WebP через OpenAI Images, сжимает до `1400x788`,
кладёт результат в Supabase Storage `article-images/ai-covers/<date>/...` и обновляет
только `articles.cover_image_url`.

```bash
npx tsx scripts/generate-ai-covers.ts --category=ai-russia --limit=8
npx tsx scripts/generate-ai-covers.ts --category=ai-russia --limit=8 --apply --quality=medium
```

Правила:

- default mode — dry-run, без OpenAI вызовов, DB writes и Storage upload;
- default model — `gpt-image-1.5`, потому что `gpt-image-2` требует verified organization;
- `--model=gpt-image-2` можно использовать только после проверки доступа; при 403 списания нет;
- `--apply` пишет локальные копии и `report.json` в `tmp/ai-covers-*`;
- стоимость для `gpt-image-1.5` считается по model-page per-image цене для `1536x1024`
  (`medium` = `$0.05/image` на момент ручного прогона 2026-05-03);
- при `Billing hard limit has been reached` остановить OpenAI backfill и закрывать только самые
  видимые пустые карточки бесплатным `scripts/replace-test-covers-with-editorial-templates.ts`.

Локальный fallback:

```bash
npx tsx scripts/replace-test-covers-with-editorial-templates.ts --top-russia=30 --apply
```

Скрипт не должен перезаписывать URL из `article-images/ai-covers/` и выбирает статьи в порядке
production category page (`pub_date`, `created_at`, `score`, `id`).

## Batch enrich runtime

Текущий enrich работает в две отдельные фазы:

1. `enrich-submit-batch`
   подбирает статьи, fetch-ит исходник, считает score и создаёт Anthropic batch jobs;
2. `enrich-collect-batch`
   poll-ит provider batches, импортирует результаты и делает final apply к статье.

Recovery разделён отдельно:

- `recover-stuck` обслуживает только pre-submit article lease;
- `recover-batch-stuck` обслуживает stuck polling и apply states уже после batch submit.

Operational правило:

- ожидание результата Anthropic больше не должно зависеть от `articles.lease_expires_at`;
- если статья уже handed off в batch ownership, источником истины становятся `anthropic_batch_items` и `anthropic_batches`.
- Anthropic Batch `custom_id` обязан быть не длиннее 64 символов и match-ить
  `^[a-zA-Z0-9_-]{1,64}$`. Если provider возвращает HTTP 400 `invalid_request_error`,
  submit классифицирует это как `provider_invalid_request`, не ретраит бесконечно и
  завершает workflow non-zero, когда staged items не создали ни одного provider batch.
- если код collector уже ожидает `article_videos`, а production DB ещё не получила `007_article_videos.sql`, collector должен оставаться backward-compatible и не ронять apply phase.
- collector poll-очередь по `anthropic_batches` сортируется `last_polled_at ASC NULLS FIRST`. Без `nullsFirst` в Postgres NULL уезжают в конец, и свежие submitted-батчи навсегда вытесняются уже завершёнными — что приводит к incident 2026-05-01 (89 застрявших статей за 2 суток). Документировано в `docs/incident_report_2026-05-01.md`.
- terminal batch-и (`completed`/`partial`/`failed`) нельзя бесконечно poll-ить после импорта результатов. Collector берёт такие batch-и только если в `anthropic_batch_items` ещё есть неимпортированные `batch_submitted`/`batch_processing` items; обычная очередь poll-а ограничена active `submitted` batch-ами.
- Claude cost observability не должна зависеть от парсинга stdout: structured usage/cost пишется в `llm_usage_logs`, `enrich_runs.total_*` и `anthropic_batches.total_*`.
- Fetch observability: `fetchArticleContent` нормализует article-fetch ошибки в
  `fetch_404`, `fetch_5xx`, `fetch_timeout`, `fetch_aborted`, `fetch_too_large`,
  `fetch_empty`, `fetch_blocked`, `fetch_unknown`. При ошибке `enrich-submit-batch`
  пишет отдельный `article_attempts` row со `stage='fetch'`, `result_status='failed'`
  и payload `{run_id, phase, url}`. Для production-деплоя перед этим нужна миграция
  014, расширяющая CHECK constraint `article_attempts.stage`.
- Media sanitizer observability: если sanitizer отбрасывает медиа, submit/collect пишут
  `article_attempts.stage='media_sanitize'`. `result_status='ok'` означает, что очистка
  прошла и pipeline продолжил работу; `result_status='rejected'` используется для
  pre-submit media gate, когда все медиа отсеяны и research-статья уходит в
  `rejected_low_visual`. Payload содержит rejects и оставшееся media summary.
- Категорийные publish gates находятся в коде pipeline: `ai-research` требует `score >= 4`,
  визуал до submit и `editorial_body >= 1500` после collect. Рост rejected по причинам
  `rejected_low_visual` / `research_too_short:*` после deploy ожидаем и означает, что фильтр работает.
- Broad feeds (`vc.ru/rss/all`, `rb.ru/feeds/all/`) должны мониториться через source health и
  ручную выборку после первой недели. Если мусора больше 30%, ужесточить `pipeline/keyword-filters.ts`.
- RSS rejected observability: `parseFeed` возвращает rejected summary по причинам
  `keyword_filter` и `requireDateInUrl`; `ingest` добавляет `dedup` после проверки
  `articles.dedup_hash` и пишет агрегат в `source_runs.items_rejected_count` /
  `items_rejected_breakdown`. Если миграция 014 ещё не применена, insert
  `source_runs` повторяется без этих колонок.
- Publish verification: normal path переводит `publish_ready/verifying` в `live`
  только через RPC `public.publish_article(article_id, 'publish-verify')`. Перед W4
  текущая production-функция была проверена безопасным smoke-call на несуществующий UUID
  (`not_eligible`). Неуспешные RPC-коды пишутся в `article_attempts.stage='verify'`
  с `error_code='publish_rpc_*'`; `rejected_quality` дополнительно withdraw-ит статью
  и поднимает critical `publish_verify_failed`.
- Не подключать неофициальные агрегаторы как замену source-owned RSS без отдельного решения:
  например, стандартные RSS endpoints `anthropic.com` сейчас отвечают 404, поэтому Anthropic
  покрывается broad feeds/filters до появления официального feed endpoint.

## Deploy

- Runtime сайта: Vercel.
- Production domain: `https://news.malakhovai.ru`.
- News-домен должен быть отдельным property в Яндекс.Вебмастере и Google Search Console.
- Sitemap для индексации: `https://news.malakhovai.ru/sitemap.xml`.
- `robots.txt` news-сайта разрешает публичные страницы и запрещает `/demo/`, `/internal/`,
  `/api/`, `/_next/`. `Host` и `Sitemap` указывают только на `news.malakhovai.ru`.
- Yandex Metrika / Google Analytics для news должны быть отдельными счётчиками от лендинга
  `malakhovai.ru`.
- Перед production deploy локально желательно проверить `npm run build`.
- После значимых изменений article-system или routing обязателен smoke-check живого сайта.

## Post-deploy smoke check

Минимальный smoke-check:

1. Открывается главная.
2. Открывается хотя бы одна свежая статья по новому URL `/categories/<primary>/<slug>`.
3. Canonical URL на странице статьи начинается с `/categories/<primary>/<slug>` и совпадает с текущим адресом.
4. Sitemap собирается и содержит только новые URL (`/categories/...`, `/categories/<slug>/<article>`), legacy `/articles/`/`/topics/` в нём отсутствуют.
5. Legacy URL `/articles/<slug>` отвечает 308-редиректом на канонический `/categories/<primary>/<slug>`. Legacy `/topics/<slug>` — на `/categories/<slug>` (или `/russia` для `ai-russia`).
6. Хлебные крошки на странице статьи кликабельны и ведут на главную → категорию.
7. На странице категории с количеством статей больше 20 виден счётчик `1-20 из N`, кнопка
   «Показать ещё» догружает следующую страницу, URL меняется на `?page=2`, а после конца ленты
   кнопка скрывается.
8. Если меняли media/video logic, на live-странице корректно рендерится media block.
9. Если меняли media sanitizer, problem pages с Habr career/course banner и Ars Technica
   `Photo of ...` не показывают эти inline images; нормальная тематическая картинка остаётся.
10. RSS (`/rss.xml`) и `llms.txt` отдают новые URL.
11. `robots.txt` содержит `Host: news.malakhovai.ru`, sitemap на news-домене и запреты
    `/internal/`, `/api/`, `/_next/`.
12. Canonical и `og:url` на главной, категории, статье, источниках и архиве начинаются с
    `https://news.malakhovai.ru`.
13. Cookie-баннер показывается в инкогнито. Выбор «Только необходимые» — Яндекс Метрика
   не появляется в Network. Выбор «Принять все» — `mc.yandex.ru/metrika/tag.js` грузится.
14. `/consent` открывается как страница согласия на обработку персональных данных и не содержит
   видимой кнопки «Отозвать согласие».

## Аналитика (Яндекс Метрика) и согласие

Метрика загружается только после явного согласия пользователя на аналитические cookies.

- Решение хранится в `localStorage.consent_v1` (см. `lib/consent.ts`).
- Скрипт инжектится `src/components/Analytics.tsx` через `next/script` `strategy="lazyOnload"`,
  только если в согласии `categories.analytics === true`.
- ID счётчика берётся из `NEXT_PUBLIC_METRIKA_ID`; без переменной аналитика выключена даже
  при наличии согласия (deploy без секрета не должен внезапно начать слать события).
- При смене политики безопасно бамкать ключ: `consent_v1` → `consent_v2`. Старое решение
  будет проигнорировано, баннер появится у всех заново.

## Recovery и monitoring

Operational scripts и workflows отвечают за:

- stuck article recovery;
- batch polling/apply recovery;
- retry после временных ошибок;
- publish verification;
- source health check;
- backlog monitoring;
- provider guard и alerting.
- Claude cost report и budget guard.

### Manual editorial backfill

Ручной backfill нужен только для deterministic outage, когда источник проблемы уже понятен
и владелец подтвердил восстановление публикаций/Telegram.

Порядок:

1. Выбрать failed/retry_wait статьи за нужное московское окно публикации.
2. Извлечь source text через `pipeline/fetcher.ts`, сохранить source media/tables по тем же полям, что batch submit.
3. Сформировать editorial fields без вызова Anthropic API, соблюдая контракт `validateEditorial`.
4. Записать статью как `enrich_status='enriched_ok'`, `publish_status='publish_ready'`,
   `published=true`, `quality_ok=true`, `tg_sent=false`, `editorial_model='codex-manual-backfill-<date>'`.
5. Добавить `article_attempts` со `stage='enrich'`, `result_status='ok'` и
   `payload.manual_backfill=true`.
6. Запустить `npm run publish-verify` или GitHub workflow `publish-verify.yml` с production secrets.
7. Проверить `publish_status='live'`, `verified_live=true` и публичные URLs.
8. Backdated Telegram digest отправлять только после явного подтверждения владельца; после отправки
   проверить `digest_runs.status='success'` и `articles.tg_sent=true` для всех отправленных материалов.

## Claude Cost Observability

- `npm run cost:report` печатает сводку по расходу Claude за окно, по умолчанию за последние 2 дня.
- `npm run cost:guard` проверяет расход Claude за текущий день по Москве и поднимает alert, если превышен бюджет.
- Порог budget guard задаётся через `CLAUDE_DAILY_BUDGET_USD`; по умолчанию это `$1`.
- Источник истины после миграции:
  - `llm_usage_logs` для per-call/per-item расхода;
  - `enrich_runs.total_*` и `estimated_cost_usd` для run-level totals;
  - `anthropic_batches.total_*` и `estimated_cost_usd` для batch-level totals.
- До полного cutover `cost:report` умеет падать обратно на legacy `enrich_runs.error_summary`, если structured logs ещё не накопились.

Любое изменение этих процессов требует обновления этого файла.

## Health endpoint

`GET /api/health?token=$HEALTH_TOKEN` отдаёт оперативный snapshot pipeline. Контракт ответа определён в `lib/health-summary.ts::HealthSummary`. Помимо last-run для ingest/enrich/digest и счётчиков open alerts/batches, ответ включает:

- `oldest_pending_age_minutes` — возраст самой старой статьи в `pending`/`retry_wait`/`processing`.
- `articles_published_today` — переходы в `live` за сегодня по МСК (использует индекс `idx_articles_published_at_live`).
- `articles_rejected_today_by_reason` — агрегат по `enrich_runs.rejected_breakdown` за сегодня (МСК), коллапсируется по префиксу до `:` (`research_too_short:1240` и `research_too_short:980` сливаются в `research_too_short`).
- `cost_today_usd` — сумма `llm_usage_logs.estimated_cost_usd` за сегодня (МСК), округлено до micro-USD.
- `live_window_6h_count` — публикации за последние 6 часов; используется алёртом `published_low_window` (волна 2).
- `top_open_alerts` — top-5 open алёртов по `last_seen_at DESC`.

Latency target — < 300 ms; cache-control `no-store`.

## Internal dashboard

`GET /internal/dashboard?token=$HEALTH_TOKEN` — server-rendered operator page для первого
разбора инцидента. Тот же токен можно передать header-ом `x-health-token`. Если `HEALTH_TOKEN`
не задан или request не содержит валидный token/header, page вызывает `notFound()` и публично
отдаёт 404, а не 401.

Данные собираются в `lib/internal-dashboard.ts`:

- health cards из `lib/health-summary.ts`;
- последние 10 `pipeline_alerts` (`open` first, затем recent resolved);
- top-10 stuck `anthropic_batch_items` старше 30 минут и не в terminal states;
- последние 20 live-переходов с `verified_live_at` и lag от `publish_ready_at`;
- последние 5 `digest_runs`.

Страница полностью server-rendered, без client-side state, с auto-refresh каждые 60 секунд.
`robots.txt` уже запрещает `/internal/`.

## Cleanup мёртвых alert types (2026-05-01)

В рамках инициативы `docs/spec_observability_publication_2026-05-01.md` из `pipeline/alerts.ts:COOLDOWN_HOURS` удалён ключ `batch_partial_failure_spike` — он не имел ни одного `fireAlert` вызова. Тест `tests/node/alert-cleanup.test.ts` следит, что каждый ключ в `COOLDOWN_HOURS` имеет соответствующий `fireAlert`.

Существующие алёрт-типы: `source_down`, `backlog_high`, `provider_invalid_request`, `provider_rate_limit`, `enrich_failed_spike`, `batch_submit_failed`, `batch_collect_failed`, `batch_poll_stuck`, `batch_apply_stuck`, `claude_daily_budget_exceeded`, `publish_verify_failed`, `publish_verify_failed_warn`, `publish_rpc_bypass_active`, `published_low_window`, `digest_low_articles` (+ bot-side `digest_pipeline_stalled`, `enrich_submit_blocked_budget`).

## Published-window monitor (Wave 2.1, 2026-05-02)

`pipeline/published-window-monitor.ts` запускается из `pipeline-health.yml` каждые 2 часа. Логика:

- считаем переходы в `publish_status='live'` за последние `PUBLISHED_LOW_WINDOW_HOURS` (default 6);
- если 0 live, при этом за окно есть хоть один `ingest_runs.status IN ('ok','partial')` — `fireAlert('published_low_window', warning, cooldown 2ч)`;
- если все ingest за окно `failed` — silent (root cause виден через `source_down`);
- если время попадает в `[PUBLISHED_LOW_WINDOW_QUIET_START_MSK, PUBLISHED_LOW_WINDOW_QUIET_END_MSK)` (по умолчанию 00:00–06:00 МСК) — silent;
- при появлении хотя бы одной live в окне — `resolveAlert('published_low_window')`.

ENV: `PUBLISHED_LOW_WINDOW_HOURS`, `PUBLISHED_LOW_WINDOW_QUIET_START_MSK`, `PUBLISHED_LOW_WINDOW_QUIET_END_MSK` (все опциональны, см. `docs/file_map_observability_publication_2026-05-01.md` § 11).

## digest_runs status enum (Wave 2.4, миграция 015)

CHECK constraint `digest_runs_status_check_v2` расширен НАДМНОЖЕСТВОМ — старые row из миграций 002/009 (`running`, `success`, `skipped`, `low_articles`, `error`, `failed`) продолжают существовать; новый код `bot/daily-digest.ts::main()` пишет точные коды:

| Код | Когда |
|---|---|
| `success` | дайджест отправлен, message_id записан |
| `skipped_already_claimed` | slot для `(digest_date, channel_id)` уже занят, либо tg_sent fallback показал, что отправка уже была за окно 8h |
| `skipped_no_articles` | за окно дня нет live-статей под отправку, pipeline в норме |
| `low_articles` (legacy) | live статей меньше 3 — отправка пропускается, health-отчёт админу |
| `failed_pipeline_stalled` | за окно нет статей, и > 0 статей застряло в `processing` старше 6h — collector не подбирает результаты Anthropic Batch |
| `failed_send` | ошибка запроса к Supabase или Telegram API при отправке |

Pre-claim env-config errors (`TELEGRAM_BOT_TOKEN`, `NEXT_PUBLIC_SITE_URL`, `assertServiceRoleKey`) намеренно НЕ пишут digest_runs — они срабатывают до любого DB-touch и логируются в stderr.

## Database security

- Production `public` tables работают с включённым RLS.
- Публичное чтение разрешено только для live-статей через policy на `public.articles`.
- Runtime и pipeline операции по служебным таблицам должны идти через `SUPABASE_SERVICE_KEY`, а не через anon client.

## Documentation Guard

Для контроля актуальности документации есть два механизма:

```bash
npm run context
npm run docs:check
```

- `context` печатает `CLAUDE.md` и `docs/INDEX.md` для старта сессии.
- `docs:check` смотрит изменённые файлы и требует обновить соответствующие канонические docs.

В CI этот же guard запускается workflow `docs-guard.yml`.
