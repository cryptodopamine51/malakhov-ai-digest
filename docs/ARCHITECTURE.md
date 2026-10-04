# Architecture

## Активная архитектура после переноса на REG.RU (2026-10-04)

Публичный origin — существующий shared hosting REG.RU `u3426348/server39`, https://news.malakhovai.ru/. DNS A news указывает на `31.31.196.75`; TLS обслуживает модуль Let's Encrypt в ispmanager, HTTP перенаправляется на HTTPS. Основной web root содержит заранее подготовленные HTML/JSON, CSS, шрифты и локальные изображения. 751 новость, 14 гайдов; поиск выполняется в браузере по статическому JSON. Supabase, Next.js server, LLM API и проектные cron не участвуют в обслуживании.

GitHub Pages (`gh-pages:/`) — резервная копия и источник статического пакета, а не production origin news-домена. Обновление gh-pages само по себе не обновляет REG. Canonical/OG/JSON-LD пакета для REG используют news-домен. Расписания pipeline и Telegram остаются выключенными. Порядок установки, backup/rollback, сертификат и результаты проверок — в первом разделе [Operations](OPERATIONS.md).

Следующие разделы о незавершённом переносе описывают состояние до этой установки.

## Уточнение восстановления и уведомлений (2026-10-04)

Прежний адрес `news.malakhovai.ru` ещё не восстановлен. Повторная попытка GitHub Pages custom domain не дала сертификат; CNAME в настройках Pages вновь снят, резервный GitHub URL остаётся рабочим. В REG.RU сохраняется авторизованная панель, но управление Chrome нестабильно и подключение расширения пропало. В Shell-клиенте не получено подтверждение установки: частично набранные команды не считать выполненными. DNS news пока указывает на `185.199.108.153`.

Подготовлен новый release `archive-2026-10-04`, asset `digest-static-2026-10-04.tar.gz` (751 новость, 14 гайдов, включая десять новых статей и изображения). SHA256: `8bcff14f17605ab5ffad8f0df0d5b67524bb6b916bb17588e91255ee3394e1a2`. В этом пакете canonical/OG/JSON-LD указывают на `https://news.malakhovai.ru`. Старый release `archive-2026-10-03` для актуального переноса не использовать. Пакет не установлен на REG; итоговая проверка HTTPS обязательна после установки, смены только A news на `31.31.196.75` и выпуска Let's Encrypt. Предыдущий web root сохранять вне публичного каталога для отката.

Обнаружен дополнительный источник писем: Vercel пытался строить статическую `gh-pages` как Next.js preview и присылал ошибки. `git.deploymentEnabled=false` добавлен в `vercel.json` ветки `gh-pages`, этого release и main. Это останавливает будущие автоматические Vercel deployment из обновлённых веток; ручной deploy возможен отдельно. Не менять общие почтовые настройки владельца, не включать cron. Статический GitHub Pages не зависит от Vercel. Токен локального Vercel CLI при проверке API вернул 403; настройка проекта через API не подтверждена.

Режим уточнён новым запросом владельца 2026-10-03: допускается ручной разовый выпуск и доставка списка владельцу. Добавлено 10 новостей, всего 751; публичная поверхность `/weekly/2026-09-28/`. Хостинг остаётся статическим GitHub Pages, поиск — локальным. Cron и backend не возобновлены. Canonical/OG/JSON-LD используют действующий GitHub Pages URL. Пакет и порядок публикации — в начале `OPERATIONS.md`.

## Статус подключения домена (2026-10-03)

Рабочий HTTPS-адрес архива: https://cryptodopamine51.github.io/malakhov-ai-digest/. GitHub Pages custom domain отключён после повторного отказа DNS health check (`InvalidDNSError`, `Dnsruby::ResolvTimeout`) и отсутствия сертификата; стандартный адрес восстановлен с `https_enforced=true`.

В панели REG.RU DNS `news.malakhovai.ru` сохранён как A `185.199.108.153`, TTL 300. Google Public DNS и Cloudflare подтверждают новую запись. Эта запись сама по себе не завершает подключение домена. Для миграции на имеющийся REG.RU shared hosting (`server39.hosting.reg.ru`, IP `31.31.196.75`, web root `/www/news.malakhovai.ru`) подготовлен публичный release `archive-2026-10-03`, файл `digest-static-archive.tar.gz`, SHA256 `7082c61ef0986d786c41a801a56a2dbc0541a0710bb41a06b0d9b04a0d835810`. Размещение на REG ещё не подтверждено. Его текущий сертификат self-signed, не считать HTTPS рабочим.

