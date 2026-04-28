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
NEXT_PUBLIC_METRIKA_ID
```

## GitHub Actions

| Workflow | Расписание | Назначение |
|---|---|---|
| `rss-parse.yml` | каждые 30 минут | ingest RSS-источников |
| `enrich.yml` | каждые 30 минут | pre-submit recover + batch submit |
| `enrich-collect-batch.yml` | каждые 15 минут | collect/apply готовых batch results |
| `recover-batch-stuck.yml` | каждые 30 минут | recovery для stuck batch poll/apply |
| `publish-verify.yml` | каждый час, на 20 минуте | проверка live-публикации |
| `retry-failed.yml` | каждые 4 часа, на 30 минуте | возврат retryable статей |
| `pipeline-health.yml` | каждые 2 часа, на 45 минуте | source health, backlog, provider guard |
| `tg-digest.yml` | ежедневно в 06:00 UTC | daily digest в Telegram |
| `docs-guard.yml` | push/pull request | проверка doc-impact |

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
- Claude cost observability не должна зависеть от парсинга stdout: structured usage/cost пишется в `llm_usage_logs`, `enrich_runs.total_*` и `anthropic_batches.total_*`.
- Категорийные publish gates находятся в коде pipeline: `ai-research` требует `score >= 4`,
  визуал до submit и `editorial_body >= 1500` после collect. Рост rejected по причинам
  `rejected_low_visual` / `research_too_short:*` после deploy ожидаем и означает, что фильтр работает.
- Broad feeds (`vc.ru/rss/all`, `rb.ru/feeds/all/`) должны мониториться через source health и
  ручную выборку после первой недели. Если мусора больше 30%, ужесточить `pipeline/keyword-filters.ts`.
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
9. RSS (`/rss.xml`) и `llms.txt` отдают новые URL.
10. `robots.txt` содержит `Host: news.malakhovai.ru`, sitemap на news-домене и запреты
    `/internal/`, `/api/`, `/_next/`.
11. Canonical и `og:url` на главной, категории, статье, источниках и архиве начинаются с
    `https://news.malakhovai.ru`.
12. Cookie-баннер показывается в инкогнито. Выбор «Только необходимые» — Яндекс Метрика
   не появляется в Network. Выбор «Принять все» — `mc.yandex.ru/metrika/tag.js` грузится.

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