Следующие шаги требуют доступного управления REG: установить архив с сохранением прежнего web root, заменить только A news на `31.31.196.75`, получить Let's Encrypt для news и проверить HTTPS. В этой сессии управление Chrome зависает/отключается; владельцу предоставлена команда через Shell-клиент. Не считать запрос выполнить команду подтверждением выполнения. Все cron отключены независимо от незавершённого подключения домена.


## Активная архитектура с 2026-10-03

Публичный сайт переведён в замороженный статический архив на GitHub Pages (`gh-pages:/`). HTML заранее отрисован из опубликованных recovery rows и существующих компонентов/гайдов. Сохраняются canonical article paths `/categories/<primary>/<clean-slug>`, категории, пагинация, источники, архив по датам, legal/about/services. Legacy aliases перенаправляют через HTML meta refresh. Поиск — browser JS + публичный JSON; изображения и шрифты сохранены с сайтом. Runtime database, LLM API, серверный optimizer и cron отсутствуют.

741 новость восстановлена из snapshot 2026-08-01; более свежие данные с недоступного VPS не извлечены. 14 гайдов взяты из локального source. Старые pipeline modules остаются историческим исходным кодом. Они не являются активным обслуживанием архива. Десять scheduled GitHub workflows выключены и их расписания удалены. Недоступные VPS timers не считаются выключенными.

Подробности публикации и ограничения — в начале `OPERATIONS.md`. Следующие разделы описывают предыдущую архитектуру.


## Верхний уровень

Система разделена на четыре слоя:

1. Web app: Next.js приложение в `app/` и `src/components/`, отрендеренное на Vercel.
2. Data layer: Supabase PostgreSQL как единый источник данных.
3. Content pipeline: TypeScript-скрипты в `pipeline/`, запускаемые по cron через GitHub Actions.
4. Delivery and observability: Telegram digest, publish verification, health checks, alerts.

## Runtime Boundaries

### 1. Публичный сайт

- Читает данные из Supabase.
- Не использует `SUPABASE_SERVICE_KEY` на клиентской стороне.
- Рендерит опубликованные статьи, topic pages, sources, archive и SEO-артефакты.

`app/internal/dashboard` — исключение только по аудитории, не по runtime: это server-only
operator page. Он использует `SUPABASE_SERVICE_KEY` через `getAdminClient()` только на сервере,
требует `HEALTH_TOKEN` в query/header и без валидного токена отдаёт 404 через `notFound()`.
`robots.txt` запрещает `/internal/`.

### 2. Pipeline

- `pipeline/ingest.ts` создаёт или обновляет сырьевые записи статей.
- `pipeline/enrich-submit-batch.ts` забирает pending-статьи, считает score, fetch-ит оригинал и создаёт Anthropic batch jobs.
- `pipeline/enrich-collect-batch.ts` импортирует provider results и apply-ит final editorial outcome к статье.
- `pipeline/enricher.ts` остаётся compatibility wrapper для `npm run enrich`.
- Вспомогательные pipeline-модули отвечают за scoring, fetch, slug, retries, verification и monitoring.

### 3. Data contracts

Основной объект системы — строка в `articles`.

High-level contract:
- ingest создаёт raw article с исходными метаданными;
- enrichment добавляет editorial fields и operational statuses;
- enrichment также сохраняет extracted media fields статьи, включая tables, images и videos;
- publish verification подтверждает, что материал доступен на сайте;
- Telegram использует уже опубликованные материалы.

RLS contract:
- public tables в схеме `public` работают с включённым RLS;
- единственная публичная policy на `articles` разрешает `SELECT` только для live-материалов (`published=true`, `quality_ok=true`, `verified_live=true`, `publish_status='live'`);
- `categories` имеет public read только для `is_active=true`; запись — только через `service_role`;
- operational tables (`article_attempts`, `ingest_runs`, `enrich_runs`, `digest_runs`, `pipeline_alerts`, `source_runs`) не имеют public policies и должны читаться/писаться только через `service_role`.

Модель категорий:
- одна основная категория на статью (`articles.primary_category`, FK на `categories.slug`, NOT NULL);
- до двух смежных (`articles.secondary_categories`, `text[]` с CHECK на длину ≤ 2);
- legacy `topics[]` остаётся read-only до полного cutover; canonical и URL опираются на `primary_category`.

Дополнительные operational tables используются для observability и retries:
- `ingest_runs`
- `enrich_runs`
- `llm_usage_logs`
- `anthropic_batches`
- `anthropic_batch_items`
- `source_runs`
- `digest_runs`
- `article_attempts`
- `pipeline_alerts`

Для batch enrich действует отдельная граница ответственности:

- coarse article state остаётся в `articles`;
- batch lifecycle и idempotent apply ownership живут в `anthropic_batches` / `anthropic_batch_items`;
- `articles.current_batch_item_id` связывает статью с активным batch-owned item, пока final apply не завершён.

Для cost observability действует отдельный инвариант:

- run-level totals по Claude должны писаться структурно в `enrich_runs.total_*` и `enrich_runs.estimated_cost_usd`, а не только в строковый `error_summary`;
- единый per-call/per-item audit trail должен писаться в `llm_usage_logs`;
- batch-level totals в `anthropic_batches` должны пересчитываться из `anthropic_batch_items`, чтобы dashboard и alerting не зависели от логов stdout.

Миграции 014 / 015 (инициатива 2026-05-01) расширяют operational схему backward-compatible изменениями (`ADD COLUMN ... DEFAULT` + надмножество CHECK enum):

- `enrich_runs.rejected_breakdown` JSONB — агрегатор причин reject за run (см. `docs/ARTICLE_SYSTEM.md` секция «`enrich_runs.rejected_breakdown`»);
- `source_runs.fetch_errors_count`/`_breakdown`, `items_rejected_count`/`_breakdown` — задел для волны 3;
- `articles.last_publish_verifier`, `published_at` — для атомарного RPC `publish_article` (волна 4);
- `digest_runs_status_check_v2` — расширен надмножеством, легаси значения (`running/success/skipped/low_articles/error/failed`) сохранены, добавлены точные коды для веток `main()` дайджеста (см. `docs/OPERATIONS.md`);
- `idx_articles_published_at` — partial index `WHERE publish_status='live'` под `published_low_window` мониторинг и health endpoint.

Миграция 016 (2026-05-04) добавляет primary cron для Telegram-дайджеста через `pg_cron` + `pg_net` внутри Postgres — расписания исполняются с минутной точностью и дёргают Vercel-route с bearer-токеном из `vault.secrets`. Vercel Cron остаётся как fallback. См. `docs/OPERATIONS.md` секцию «Cron-расписание Telegram-дайджеста».

## Основные модули

| Зона | Ответственность |
|---|---|
| `app/` | маршруты и серверный рендер |
| `src/components/` | UI-слой |
| `lib/articles.ts` | серверные выборки и резолвинг article data |
| `lib/supabase.ts` | типы и Supabase clients |
| `lib/health-summary.ts`, `lib/internal-dashboard.ts` | operational snapshots для `/api/health` и `/internal/dashboard` |
| `pipeline/` | ingest, enrich, scoring, fetch, verification, recovery |
| `bot/` | Telegram delivery |
| `.github/workflows/` | расписание и запуск фоновых процессов |

## Важные архитектурные правила

- Источник истины по статье — Supabase, а не кэш в приложении.
- Public web и background pipeline разделены: сайт не выполняет enrichment.
- Operational status fields важнее legacy boolean-флагов; legacy поля сохраняются только для обратной совместимости.
- Batch-specific states не должны размножаться в `articles.enrich_status`; source of truth для них — batch tables.
- `legacy/` изолирован и не участвует в текущем runtime.

## Когда обновлять этот файл

Обновлять при изменении:
- границ модулей;
- структуры данных и статусов;
- ролей Supabase/Next.js/pipeline;
- взаимодействия между публичным web и background jobs.

Freeze note (2026-10-03): `vercel.json` also has an empty `crons` list, removing the two historical Telegram fallback schedules on the next production deployment. Vercel remains linked to main but is not the active public archive hosting.
