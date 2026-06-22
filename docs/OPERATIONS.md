# Operations

## Базовые требования среды

- Node.js 20+
- npm 9+
- `.env.local` для локального запуска

## Основные команды

```bash
npm run context
npm run build
npm run evergreen:new -- --topic-id=<id>
npm run evergreen:check -- --slug=<slug>
npm run images:prep -- --slug=<slug>
npm run images:audit
npm run ingest
npm run enrich
npm run enrich-submit-batch
npm run enrich-collect-batch
npm run retry-failed
npm run publish-verify
npm run recover-batch-stuck
npm run cost:report
npm run cost:guard
npm run editorial:routing
npm run routing:lab
npm run image:style-lab
npm run tg-digest
npm run tg-weekly-report -- --week-start=YYYY-MM-DD --format=all --dry-run
npm run risk:audit -- --limit=500
npm run quality:judge
npm run quality:feedback
npm run tg-feedback:set-webhook
npm run docs:check
```

### Evergreen content utilities

Evergreen-гайды готовятся локально и не требуют production env.

- `npm run evergreen:new -- --topic-id=<id>` создаёт редакционный пакет из `content/evergreen/topics.json` в `content/evergreen/packages/<slug>/`.
- `npm run evergreen:new -- --topic-id=<id> --dry-run` показывает будущие файлы без записи.
- `npm run evergreen:check -- --slug=<slug>` проверяет package-файлы, `00-topic.json`, ASCII slug, metadata JSON (включая `verifiedAt`, опциональный `caseSourcing`, CTA cap), published guide/metadata consistency, cover metadata, FAQ, локальные `/guides/...` ссылки, lead anchor, наличие counter-strategy H2 и кейс-блока, ≥ 2 inline `/guides|/categories|/russia` ссылок в теле, редакционные запреты (`не X, а Y`, `proof of concept`, `production`, `no-code`, `AI-сигналы`, сломанные смешанные фразы), локальные guide image variants (`-480.webp`, `-768.webp`) и image budgets, `cover ≥ 50 KB` и `noindex` старше 14 дней. Errors блокируют, warnings — нет; URL очищаются перед редакционной проверкой, чтобы source links не падали из-за `proof-of-concept` в slug.
- `npm run images:prep -- --slug=<slug>` (`scripts/images-prep.ts`) конвертирует PNG из `content/evergreen/packages/<slug>/raw-images/` в production-WebP по правильным размерам (cover 1200×675, inline 1200×800 или 1200×1200), `sharp` quality **88 для cover / 88 для inline, effort 6, smartSubsample=false** (полное 4:4:4 chroma — критично для графики). Имя PNG может быть любым (ChatGPT-вывод `ChatGPT_image_<ts>.png` подходит): script делает smart-matching — pass 1 точный stem-матч, pass 2 random-имена маппит по алфавитному порядку на declared meta order (cover → inline). Итог пишется в `public/images/guides/<slug>/<seo-filename>.webp` уже под SEO-имя из metadata. После canonical WebP скрипт всегда генерирует responsive siblings `-480.webp` (q72) и `-768.webp` (q78); если raw PNG нет, variants backfill строится из уже существующего canonical WebP.
- `npm run images:audit` показывает top-30 тяжёлых local guide images, суммарный canonical и mobile-768 вес по гайдам, missing variants и live `cache-control` spot checks (`--no-live` отключает сеть).

Эти команды не публикуют материал. Production-публикация evergreen-гайда начинается только после переноса approved Markdown в `content/guides/<slug>.md`, metadata в `content/guides/meta/<slug>.json` и изображений в `public/images/guides/<slug>/`.

### Evergreen image workflow (ChatGPT subscription)

Картинки для evergreen-гайдов производятся **только через подписку ChatGPT** (Plus / Pro / Codex). Никакие image API (OpenAI Images, Anthropic, runtime генераторы) для этого workflow не используются — это политика проекта.

1. Codex/агент готовит `09-image-brief.md` в пакете гайда: для cover и каждой inline-картинки — `prompt`, `negative_prompt`, `alt`, `caption`, `aspect`, `filename_png`, `filename_webp`. **Filename в meta** уже соответствует SEO convention: cover = `<slug>-cover.webp`, inline = `<slug-short>-<section-keyword>.webp` (ASCII, lowercase, hyphens, ≤ 60 символов; без generic `cover.webp`, `image1.webp`).
2. Владелец/редактор открывает ChatGPT, копирует prompt, сохраняет PNG в `content/evergreen/packages/<slug>/raw-images/`. **Имя PNG может быть любым** — ChatGPT-output `ChatGPT_image_<timestamp>.png` подходит без ручного rename'а.
3. `npm run images:prep -- --slug=<slug>` ресайзит и конвертирует в WebP. Smart-matching: pass 1 — точный stem-матч, pass 2 — оставшиеся random-имена маппятся по алфавитному порядку на declared meta order (cover → inline в порядке `inlineImagesByHeading`); в логах рядом со slot'ом печатается `renamed ← <random.png>`. Quality cover q=88 / inline q=88, effort=6, smartSubsample=false. PNG больше 5 МБ помечается warn'ом. Для каждого metadata slot пишутся `name-480.webp` и `name-768.webp`; canonical URL `name.webp` не меняется.
4. `npm run evergreen:check -- --slug=<slug>` подтверждает наличие cover ≥ 50 KB, inline-файлов, `-480/-768` variants, правильные dimensions/aspect ratio и budgets: 480w ≤ 35 KB, 768w ≤ 70 KB, cover ≤ 140 KB, inline warn > 180 KB и hard fail > 220 KB.

SLA: после статуса `ready_for_codex` владелец генерит cover в ChatGPT в течение 48 часов, иначе гайд переходит в `blocked` со статусом `cover_pending`. Локальные SVG/Canvas-схемы допустимы как замена для inline-диаграмм (матрицы, roadmap, формулы); cover всегда генерится в ChatGPT, не из SVG.

Quality history: до 2026-05-22 использовался WEBP quality 82 без effort/subsample tuning, что давало ~30 KB WebP на 1200×800 ChatGPT-иллюстрациях и visible compression artifacts. 2026-05-22 поднято до cover q=90 / inline q=88 + effort 6 + smartSubsample=false; 2026-06-17 cover q снижен до 88 и добавлены static responsive variants `-480/-768`, чтобы мобильные/VPN пользователи не скачивали 1200px canonical.

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
DEEPSEEK_API_KEY
DEEPSEEK_BASE_URL
DEEPSEEK_WRITER_MODEL
DEEPSEEK_REPAIR_MODEL
DEEPSEEK_DAILY_BUDGET_USD
DEEPSEEK_TELEGRAM_CAPTION_MODEL
DEEPSEEK_TELEGRAM_CAPTION_DAILY_BUDGET_USD
DEEPSEEK_TELEGRAM_CAPTION_TIMEOUT_MS
EDITORIAL_SOURCE_TEXT_CAP
QUALITY_JUDGE_MODEL
OPENAI_API_KEY
OPENAI_IMAGE_DAILY_BUDGET_USD
TELEGRAM_BOT_TOKEN
TELEGRAM_CHANNEL_ID
TELEGRAM_ADMIN_CHAT_ID
TELEGRAM_OWNER_USER_ID
TELEGRAM_FEEDBACK_SECRET_TOKEN
TELEGRAM_IMMEDIATE_ALERT_MIN_SEVERITY
TELEGRAM_IMMEDIATE_ALERT_TYPES
PUBLISH_VERIFY_SECRET
HEALTH_TOKEN
NEXT_PUBLIC_METRIKA_ID
YANDEX_METRIKA_OAUTH_TOKEN
YANDEX_METRIKA_COUNTER_ID
CRON_SECRET
INDEXNOW_KEY
R2_ACCOUNT_ID
R2_ACCESS_KEY_ID
R2_SECRET_ACCESS_KEY
R2_BUCKET
R2_PUBLIC_BASE_URL
NEXT_PUBLIC_R2_PUBLIC_BASE_URL
```

**Cloudflare R2** (`R2_*`) — хранилище обложек/инлайн-картинок (с 2026-05-26 вместо Supabase
Storage; egress R2 бесплатен, что устраняет инцидент `exceed_egress_quota`). Нужны только тем,
кто **загружает** изображения: cron `ai-covers.yml` (оба шага — `covers:ai-low` и
`covers:template`), с 2026-06-10 также enrich-cron'ы (`enrich.yml`, `enrich-collect-batch.yml`,
`retry-failed.yml`) — для зеркалирования внешних cover'ов (`pipeline/cover-mirror.ts`) — и
локальные скрипты (`scripts/generate-ai-covers.ts`, `scripts/backfill-*.ts`,
`scripts/migrate-covers-to-r2.ts`, `scripts/mirror-covers-to-r2.ts`).

`SOURCE_DAILY_PUBLISH_CAP` (опционально, default 10) — дневной MSK-кэп live-публикаций с одного
`source_name`; применяется в `pipeline/claims.ts::claimBatch` (см. `docs/ARTICLE_SYSTEM.md`
«Score и publish gate»). Публичному сайту (Vercel) ключи
не нужны — он только читает обложки по публичному URL, сохранённому в `articles.cover_image_url`.
`R2_PUBLIC_BASE_URL` сейчас `https://pub-*.r2.dev` (rate-limited dev-URL); для прод-нагрузки
рекомендуется подключить custom domain через Cloudflare. Доступы лежат в GitHub Actions secrets
и локально в `.env.local` / `malakhov-ai-keys.env`.

`NEXT_PUBLIC_R2_PUBLIC_BASE_URL` нужен только при переезде R2 на custom domain (host ≠ `*.r2.dev`):
тогда клиентский `isR2ImageUrl` должен знать новый host. Это `NEXT_PUBLIC_*`, т.е. значение
инлайнится в клиентский бандл на этапе build, и для его применения нужен **редеплой**.
Legacy-флаг `NEXT_PUBLIC_R2_IMAGE_VARIANTS` больше не используется в рендере: после полного
backfill R2-варианты считаются обязательным инвариантом для всех R2 WebP cover URL.

`INDEXNOW_KEY` — ключ протокола IndexNow для ускорения индексации Yandex / Bing.
Значение публичное (это не секрет, а доказательство владения доменом). Используется
двумя местами: `app/indexnow.txt/route.ts` отдаёт его как тело файла,
`lib/indexnow.ts::pingIndexNow` подставляет в payload. Без переменной `pipeline/publish-verify.ts`
no-op-ит ping и логирует `INDEXNOW_KEY not set`. Файл `https://news.malakhovai.ru/indexnow.txt`
должен возвращать ровно содержимое env (IndexNow проверяет совпадение при каждом запросе).
Хранить ключ нужно одновременно в Vercel Project Settings (для рендера `/indexnow.txt`) и в
GitHub Actions secrets (для cron `publish-verify.yml`, который читает env и вызывает
`pingIndexNow` после каждого `published_live` перехода).

`CRON_SECRET` обязателен для эндпоинтов под Vercel Cron (см. `vercel.json`):
Vercel автоматически добавляет `Authorization: Bearer ${CRON_SECRET}` к
исходящим cron-запросам, route-ы (`/api/cron/*`) проверяют этот заголовок и
отвечают 401 без него.

Аварийные/настроечные переменные:

- `PUBLISH_RPC_DISABLED=1` — только emergency bypass для `publish-verify`: временно возвращает legacy update вместо RPC `publish_article` и поднимает warning alert `publish_rpc_bypass_active`.
- `EDITORIAL_ROUTING_MODE=cheap|balanced|premium` — experimental multi-provider routing surface. Default должен оставаться `premium`, то есть текущий Claude Batch path.
- `EDITORIAL_WRITER_PROVIDER=deepseek|anthropic` — override writer provider для routing lab/будущего worker-а. Для production без явного cutover не задавать.
- `EDITORIAL_REVIEW_POLICY=none|selective|always` — политика compact Claude reviewer. Default для `cheap` и `premium` — none; для `balanced` — selective.
- `EDITORIAL_SOURCE_TEXT_CAP` — cap исходного текста в Anthropic premium prompt; default `15000`. Текст режется по границе абзаца/слова и завершается маркером `[текст сокращён]`.
- `DEEPSEEK_REPAIR_MODEL` — модель дешёвого repair-pass для распарсенного editorial JSON, который провалил deterministic validator. Default наследуется от DeepSeek writer model.
- `DEEPSEEK_DAILY_BUDGET_USD` — hard logical cap для `editorial:routing --apply`; default в workflow `$0.25`.
- `DEEPSEEK_TELEGRAM_CAPTION_MODEL` — модель для Telegram channel captions; default `deepseek-v4-flash`.
- `DEEPSEEK_TELEGRAM_CAPTION_DAILY_BUDGET_USD` — отдельный hard cap для Telegram captions; default `$0.05` в сутки.
- `DEEPSEEK_TELEGRAM_CAPTION_TIMEOUT_MS` — timeout одного caption-call; default `45000`.
- `QUALITY_JUDGE_MODEL` — модель ежедневного LLM-judge; default `claude-haiku-4-5`.
- `TITLE_FIX_MODEL` — модель ручного backfill-а оборванных `ru_title`; default `claude-haiku-4-5`.
- `OPENAI_IMAGE_DAILY_BUDGET_USD` — hard logical cap для AI cover workflow/ручного backfill; текущий workflow задаёт `$1`.
- `TELEGRAM_OWNER_USER_ID` — Telegram user id владельца, которому разрешены one-tap quality feedback callbacks. Если не задан, route может проверить `TELEGRAM_OWNER_USERNAME` или использовать `TELEGRAM_ADMIN_CHAT_ID` как chat fallback.
- `TELEGRAM_OWNER_USERNAME` — optional username владельца без `@` или с ним; fallback для quality feedback callbacks, если user id заранее неизвестен.
- `TELEGRAM_FEEDBACK_SECRET_TOKEN` — secret token Telegram webhook-а `/api/tg-feedback`. Если не задан, используется `CRON_SECRET`.
- `TELEGRAM_IMMEDIATE_ALERT_MIN_SEVERITY=critical|warning|info|none` — порог мгновенных Telegram-пушей из `fireAlert`. Default `critical`: warning/info пишутся в `pipeline_alerts`, но не шумят в чат до утренне-вечерней ops-сводки.
- `TELEGRAM_IMMEDIATE_ALERT_TYPES=alert_a,alert_b` — точечный allow-list типов, которые нужно отправлять мгновенно независимо от severity.

### Инвариант для URL-переменных

`NEXT_PUBLIC_SITE_URL` (и любые другие host-env) **обязательно** читать через `readSiteUrlFromEnv()` из `lib/site.ts`. Helper делает `trim()`, срезает trailing `/`, и валидирует формат `^https?://[^\s]+$`. Сырое чтение `process.env.NEXT_PUBLIC_SITE_URL` запрещено.

Публичные CTA/social URL из `NEXT_PUBLIC_*` тоже нельзя подставлять в `href` сырым env-значением.
Для таких ссылок использовать `readPublicUrlFromEnv()` / готовые константы из `lib/site.ts`
(`TELEGRAM_CHANNEL_URL`, `PERSONAL_TELEGRAM_URL`): helper делает `trim()`, срезает trailing `/`
и валидирует отсутствие whitespace. Это защищает `/services`, `AuthorCard` и guide CTA от
Vercel env values с accidental trailing newline.

Почему: 2026-05-04 в Vercel UI значение `NEXT_PUBLIC_SITE_URL` сохранилось с trailing `\n` (вероятно, при сохранении ввели Enter в поле значения). Старая нормализация `(env ?? '').replace(/\/$/, '')` срезала только slash, `\n` доезжал до `<a href="...">` в Telegram-дайджесте, ссылка переставала быть кликабельной (HTML parse ломался на whitespace внутри атрибута). Helper кидает на любой невалидный формат — preflight дайджеста после этого вернёт `preflight_failed` вместо тихой отправки битой разметки.

## GitHub Actions

| Workflow | Расписание | Назначение |
|---|---|---|
| `rss-parse.yml` | каждые 30 минут | ingest RSS-источников |
| `enrich.yml` | каждые 30 минут | recover + cost-guard pre-check + fallback-first editorial routing |
| `enrich-collect-batch.yml` | каждые 15 минут | collect/apply готовых batch results |
| `recover-batch-stuck.yml` | каждые 30 минут | recovery для stuck batch poll/apply (включая null-poll auto-rescue) |
| `publish-verify.yml` | каждый час, на 20 минуте | проверка live-публикации |
| `retry-failed.yml` | каждые 4 часа, на 30 минуте | возврат retryable статей |
| `pipeline-health.yml` | каждые 2 часа, на 45 минуте | source health, backlog, provider guard, cost guard |
| `ops-report.yml` | утром после первого Telegram-поста + вечером | Telegram ops-сводка в admin chat |
| `quality-feedback.yml` | ежедневно 08:15 UTC / 11:15 МСК | LLM-judge выборки статей и один one-tap feedback-пост в admin chat |
| `ai-covers.yml` | каждые 2 часа, на 10 минуте | дешёвые OpenAI Images low cover для live-статей без обложки |
| `docs-guard.yml` | push/pull request | проверка doc-impact |
| `ci.yml` | push в `main` и `codex/evergreen-quality-standard-2026-05-21` / pull request | quality-гейт качества кода |

### CI quality gate (`ci.yml`)

С 2026-05-29 на каждый PR, push в `main` и push в production-ветку
`codex/evergreen-quality-standard-2026-05-21` запускается `ci.yml` с двумя job'ами
(production-код деплоится прямым пушем в codex-ветку, поэтому гейт должен покрывать и её):

- **`quality`** (без секретов) — `npx tsc --noEmit` + `npm run lint` + `npm test`. `npm test`
  гоняет весь сьют `tests/node/*.test.ts` (239 тестов, не требуют env). Это основной gate.
- **`build`** — `npm run build`. ISR-страницы с `generateStaticParams` (например
  `app/sources/[source]`) дёргают Supabase на этапе сборки, поэтому job требует public-read
  секретов: `SUPABASE_URL`, `SUPABASE_ANON_KEY` (прокидываются и как `NEXT_PUBLIC_*`). Если
  `SUPABASE_ANON_KEY` в GitHub-секретах не задан, job не падает, а self-skip'ается с warning —
  включится автоматически после добавления секрета. (`SUPABASE_ANON_KEY` настроен в репо
  2026-05-29 → build-гейт активен, больше не self-skip'ается.)
  Article recommendations на `/categories/<category>/<slug>` во время build отключены через
  `process.env.npm_lifecycle_event === 'build'`: иначе каждая SSG-страница делает 2–4 широких
  Supabase-запроса рекомендаций, и Vercel/Next может уронить deployment по 60s page timeout.
  Runtime ISR по-прежнему считает рекомендации.
  `next.config.mjs` ограничивает static generation concurrency (`maxConcurrency=2`,
  `minPagesPerWorker=10`, `retryCount=3`), потому что SSG/ISR-страницы массово читают Supabase
  во время build; дефолтная параллельность Next.js 15 может вызвать PostgREST statement timeout
  и сорвать deploy без изменения кода страниц.

Рекомендуется сделать оба job'а required status checks для ветки `main`.

DeepSeek editorial routing runs from `enrich.yml` in `cheap` mode. Anthropic Batch remains the
fallback path and is still collected by `enrich-collect-batch.yml`.
`enrich.yml` and `ai-covers.yml` use GitHub Actions concurrency groups so scheduled runs do not
overlap when provider latency is high.

> **Telegram delivery с 2026-06-01:** старый один-message дайджест заменён на 5 отдельных
> channel posts в течение дня. `tg-digest.yml` удалён, `/api/cron/tg-digest` оставлен как
> disabled legacy endpoint и не отправляет сообщения.

### Недельный Telegram-отчёт

Каждый понедельник в **11:00 МСК** Supabase job `tg-weekly-report` (`0 8 * * 1` UTC) вызывает
`GET /api/cron/tg-weekly-report`. Route собирает предыдущую полную неделю Пн–Вс и отправляет
один отчёт в `TELEGRAM_ADMIN_CHAT_ID`; GitHub Actions backup
`.github/workflows/tg-weekly-report-backup.yml` повторяет запуск в 11:20 МСК. Таблица
`weekly_report_runs` и функция `claim_weekly_report_run` не допускают повторной отправки одной
недели primary/backup runner-ами. `running`-claim можно перехватить только после 15 минут, а
`failed` — при следующем запуске.

Production default — `TELEGRAM_WEEKLY_REPORT_FORMAT=business`; допустимы
`signal|business|channel`. Три варианта для редакционного выбора отправляются только вручную и
не создают run-log:

```bash
npm run tg-weekly-report -- --week-start=2026-06-15 --format=all --dry-run \
  --pin=novyy-benchmark-aa-briefcase-luchshaya-model-ii-reshaet-lish-3-zadach
npm run tg-weekly-report -- --week-start=2026-06-15 --format=all --send=admin --markers \
  --pin=novyy-benchmark-aa-briefcase-luchshaya-model-ii-reshaet-lish-3-zadach
```

Диагностика:

```sql
select jobid, jobname, schedule, active from cron.job where jobname = 'tg-weekly-report';
select week_start, format, status, article_ids, telegram_message_id, error, updated_at
  from weekly_report_runs order by week_start desc limit 10;
```

## Cron-расписание Telegram channel posts

Telegram-посты в штатном режиме дёргаются через Supabase `pg_cron` + `pg_net`; GitHub Actions
запускает независимый backup-runner через 5 минут после каждого slot. Каждый запуск вызывает один slot:
`/api/cron/tg-channel-post?slot=1..5`. Таблица `telegram_channel_posts` хранит план и delivery
state по каждому слоту; UNIQUE `(delivery_date, slot_no, channel_id)` гарантирует, что один
slot не отправится дважды.

Если ранний cron/pg_net missed и дневной план впервые создаёт более поздний slot, runner не
оставляет просроченные строки висеть: `runChannelPost(slot=N)` отправляет все `planned`/`failed_send` слоты
`<= N` по порядку и затем текущий slot. Это catch-up только по строкам текущего `delivery_date`;
`success`, `sending` и `skipped_*` не переотправляются, чтобы не дублировать уже забранный или
заведомо пропущенный slot.

### Primary — Supabase pg_cron + pg_net (минутная точность)

| Job | Расписание (UTC) | МСК | Дни |
|---|---|---|---|
| `tg-channel-post-1` | `30 6 * * *` | 09:30 | ежедневно |
| `tg-channel-post-2` | `30 9 * * *` | 12:30 | ежедневно |
| `tg-channel-post-3` | `30 12 * * *` | 15:30 | ежедневно |
| `tg-channel-post-4` | `30 15 * * *` | 18:30 | ежедневно |
| `tg-channel-post-5` | `0 18 * * *` | 21:00 | ежедневно |

`pg_cron` работает внутри Supabase Postgres, расписания исполняются с точностью до секунд.
`pg_net.http_get` дёргает `https://news.malakhovai.ru/api/cron/tg-channel-post?slot=N` с
заголовком `Authorization: Bearer <secret>`, секрет хранится в `vault.secrets` под именем
`cron_bearer_token` и читается через `vault.decrypted_secrets`.

Caption генерируется в `bot/channel-post-core.ts` как два абзаца: жирный заголовок и короткий
редакционный body. При создании нового daily plan runner сначала пытается DeepSeek через
OpenAI-compatible API (`DEEPSEEK_API_KEY`, `DEEPSEEK_BASE_URL`, `DEEPSEEK_TELEGRAM_CAPTION_MODEL`),
валидирует JSON `{title, body}` и пишет usage/cost в `llm_usage_logs` с
`operation='deepseek_tg_channel_caption'`. Запрещены старые шаблонные формулы (`не просто`,
`не только`, `главное не`, `смотрим не на хайп`, `это не`, `а значит`) и сервисные ярлыки вроде
`Зачем открыть`. Если ключа нет, budget cap достигнут или ответ невалиден, fallback безопасный:
`<b>clean ru_title</b>` + `tg_teaser`, без локального angle-слоя. Лимит Telegram photo caption
соблюдается консервативно: итоговая HTML-строка удерживается ≤ 1024 символов.

С 2026-06-05 runner не передаёт `cover_image_url` в Telegram как внешний URL. Перед `sendPhoto`
он сам скачивает картинку (`GET`, timeout 15s, max 10 MB, только `jpeg/png/webp`) и отправляет её
multipart upload. Это убирает класс отказов `Bad Request: failed to get HTTP URL content`, когда
сторонний CDN доступен сайту/оператору, но Telegram не может скачать URL со своих IP. Если
prefetch не проходит, слот остаётся `failed_send` с явной причиной `Telegram photo prefetch ...`.

Конфигурация — в `supabase/migrations/017_telegram_channel_posts.sql`. Эта миграция также
unschedule-ит legacy `tg-digest-weekday` и `tg-digest-weekend`. Секрет в Vault создаётся
**один раз** руками:

```sql
SELECT vault.create_secret('Bearer <CRON_SECRET>', 'cron_bearer_token', '...');
```

Диагностика:

```sql
SELECT jobid, jobname, schedule, active FROM cron.job WHERE jobname LIKE 'tg-channel-post-%';
SELECT jobid, runid, start_time, status, return_message
  FROM cron.job_run_details
 WHERE jobid IN (SELECT jobid FROM cron.job WHERE jobname LIKE 'tg-channel-post-%')
 ORDER BY runid DESC LIMIT 10;
SELECT id, status_code, content::text, created FROM net._http_response ORDER BY id DESC LIMIT 5;
SELECT delivery_date, slot_no, status, article_id, telegram_message_id, sent_at, error_message
  FROM telegram_channel_posts ORDER BY delivery_date DESC, slot_no DESC LIMIT 10;
```

### Backup — GitHub Actions

Workflow `.github/workflows/tg-channel-post-backup.yml` запускается на тех же пяти slot-ах с
лагом 5 минут:

| Cron (UTC) | МСК | Slot |
|---|---:|---:|
| `35 6 * * *` | 09:35 | 1 |
| `35 9 * * *` | 12:35 | 2 |
| `35 12 * * *` | 15:35 | 3 |
| `35 15 * * *` | 18:35 | 4 |
| `5 18 * * *` | 21:05 | 5 |

Runner: `npm run tg-channel-post:backup`. Он мапит `github.event.schedule` на slot через
`lib/tg-channel-schedule.ts`, а затем вызывает тот же `runChannelPost(slot)`, что и
Supabase/Vercel route. Поэтому backup не создаёт второй delivery-path: idempotency остаётся в
`telegram_channel_posts` (`status='success'` не переотправляется; `sending` считается уже
забранным; missed `planned` и `failed_send` slots `<= N` catch-up-ятся по порядку).

Manual dispatch: запусти workflow с `slot=1..5` или локально:

```bash
npm run tg-channel-post:backup -- --slot=3
```

GitHub Secrets, которые нужны backup workflow: `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`,
`TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHANNEL_ID`; `DEEPSEEK_API_KEY` опционален, без него caption
уйдёт через локальный fallback. `NEXT_PUBLIC_SITE_URL` в workflow зафиксирован как
`https://news.malakhovai.ru`.

### Supabase RLS на public-таблицах (advisor `rls_disabled_in_public`)

Все рабочие таблицы в `public` имеют RLS (см. `20260423195035_enable_public_article_rls.sql`,
`013`, `008`, `006`, `017`). `articles`/`categories` отдают данные анону осознанно через
read-policy; остальные закрыты (анон-`count`=0). View `batch_enrich_operational_state` —
`security_invoker = true`, уважает RLS статей, отдельный фикс не нужен.

Инцидент 2026-06-01 (Supabase security email): две backup-таблицы, созданные руками через
`CREATE TABLE AS` вне истории миграций, остались без RLS и читались публичным anon-ключом:
`articles_category_migration_backup_20260425` (581 строк) и `articles_cover_snapshot_20260507`
(764). Фикс — `supabase/migrations/20260602120000_secure_backup_tables_rls.sql`
(`enable row level security`, без политик: service_role обходит RLS, анон теряет доступ, данные
сохранены). Урок: **ad-hoc backup-таблицы тоже создавать с RLS** (или дропать после миграции).

Проверка дрейфа «прод ≠ миграции» (read-only, anon-ключом): запросить
`GET <SUPABASE_URL>/rest/v1/` (OpenAPI-спека перечисляет все public-таблицы/вьюхи), затем
анон-`count` по каждой — `count`>0 на внутренней таблице = RLS выключен.

### Vercel: production branch и GitHub default branch (две разные «main»)

В проекте две независимые «дефолтные ветки», и их легко перепутать:

1. **Vercel Production Branch** = `codex/evergreen-quality-standard-2026-05-21` (с 2026-05-23).
   Меняется только в Vercel UI: Project Settings → **Environments** → Production → Branch Tracking
   (на странице **Git** этого поля в новом UI больше нет). Каждый push в codex создаёт
   Production Deployment и авто-промоутится на `news.malakhovai.ru` (Auto-assign Custom
   Production Domains = Enabled). Push в `main` → обычный Preview, прод не трогает.
2. **GitHub default branch** = `main` (не менялся). Scheduled GitHub Actions берут определения
   workflow-файлов именно с дефолтной ветки GitHub, поэтому workflow-файлы лежат в `main`, а
   `actions/checkout` в них пинится `ref: codex/evergreen-quality-standard-2026-05-21`, чтобы
   cron выполнял production-код (новый scorer, needsAiCover, и т.д.). **Эти pin'ы убирать нельзя**,
   пока GitHub default branch = main.

Что НЕ нужно (исторический контекст): раньше Vercel Production Branch указывал на `main`,
поэтому push ci-фиксов в main триггерил Production-билд из stale main и **перетирал alias**
на старый код без `/about`, `/search`, гайдов (инцидент 2026-05-22 evening). Временной
заплаткой был `commandForIgnoringBuildStep` (`if [ "$VERCEL_GIT_COMMIT_REF" = "main" ]; then
exit 0; else exit 1; fi`), снятый 2026-05-23 после смены Production Branch на codex — теперь
защита структурная, заплатка не нужна.

Vercel REST API смену Production Branch не поддерживает (проверено PATCH/POST на
`/v9/projects/{id}`, `/v9/projects/{id}/link`, `/v9/projects/{id}/branches`) — только UI.
`commandForIgnoringBuildStep` ставится/снимается через `PATCH /v9/projects/{id}`
с body `{"commandForIgnoringBuildStep": "<script>" | null}`.

Долгосрочно стоит слить `codex/...` в `main` и сделать обе дефолтные ветки одной — тогда
и pin'ы, и раздвоение исчезнут. Это отдельная задача (10 main-only коммитов vs 30+ codex-only).

### Vercel Cron

`vercel.json` больше не содержит Telegram cron entries. Vercel Hobby плохо подходит для
пяти точных отправок в день; primary schedule — Supabase `pg_cron`, backup schedule —
GitHub Actions `tg-channel-post-backup.yml`. Route `/api/cron/tg-channel-post?slot=N`
остаётся Vercel serverless endpoint-ом, но primary вызывает его из Postgres через `pg_net`;
backup вызывает `runChannelPost(slot)` напрямую из Node.

Vercel Cron на Hobby plan имеет два жёстких ограничения:

1. **Один firing в день** на entry. Multi-firing expression вроде `0,30 6,7 * * 1-5` отклоняется при deploy с ошибкой `deploy_failed: Hobby accounts are limited to daily cron jobs`.
2. **Best-effort timing** — задержка до часа от запланированного времени.

Реализация: `app/api/cron/tg-channel-post/route.ts` → `runChannelPost(slot)` из
`bot/channel-post-core.ts`. Авторизация через `Authorization: Bearer ${CRON_SECRET}`.

Ручной триггер:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" "https://news.malakhovai.ru/api/cron/tg-channel-post?slot=1"
npm run tg-channel-post -- --slot=1
```

### Cost-guard и hard-stop

`pipeline/cost-guard.ts` теперь экспортирует `getDailyBudgetStatus()`. Эта функция используется в начале `enrich-submit-batch` для **проактивной** блокировки submit, если расход за сегодня (МСК) уже превысил `CLAUDE_DAILY_BUDGET_USD` (workflow-конфиг `$2` с 2026-05-05 — см. историю расхода ниже, default в коде остаётся `$1`). Submit пропускается без claim, алёрт `enrich_submit_blocked_budget` идёт админу. Это hard-stop, работающий на уровне функции независимо от cron-расписания cost-guard.

Дополнительно cost-guard теперь запускается как pre-step в `enrich.yml` каждые 30 минут (а не только раз в 2 часа в `pipeline-health.yml`).

### Pipeline alerts

Мгновенные Telegram-пуши из `pipeline/alerts.ts::fireAlert` по умолчанию уходят
только для `severity='critical'`. `warning` и `info` остаются в `pipeline_alerts`
с cooldown/dedup и попадают в регулярную ops-сводку. Это снижает шум: оператор
получает два плановых отчёта в день, а вне расписания — только действительно
критичные события. Для временного усиления шума можно поставить
`TELEGRAM_IMMEDIATE_ALERT_MIN_SEVERITY=warning` или добавить конкретный тип в
`TELEGRAM_IMMEDIATE_ALERT_TYPES`.

- `anthropic_unavailable` — critical, cooldown 1 час, entity `anthropic`. Это одновременно
  operator alert и persisted degraded-флаг: все cron-workers читают open alert
  `anthropic_unavailable:anthropic`.
- `claude_parse_failed` — warning, cooldown 4 часа, dedupe по `batch_id`. Срабатывает
  в `enrich-collect-batch`, когда Claude batch result не содержит `output_text` или JSON не
  парсится. Это терминальные ошибки (`PERMANENT_ERRORS`): структуру ответа починить
  ретраем нельзя.
  - **Editorial validation отдельно от parse (фикс 2026-06-04).** Раньше любой провал
    `validateEditorialDetailed` (включая мягкие правила «lead без конкретного якоря в первом
    предложении», длины, banned-фразы) тоже маппился в `claude_parse_failed` →
    `apply_failed_terminal`, и полностью сгенерированная статья **навсегда** уходила в
    `enrich_status=failed` без ретрая. За 14 дней так терялось 17 статей и пересыхал поток
    live-публикаций. Теперь: если JSON распарсился и `quality_ok=true`, провал валидации —
    это `editorial_validation_failed` (∈ `RETRYABLE_ERRORS`): статья уходит в `retry_wait` и
    переотправляется новым батчем (до `maxAttempts=3`), потому что output модели
    стохастичен и свежий прогон обычно проходит. Алёрт `claude_parse_failed` (severity
    `info`) теперь поднимается только когда статья действительно терминальна (исчерпала
    ретраи) — self-healing re-roll не шумит. Если `quality_ok=false` (Claude сам признал
    источник непубликуемым, напр. оффтоп), статья закрывается терминально как
    `quality_reject` без бесполезных ретраев.
  - **Lead anchor: Cyrillic-фикс (2026-06-04).** Доминирующая причина провалов —
    `lead без конкретного якоря в первом предложении`. Детектор якоря в `pipeline/claude.ts`
    (`sentenceHasAnchor`) проверял кириллические имена через `\b[А-ЯЁ]…`, но JS `\b`
    работает только по ASCII, поэтому русские имена собственные (Овчинников, Диасофт,
    Яндекс) **молча** не считались якорем — хорошие лиды отбраковывались. Добавлен
    `hasCyrillicProperNoun` (Title-case кириллическое слово не в начале предложения; all-caps
    `ИИ`/`ИТ` исключены). Плюс `repairEditorialOutput` теперь делает `reorder_lead_anchor`:
    если якорь есть, но не в первом предложении, предложение с якорем поднимается вперёд
    (без потери контента, до `shortenLead`). На исторической выборке это детерминированно
    (без re-roll) спасает ~59% провалившихся лидов; остаток уходит в retryable re-roll.
- `lease_expired_spike` — warning, cooldown 2 часа. `recover-stuck` поднимает его,
  если за один запуск восстановлено больше 3 pre-submit статей с истёкшей lease.
- `llm_usage_log_write_failed` — warning, cooldown 4 часа. `writeLlmUsageLog`
  поднимает его при ошибке записи в `llm_usage_logs`; ошибка не пробрасывается наружу,
  чтобы collect-batch не падал из-за cost-observability.
- `publish_rpc_bypass_active` — warning, cooldown 6 часов. Срабатывает, если
  `PUBLISH_RPC_DISABLED=1` и `publish-verify` вынужден публиковать legacy update-ом
  вместо RPC `publish_article`. После снятия флага первый успешный RPC-переход
  resolve-ит этот alert.

### Anthropic degraded mode

Degraded-режим включается автоматически, если `provider-guard` или batch submit видит billing /
credits error Anthropic (`credit balance is too low`, 401/403 billing) либо серию временных
недоступностей API. Состояние хранится как open alert `anthropic_unavailable:anthropic` в
`pipeline_alerts`, поэтому режим переживает отдельные GitHub Actions runs.

Поведение в degraded:

- `enrich-submit-batch` не создаёт новые Anthropic Batch jobs.
- `scripts/run-editorial-routing.ts` продолжает low-risk DeepSeek path без Claude reviewer и
  без premium fallback, помечая `degraded=true` в `llm_usage_logs` и attempt payload.
- high-risk/premium candidates паркуются в `retry_wait` с
  `last_error_code='anthropic_degraded'` и `next_retry_at` примерно через 6 часов.
- `pipeline/retry-failed.ts` не возвращает такие parked статьи, пока open alert активен.

Recovery: `provider-guard` делает дешёвый Anthropic probe. При успехе он resolve-ит alert,
отправляет Telegram recovery push и освобождает parked high-risk статьи обратно в `retry_wait`,
чтобы следующий обычный routing/batch run обработал очередь.

```bash
npm run cost:report
npx tsx pipeline/provider-guard.ts
```

Если деградация включилась из-за billing, сначала пополнить Anthropic credits, затем запустить
`pipeline-health.yml` вручную или локально `npx tsx pipeline/provider-guard.ts` с production env.

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

### Cover-from-inline backfill

Для статей, у которых AI-cover был сгенерирован поверх вполне пригодных inline-картинок
(последствие старой логики `needsAiCover()` — см.
`docs/spec_2026-05-22_digest_editorial_priority.md` Wave 2), есть точечный скрипт
`scripts/backfill-cover-from-inline.ts`. Он не вызывает OpenAI и не фетчит исходник: работает
только с уже сохранёнными `article_images` через `lib/media-sanitizer.ts::sanitizeArticleMedia`
с `coverImageUrl: null`, чтобы посмотреть, что промоутится из inline.

Команды:

```bash
npx tsx scripts/backfill-cover-from-inline.ts --dry-run
npx tsx scripts/backfill-cover-from-inline.ts --slug=<slug> --dry-run
npx tsx scripts/backfill-cover-from-inline.ts --slug=<slug> --apply
npx tsx scripts/backfill-cover-from-inline.ts --limit=20 --apply
```

Правила:

- default — dry-run; `--apply` обязателен для записи;
- скан включает только статьи с `cover_image_url LIKE '%/article-images/ai-covers/%'`
  и непустым `article_images` (template/stock не трогаются — это легитимный fill-in);
- broader backfill (28 Habr/CNews/Hugging Face статей в архиве) применён 2026-05-23 после
  spot-check: cover'ы вернулись на habrastorage / leonardo.osnova / source-CDN URL'ы;
  2 CNews-статьи с `static.cnews.ru/img/articles/.../gemini_generated_image_*.png`
  оставлены на AI-cover, потому что CNews использует этот placeholder для разных статей
  без фото — promote такого URL дал бы одинаковую обложку на разные материалы. Sanitizer
  теперь отбрасывает `gemini_generated_image` / `ai_generated_image` URL'ы как
  `stock_placeholder` (`lib/media-sanitizer.ts`).

### `scripts/generate-ai-covers.ts` после Wave 2/4

`needsAiCover()` принимает решение через `sanitizeArticleMedia` со ВСЕМ доступным медиа
(`cover_image_url + article_images`). Старый хардкод `['Habr AI','vc.ru','vc.ru AI/стартапы',
'CNews']` убран — для статьи с реальным фото в `article_images` AI-cover не генерируется.
Template/stock-обложки остаются заменяемыми. SELECT в `selectArticles` тащит `article_images`.

`chooseScene()` (Wave 4) делает контекстный матч до старой regex-цепочки: при двойном
сигнале `PRODUCT_LAUNCH_NOUN_RE + ANNOUNCEMENT_VERB_RE` → сцена `product_launch`
(tactile hardware close-up), при `MODEL_RELEASE_RE + ANNOUNCEMENT_VERB_RE` → `model_release`
(foundation-model launch tableau), при `PEOPLE_NEWS_RE` → `people_news` (institutional
silhouettes). Это убирает типичный фейл «Russian enterprise operations room» для статьи
про конкретный продукт. Тесты — `tests/node/scene-matcher.test.ts`.

Файл получил CLI-entry guard: `main()` вызывается только при прямом запуске
`npx tsx scripts/generate-ai-covers.ts`, а не при импорте из тестов. Тесты теперь могут
импортировать `classifyScene` без побочных DB-touch'ей.

### Re-score recent articles

`scripts/rescore-recent.ts` — точечный пересчёт `articles.score` по текущей формуле
`pipeline/scorer.ts` для свежих live-статей. Нужен после изменения scorer-формулы (типичный
случай — Wave 1 из `docs/spec_2026-05-22_digest_editorial_priority.md`), чтобы уже
опубликованные за последние дни материалы попали в ближайший дайджест по новой логике,
а не по submit-этапной формуле.

```bash
npx tsx scripts/rescore-recent.ts --dry-run            # 3-day window
npx tsx scripts/rescore-recent.ts --apply
npx tsx scripts/rescore-recent.ts --days=7 --apply
```

Скрипт не вызывает Claude/OpenAI/fetcher, работает только со строками в БД. Печатает
распределение diff'ов и top-15 изменений перед apply.

### Withdraw off-topic articles

`scripts/withdraw-off-topic.ts` — снимает с публикации (`publish_status='withdrawn'`) живые
статьи, ранжирующиеся по не-AI запросам. Список slug'ов захардкожен и собран по экспорту
топ-запросов Яндекс.Вебмастера (T5 из `docs/spec_2026-06-01_organic_growth_implementation.md`).
Механизм обратимый: статья уходит из ленты / sitemap / индекса (страница отдаёт 404), строка
остаётся в БД — вернуть можно установив `publish_status='live'` обратно.

```bash
npx tsx scripts/withdraw-off-topic.ts                       # dry-run: печатает title/lead/category
npx tsx scripts/withdraw-off-topic.ts --apply              # снять DEFINITE-список
npx tsx scripts/withdraw-off-topic.ts --include-borderline --apply
```

Запуск 2026-06-01 (волна 1): сняты 8 статей (все — старые ZDNet consumer-reviews, просочившиеся до
включения `needsKeywordFilter` у ZDNet): NAS-гайд, 2× Sony-наушники, 2× NordVPN, RS-232,
Android-файл-менеджер, Fitbit/Whoop. Borderline оставлены live (`falcongaze` — DLP с AI-фильтрацией,
`flutter-3.44` — Agentic Hot Reload), у них есть реальная AI-грань. Скрипт не вызывает
Claude/OpenAI/fetcher.

Запуск 2026-06-10 (волна 2, по сплошному sweep'у live-статей в рамках
`docs/spec_2026-06-10_digest_full_audit.md`): сняты ещё **37** статей того же класса —
VPN-подборки ×7, наушники/аудио/ТВ ×10, пылесосы/гаджеты/распродажи ×11, Windows/Linux без
AI-грани ×9. Новые borderline (оставлены live): `meta-...-rasprodazhu-ray-ban-s-ii` (AI-очки),
`google-vypustila-desktopnoe-prilozhenie-dlya-windows` (Gemini-приложение). 404 проверен live;
sitemap очищается по ISR.

### Audit Telegram digest selection

`scripts/audit-digest-selection.ts` — read-only retro-аудит отбора Telegram-дайджеста.
Нужен после жалоб на повторяющиеся инфоповоды или перед изменением selector-а.

```bash
npm run digest:audit-selection -- --date=2026-05-30
npm run digest:audit-selection -- --days=14
```

Скрипт реконструирует eligible pool за digest date, показывает старый source-only selector
и текущий story-aware selector (`bot/digest-selection.ts`), а также причины skipped:
`duplicate_story`, `recent_story_duplicate`, `primary_entity_cap`, `source_cap`.
По incident 2026-05-30 он должен показывать:

- 2026-05-29: второй материал про Anthropic funding пропущен как `duplicate_story`;
- 2026-05-30: The Decoder про тот же Anthropic funding пропущен как
  `recent_story_duplicate`, а Claude Opus 4.8 остаётся как отдельный `model_release`.

### Source cover backfill

Для восстановления отсутствующих source cover и удаления плохих SVG/placeholder cover используется
`scripts/backfill-cover-images.ts`. Скрипт не вызывает Claude и не меняет editorial text: он фетчит
исходную страницу через `pipeline/fetcher.ts` с `includeText=false`, применяет media sanitizer и
обновляет только `cover_image_url` / `article_images`.

Команды:

```bash
npx tsx scripts/backfill-cover-images.ts --dry-run
npx tsx scripts/backfill-cover-images.ts --dry-run --limit=50
npx tsx scripts/backfill-cover-images.ts --dry-run --slug=<slug>
npx tsx scripts/backfill-cover-images.ts --apply --limit=50
```

Правила:

- default mode — dry-run, без DB writes;
- `--apply` обязателен для записи;
- перед apply нужно просмотреть `processed`, `updated`, `still_empty`, `fetch_failed`, `by_source` и examples;
- скрипт обрабатывает live-статьи за последние 30 дней, где текущий cover отсутствует или отбрасывается sanitizer-ом;
- при массовом `--apply` перед запуском сделать SQL-снапшот `cover_image_url` / `article_images`;
- apply пишет rollback-audit в `tmp/cover-backfill-audit-*.jsonl`.

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
- `--apply` скачивает stock image, накладывает editorial treatment через `sharp`, загружает WebP в **Cloudflare R2** (`lib/r2.ts`, ключ `article-images/stock-covers/...`) и обновляет только `articles.cover_image_url`;
- дата трактуется как календарный день по МСК;
- если `--date` не задан, скрипт берёт последний день по `created_at` среди опубликованных статей;
- для ключей поддерживаются `.env.local` и `malakhov-ai-keys.env` (включая RTF-файл через `textutil`);
- primary provider — Pexels; Unsplash и Pixabay используются как fallback, если ключи заданы и Pexels не дал кандидатов.

### Cover storage: Supabase → R2 migration (2026-05-26)

Обложки переехали из Supabase Storage в Cloudflare R2 (egress R2 бесплатен; см. блок про `R2_*`
выше и `docs/ARTICLE_SYSTEM.md` → Cover image). Новые обложки уже пишутся в R2. Существующие
Supabase-storage обложки переносит одноразовый скрипт:

```bash
npx tsx scripts/migrate-covers-to-r2.ts --dry-run        # показать план
npx tsx scripts/migrate-covers-to-r2.ts                  # выполнить
npx tsx scripts/migrate-covers-to-r2.ts --limit 50       # ограничить пачку
```

Правила:

- требует **разблокированного Supabase** — скрипт скачивает байты из Storage и переписывает
  `articles.cover_image_url`; при `exceed_egress_quota` падает на SELECT;
- идемпотентен: берёт только статьи с `cover_image_url LIKE '%/storage/v1/object/public/article-images/%'`;
- ключ объекта в R2 = путь после `/article-images/` (uploadToR2 префиксует `article-images/`),
  поэтому сегменты `ai-covers/`/`template-covers/`/`stock-covers/` сохраняются.

Применено 2026-05-26: `migrated=453, failed=0`.

> **Recovery-урок (2026-05-26).** Не делать прод-редеплой, пока Supabase под egress-рестрикшеном.
> Сайт во время блокировки держится только на тёплом stale ISR-кеше предыдущего деплоя; новый
> прод-деплой сбрасывает кеш, а свежая ревалидация не может прочитать БД (402) → страницы
> рендерятся пустыми (`/api/feed` total:0), хотя данные в `articles` целы. Восстановление —
> только разблокировка Supabase + редеплой (откат Vercel на тёплый кеш на Hobby недоступен:
> «To rollback further than the previous production deployment, upgrade to pro»).

### Responsive cover variants (R2 + `<img srcset>`)

Адаптивная раздача обложек без Vercel-оптимизатора (`/_next/image` выключен из-за лимита
трансформаций Hobby → HTTP 402). Рядом с base-обложкой (1200px) в R2 хранятся уменьшенные
WebP-варианты `-400`/`-800`, а рендер отдаёт их нативным `<img srcset>`. Архитектура и
файлы — в `docs/ARTICLE_SYSTEM.md` → «Responsive cover variants».

Статус: включено в production с 2026-05-29, с 2026-06-17 без env-флага. Полный backfill прогнан —
все R2-обложки (489: generated=481, skipped=8, failed=0) имеют `-400`/`-800` варианты; инвариант
закрыт. `SafeImage` и hero статьи всегда отдают `<img srcset>` для R2 WebP URL; внешние non-R2
обложки остаются на обычном `next/image` (`unoptimized:true`). Проверка: home-карточки и hero
статьи должны содержать R2 `srcset`, варианты возвращают `200 image/webp`.

Forward-аплоады (`pipeline/image-generator.ts` + cover-скрипты) уже льют варианты сами через
`uploadWebpWithVariants`; backfill существующих обложек:

```bash
npx tsx scripts/backfill-cover-variants.ts --dry-run        # показать план
npx tsx scripts/backfill-cover-variants.ts                  # сгенерить варианты
npx tsx scripts/backfill-cover-variants.ts --skip-existing  # пропустить готовые (idempotent re-run)
npx tsx scripts/backfill-cover-variants.ts --limit 50       # ограничить пачку
```

**Инвариант и проверка (важно):**

1. Перед любым изменением R2 cover forward-path прогнать `scripts/backfill-cover-variants.ts`
   до `failed=0` — у каждой R2-обложки должны
   появиться варианты. Инвариант: отсутствие варианта = 404 на выбранный
   браузером кандидат (`-400`/`-800`).
2. Замерить LCP/Network на главной и странице статьи: мобильный viewport должен выбирать
   `-400`/`-800`, а не base 1200w.
3. Откат при инциденте — кодово вернуть fallback на `next/image` для R2 и редеплой; варианты в R2
   остаются, base-URL'ы не меняются.

`remotePatterns` в `next.config.mjs` пока оставлен `**`: при `unoptimized:true` + нативной
раздаче вариантов он не несёт transform-cost/security-риска, а сузить его до фактического
списка cover-хостов хрупко (обложки приходят с множества внешних CDN). Ревизия — только если
будет возвращён Next-оптимизатор.

### AI cover backfill

Для ручного улучшения верхних карточек используется `scripts/generate-ai-covers.ts`.
Скрипт генерирует 1536x1024 WebP через OpenAI Images, сжимает до `1400x788`,
кладёт результат в **Cloudflare R2** (`article-images/ai-covers/<date>/...`) и обновляет
только `articles.cover_image_url`.

```bash
npx tsx scripts/generate-ai-covers.ts --category=ai-russia --limit=8
npm run covers:ai-low -- --category=all --latest-day --limit=8
npm run covers:ai-low -- --category=all --latest-day --days=2 --limit=12
npm run covers:ai-priority -- --daily-budget=1
npm run covers:ai-priority -- --apply --daily-budget=1
npx tsx scripts/generate-ai-covers.ts --category=ai-russia --limit=8 --apply --quality=medium
```

Правила:

- default mode — dry-run, без OpenAI вызовов, DB writes и Storage upload;
- scheduled workflow `ai-covers.yml` включён каждые 2 часа на 10-й минуте и запускает low-quality path только для последних двух московских дней с `--daily-budget=1`;
- default model — `gpt-image-1.5`, потому что `gpt-image-2` требует verified organization;
- default quality — `low` для автоматического дешёвого cover fallback; `medium`/`high` остаются ручным override для важных карточек;
- homepage-priority command `npm run covers:ai-priority -- --daily-budget=1` — dry-run/apply режим
  для двух видимых homepage-кандидатов: hot story и первого featured item в «Все новости» после
  исключения hot story. Этот режим использует `quality=medium`, `model=gpt-image-1.5`, тот же
  budget cap и пишет только `articles.cover_image_url`;
- `--category=all` отключает category filter и используется в автоматическом workflow `ai-covers.yml`;
- `--daily-budget=N` / `OPENAI_IMAGE_DAILY_BUDGET_USD` ограничивает дневной расход OpenAI Images по Москве;
- dry-run не требует `OPENAI_API_KEY`; ключ нужен только для `--apply`;
- `--model=gpt-image-2` можно использовать только после проверки доступа; при 403 списания нет;
- `--apply` пишет локальные копии и `report.json` в `tmp/ai-covers-*`;
- успешные и failed image attempts пишутся в `llm_usage_logs` как
  `provider='openai'`, `operation='image_cover_generation'`, `run_kind='image_backfill'`;
- стоимость для `gpt-image-1.5` считается по model-page per-image цене для `1536x1024`
  (`low` = `$0.013/image`, `medium` = `$0.05/image` на момент проверки 2026-05-07);
- при `Billing hard limit has been reached` остановить OpenAI backfill и закрывать только самые
  видимые пустые карточки бесплатным `scripts/replace-test-covers-with-editorial-templates.ts`.

Локальный fallback:

```bash
npm run covers:template -- --older-than-days=2 --days=30 --limit=30
npm run covers:template -- --older-than-days=2 --days=30 --limit=30 --apply
npx tsx scripts/replace-test-covers-with-editorial-templates.ts --top-russia=30 --apply
```

`scripts/backfill-template-covers.ts` закрывает старые live-статьи без видимой карточной
обложки бесплатными локальными SVG/WebP template cover-ами. Scheduled `ai-covers.yml`
запускает его после AI-step с `--older-than-days=2 --days=30 --limit=30 --apply`, чтобы
платный AI budget оставался только для свежих карточек. Скрипт не вызывает OpenAI и обновляет
только `articles.cover_image_url`.

Legacy `replace-test-covers-with-editorial-templates.ts` оставлен для точечных старых наборов
slug-ов / top-russia backfill; для общего закрытия дыр использовать `npm run covers:template`.

### Image style lab

Для выбора визуального направления OpenAI Images до production backfill используется
`scripts/image-style-lab.ts`. В отличие от `generate-ai-covers`, lab по умолчанию не пишет
в Supabase и не обновляет `articles.cover_image_url`: даже в `--apply` он сохраняет варианты
локально в `tmp/image-style-lab-*` и пишет `report.json`.

```bash
npm run image:style-lab -- --limit=5 --per-article=3 --category=all
npm run image:style-lab -- --limit=1 --per-article=2 --apply --budget=0.03
```

Стили: `editorial-photographic`, `tech-still-life`, `abstract-infrastructure`,
`documentary-collage`, `minimal-object-metaphor`.

Правила:

- default mode — dry-run, без OpenAI вызовов;
- `--apply` генерирует локальные WebP для ручного сравнения, но не делает Storage upload;
- `--budget=N` ограничивает суммарную оценочную стоимость прогона;
- production-кандидат после smoke 2026-05-09 — `tech-still-life`;
- если вариант содержит псевдотекст, fake UI или product screens, стиль/prompt нужно исправлять до массового backfill.

### Model routing lab

Для сравнения моделей на реальных статьях используется `scripts/model-routing-lab.ts`.

```bash
npm run routing:lab -- --limit=3 --missing-cover-only
npm run routing:lab -- --limit=2 --missing-cover-only --modes=deepseek-full,balanced-review --apply
```

Modes:

- `claude-full` — текущий Claude-style full article;
- `deepseek-full` — DeepSeek writer, strict validator и deterministic repair;
- `balanced-review` — deterministic brief -> DeepSeek writer -> deterministic repair -> strict validator -> selective compact Claude reviewer;
- `hybrid` — старый дорогой Claude brief -> DeepSeek -> Claude full polish, оставлен только для сравнения.

Правила:

- default mode без `--apply` не тратит API budget и пишет только dry-run estimate;
- `--apply` требует `DEEPSEEK_API_KEY` для DeepSeek modes и `ANTHROPIC_API_KEY` для reviewer/Claude modes;
- результаты пишутся в `tmp/model-routing-lab-*`;
- production default не переключать на DeepSeek, пока 20-article lab не даст приемлемый manual acceptance rate;
- `hybrid` не использовать как default: paid lab 2026-05-07 показал, что он дороже текущего Claude baseline.

### Manual editorial routing runner

Для scheduled limited rollout используется `scripts/run-editorial-routing.ts`.

```bash
npm run editorial:routing -- --limit=5
npm run editorial:routing -- --limit=5 --mode=cheap --apply
npm run editorial:routing -- --limit=5 --mode=balanced --apply
```

Правила:

- default mode — dry-run: выбирает eligible `pending`/`retry_wait`, fetch-ит источник и показывает план, но не вызывает провайдеров и не пишет в Supabase;
- `--apply` claim-ит статьи через общий article lease и не берёт строки с active Anthropic Batch ownership;
- scheduled `enrich.yml` запускает `npm run editorial:routing -- --mode=cheap --limit=15 --apply --deepseek-daily-budget=0.25` каждые 30 минут;
- `cheap` применяет DeepSeek только после deterministic repair + strict validation; hard failures и `quality_ok=false` уходят в `editorial_premium_fallback`;
- `balanced` добавляет compact Claude reviewer для high-score/money risk; reviewer reject или parse fail тоже уходит в `editorial_premium_fallback`;
- high-risk rollout guards: `ai-research`, legal/regulation, medical и geopolitics не идут напрямую через DeepSeek;
- premium fallback создаёт обычный `anthropic_batch_items`/`anthropic_batches` item, поэтому collector и recovery остаются текущими;
- usage пишется в `llm_usage_logs` с operation names `deepseek_editorial_writer`, `claude_selective_reviewer`, `editorial_premium_fallback`;
- daily DeepSeek cap берётся из `--deepseek-daily-budget` или `DEEPSEEK_DAILY_BUDGET_USD`.

Перед любым apply:

```bash
npm run cost:articles -- --days=2 --limit=20
npm run editorial:routing -- --mode=cheap --limit=3
```

## Batch enrich runtime

Текущий enrich работает в две отдельные фазы:

1. `enrich-submit-batch`
   подбирает статьи, fetch-ит исходник, считает score и создаёт Anthropic batch jobs;
2. `enrich-collect-batch`
   poll-ит provider batches, импортирует результаты и делает final apply к статье.

Recovery разделён отдельно:

- `recover-stuck` обслуживает только pre-submit article lease, включая аварийные
  `processing`-строки без `lease_expires_at`/`processing_by`/`claim_token`;
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
- `enrich_runs.status='failed'` означает аварийный run без полезного progress. Если collector
  обработал часть item-ов как `retryable`/`rejected` и одновременно получил terminal failed item,
  run считается `partial`: это item-level outcome, а не падение всего batch pipeline.
- `batch_poll_stuck` поднимается только для батчей, которые реально старше `BATCH_POLL_STUCK_MINUTES` (по `created_at`), а не только по `last_polled_at`. Это нужно из-за null-poll auto-rescue: он выставляет `last_polled_at = эпоху 1970` молодым ещё не опрошенным батчам, чтобы поднять их в начало очереди collector-а. Без проверки `created_at` такой свежий батч мгновенно попадал под `last_polled_at <= pollThreshold` и поднимал ложный warning, хотя при типичной задержке cron GitHub Actions (1-4 часа) ещё не опрошенный свежий submit — норма, а не «застрял». Условие продублировано на двух уровнях: в SQL-запросе (`.lte('created_at', pollThreshold)`) и защитным in-code фильтром `filterGenuinelyStuckBatches` (см. `pipeline/recover-batch-stuck.ts`, тесты `tests/node/recover-batch-stuck.test.ts`).
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
- Для vc.ru дополнительно действует low-yield follow-up: если по `source_name ILIKE '%vc.ru%'`
  нет live/verified статьи за 7 дней, `pipeline/source-health.ts` поднимает warning alert
  `source_low_live_yield` с указанием проверить `source_runs`, keyword yield и `publish_ready` queue.
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
- Pre-live проверка новых статей идёт через `HEAD /internal/articles/<slug>` с header
  `x-publish-verify-secret: $PUBLISH_VERIFY_SECRET`. Endpoint не рендерит публичную страницу:
  он только подтверждает, что статья существует, `quality_ok=true` и находится в
  `publish_ready`/`verifying`/`live`. Если route отсутствует или secret не совпадает,
  `publish-verify` получает 401/404 и поднимает `publish_verify_failed_warn`.
- Не подключать неофициальные агрегаторы как замену source-owned RSS без отдельного решения:
  например, стандартные RSS endpoints `anthropic.com` сейчас отвечают 404, поэтому Anthropic
  покрывается broad feeds/filters до появления официального feed endpoint.

## Rendering policy

Cтратегия рендеринга по типам страниц:

| Surface | Mode | Revalidate |
|---|---|---|
| `/` | Static (ISR) | 300s |
| `/russia` | Static (ISR) | 300s |
| `/categories/<category>` | SSG (через `generateStaticParams`) + ISR | 300s |
| `/categories/<category>/<slug>` | SSG + ISR; recommendations skipped only during build | 1h |
| `/guides`, `/guides/<slug>` | SSG/Static | 1d |
| `/sources`, `/sources/<source>` | Static / SSG | 1h |
| `/sitemap.xml`, `/rss.xml`, `/llms.txt`, `/indexnow.txt`, `/robots.txt` | Static (ISR) | 30m–1h |
| `/api/feed`, `/api/categories/<cat>/articles` | Dynamic (Load-more endpoint) | — |
| `/archive/<date>`, `/articles/<slug>`, `/topics/<topic>`, `/internal/*`, `/demo/*` | Dynamic | — |

Инварианты:

1. Главная (`/`), `/russia` и `/categories/<category>` НЕ должны читать `searchParams` или
   `cookies()/headers()` на сервере — это force-dynamic-ит роут и убивает CDN-кеш на Vercel
   (`cache-control: private, no-cache, no-store`). Pagination там — client-side через Load more,
   подгрузка через `/api/feed` или `/api/categories/<cat>/articles`.
2. Если на странице нужны cookies/headers/searchParams — выносить их в Client Component или
   в отдельный Dynamic route, не размывая основной surface.
3. После изменений listing-страниц обязательно проверить `npm run build`: метки в Route summary
   должны быть `○` Static или `●` SSG, **не** `ƒ` Dynamic.
4. Прод-проверка cache headers (часть smoke check): `curl -sI https://news.malakhovai.ru/` после
   деплоя должен показать `cache-control: public, max-age=0, must-revalidate` (или аналогичный
   public-вариант) и `x-vercel-cache: HIT` после повторного запроса.

## Deploy

### Ветки и источник прод-кода (зафиксировано 2026-06-10)

Текущая схема (исторически сложилась, признана каноном до отдельного решения владельца):

- **Прод-код живёт в ветке `codex/evergreen-quality-standard-2026-05-21`** — в неё пушатся
  все production-изменения. CI (`ci.yml`) гоняется на ней наравне с `main` и PR.
- **`main` — носитель workflow-определений.** Scheduled GitHub Actions исполняют YML с
  default-ветки (`main`), но чекаутят код прод-ветки через ref-pin в шаге Checkout.
  ⚠️ Любое изменение env/шагов cron-workflow надо вносить В ОБЕ ветки: в прод-ветку
  (для консистентности кода) и в `main` (иначе scheduled-запуски его не увидят).
- **Деплой на Vercel — ручной**: `vercel deploy --prod` из чистого рабочего дерева прод-ветки
  (git-автодеплой с этой ветки не подключён). Перед деплоем: CI зелёный + `npm run build` локально.
- Один раз когда-нибудь: влить прод-ветку в `main`, перевести ref-pin'ы и Vercel на `main` —
  решение владельца, см. `docs/spec_2026-06-10_digest_full_audit.md` Волна B.

- Runtime сайта: Vercel.
- Production domain: `https://news.malakhovai.ru`.
- News-домен должен быть отдельным property в Яндекс.Вебмастере и Google Search Console.
- Sitemaps для индексации:
  - основной `https://news.malakhovai.ru/sitemap.xml` (ISR 30 мин, все категории/статьи/гайды);
  - Google News `https://news.malakhovai.ru/news-sitemap.xml` (ISR 10 мин, статьи опубликованные
    за последние 48 часов, лимит 1000 URL, `xmlns:news`-разметка с `news:publication`,
    `news:publication_date`, `news:title`). Оба sitemap-а перечислены в `robots.txt`.
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
   кнопка скрывается. То же на главной (`/`) и `/russia` — Load more подгружает page 2+ через
   `/api/feed` / `/api/categories/<cat>/articles` и обновляет URL через `pushState`. Сервер при
   этом игнорирует `?page=` и при reload отдаёт page 1: это намеренный компромисс — listing-страницы
   остаются `Static / SSG` на Vercel CDN, canonical всегда указывает на base URL.
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

## Новостные агрегаторы (T6)

Цель: попасть в Google News / Google Publisher Center и (по решению владельца) в Яндекс-новостной
формат. Раздел делится на **тех-готовность** (наша зона, автоматизировано) и **подачу** (зона
владельца — внешние аккаунты, СМИ-регистрация).

### Тех-готовность — проверено 2026-06-01 ✅

- **`/news-sitemap.xml`** (`app/news-sitemap.xml/route.ts`) соответствует протоколу Google News:
  только `news:` namespace, обязательные теги `news:publication` (`news:name` + `news:language=ru`),
  `news:publication_date` (ISO-8601), `news:title`, `loc`; окно публикации 48 ч (Google требует
  «последние 2 дня»), ≤ 1000 URL, выборка `published + quality_ok + verified_live + live`, ISR 10 мин.
  Изменений в коде не потребовалось.
- **`/sitemap.xml`** (общий, ISR 30 мин) и **`/rss.xml`** (RSS 2.0 + `atom:link rel=self`, 50 свежих)
  валидны и пригодны для Яндекс.Вебмастера (общая индексация) и читалок.
- Оба sitemap-а перечислены в `robots.txt` (`app/robots.ts`).

### Подача — зона владельца (статус: ожидает подачи)

| Агрегатор | Что нужно от владельца | Тех-предусловие | Статус |
|---|---|---|---|
| Google Publisher Center / Google News | Зарегистрировать издание, указать `https://news.malakhovai.ru`, подтвердить владение в Search Console | news-sitemap готов ✅ | ⏳ ожидает подачи |
| Яндекс.Вебмастер (общая индексация) | Добавить и подтвердить сайт, отправить `sitemap.xml` | sitemap готов ✅ | ⏳ ожидает подачи |
| Яндекс-новостной формат (Дзен/СМИ) | Требует регистрации как СМИ + отдельный RSS с `yandex:` namespace (`yandex:full-text` и т.п.); это не покрывается Google-форматом news-sitemap | нужен отдельный фид — НЕ реализован | 🔶 решение владельца (стоит ли заводить) |

Примечания:
- Google News больше не требует ручной подачи для попадания в индекс (сайты рассматриваются
  автоматически), но Publisher Center нужен для управления карточкой издания и логотипом.
- Яндекс-новостной партнёрский фид — отдельная инициатива (СМИ-регистрация в РФ, иной формат RSS).
  Не начинать без явного решения владельца; общая индексация Яндексом и так идёт через `sitemap.xml`.
- После подачи зафиксировать дату и статус в этой таблице.

## Аналитика (Яндекс Метрика) и согласие

Метрика загружается только после явного согласия пользователя на аналитические cookies.

- Решение хранится в `localStorage.consent_v1` (см. `lib/consent.ts`).
- Скрипт инжектится `src/components/Analytics.tsx` через `next/script` `strategy="lazyOnload"`,
  только если в согласии `categories.analytics === true`.
- ID счётчика берётся из `NEXT_PUBLIC_METRIKA_ID`; без переменной аналитика выключена даже
  при наличии согласия (deploy без секрета не должен внезапно начать слать события).
- Ops-сводка читает агрегаты трафика серверно через Яндекс.Метрику только при наличии
  `YANDEX_METRIKA_OAUTH_TOKEN`; `YANDEX_METRIKA_COUNTER_ID` можно не задавать, если он совпадает
  с `NEXT_PUBLIC_METRIKA_ID`.
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
- synthetic uptime-check публичной ленты.

### Site feed synthetic check (`site-monitor.yml`)

Workflow `.github/workflows/site-monitor.yml` каждые 15 минут (и по `workflow_dispatch`)
запускает `pipeline/site-feed-monitor.ts`: дёргает production `/api/feed`
(`SITE_MONITOR_URL`, по умолчанию `https://news.malakhovai.ru`) и:

- `total === 0` → critical-алёрт `site_feed_empty` (`reason: empty_feed`);
- endpoint недоступен / не-200 после ретраев → `site_feed_empty` (`reason: fetch_failed`);
- лента непустая → `resolveAlert('site_feed_empty')`.

Зачем: enforce incident-learning 2026-05-26 (см. ниже «Cover storage … Recovery-урок» и
`CLAUDE.md`) — прод-редеплой при egress-заблокированном Supabase стирает тёплый stale ISR-кеш,
и сайт отдаёт пустую ленту, хотя данные в БД целы. Раньше это ловилось только глазами.

Особенности:
- алёрт идёт через `pipeline/alerts.ts::fireAlert`, который **устойчив к недоступной БД**: при
  ошибке записи в `pipeline_alerts` он всё равно шлёт Telegram (severity `critical` проходит
  дефолтную immediate-политику). То есть при блокировке Supabase алёрт всё равно дойдёт;
- cooldown `site_feed_empty` = 1 ч (`COOLDOWN_HOURS`) — при устойчивом простое не спамит;
- monitor завершается с кодом 0 даже при fire (канал оповещения — Telegram, как у прочих
  мониторов), чтобы не плодить красные runs на каждый тик во время простоя;
- секреты workflow: `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `TELEGRAM_BOT_TOKEN`,
  `TELEGRAM_ADMIN_CHAT_ID`; `SITE_MONITOR_URL` — опциональная repo variable. Если variable
  не задана, GitHub Actions подставляет **пустую строку** (не undefined), поэтому базовый URL
  нормализуется через `resolveSiteUrl` (пустое/пробельное → дефолт `https://news.malakhovai.ru`).
  Без этого `fetch('/api/feed')` падал с `Failed to parse URL` и порождал ложный critical
  `site_feed_empty`, хотя прод-лента была жива.
- pure-логика решения покрыта `tests/node/site-feed-monitor.test.ts` (включая `resolveSiteUrl`).

> Pre-deploy guard (не деплоить при заблокированном Supabase) пока не автоматизирован — остаётся
> процедурным правилом из recovery-урока ниже. Synthetic-check ловит проблему пост-фактум.

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
- `npm run cost:articles -- --days=2 --limit=40` печатает per-article расход:
  input/output/cache tokens, text cost, image cost и total cost по `llm_usage_logs`.
- `npm run routing:lab -- --limit=3` готовит dry-run сравнение
  `claude-full`, `deepseek-full`, `hybrid`; `--apply` реально вызывает API и пишет результаты в `tmp/model-routing-lab-*`.
- `npm run cost:guard` проверяет расход Claude за текущий день по Москве и поднимает alert, если превышен бюджет.
- Порог budget guard задаётся через `CLAUDE_DAILY_BUDGET_USD`; в workflow `enrich.yml` и `pipeline-health.yml` стоит `$2` (с 2026-05-05 — фактический расход 1.0–1.4/день при прежнем `$1` стабильно резал submit). Default в коде остаётся `$1`. Перед повышением свериться с `npm run cost:report`.
- Anthropic Batch accounting считает billed estimate со скидкой Batch API (`batch=true`):
  `llm_usage_logs.estimated_cost_usd`, `anthropic_batch_items.estimated_cost_usd` и
  `anthropic_batches.estimated_cost_usd` отражают ожидаемый billed cost, а list-price
  сохраняется в payload/metadata как `estimated_list_cost_usd`. После накопления недели данных
  можно пересмотреть `CLAUDE_DAILY_BUDGET_USD`; до этого workflow threshold остаётся `$2`.
- Источник истины после миграции:
  - `llm_usage_logs` для per-call/per-item расхода;
  - `enrich_runs.total_*` и `estimated_cost_usd` для run-level totals;
  - `anthropic_batches.total_*` и `estimated_cost_usd` для batch-level totals.
- До полного cutover `cost:report` умеет падать обратно на legacy `enrich_runs.error_summary`, если structured logs ещё не накопились.

Любое изменение этих процессов требует обновления этого файла.

## Health endpoint

`GET /api/health?token=$HEALTH_TOKEN` отдаёт оперативный snapshot pipeline. Контракт ответа определён в `lib/health-summary.ts::HealthSummary`. Помимо last-run для ingest/enrich, активного Telegram channel delivery (`telegram`) и legacy digest (`digest`), а также счётчиков open alerts/batches, ответ включает:

- `oldest_pending_age_minutes` — возраст самой старой actionable-статьи в `pending`/`retry_wait`,
  которую текущий enrich-runner мог бы забрать сейчас. Материалы, временно припаркованные
  `SOURCE_DAILY_PUBLISH_CAP` по источнику, не считаются аварийной очередью: они штатно ждут
  следующего MSK-дня/освобождения квоты.
- `articles_published_today` — переходы в `live` за сегодня по МСК (использует индекс `idx_articles_published_at_live`).
- `articles_rejected_today_by_reason` — агрегат по `enrich_runs.rejected_breakdown` за сегодня (МСК), коллапсируется по префиксу до `:` (`research_too_short:1240` и `research_too_short:980` сливаются в `research_too_short`); длинные free-text причины нормализуются в `quality_reject`.
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
- последние 10 `telegram_channel_posts`;
- последние 5 legacy `digest_runs`.

Страница полностью server-rendered, без client-side state, с auto-refresh каждые 60 секунд.
`robots.txt` уже запрещает `/internal/`.

## Telegram ops report

`npm run ops:report` отправляет операторскую сводку в `TELEGRAM_ADMIN_CHAT_ID`.
Данные собираются в `lib/ops-summary.ts` поверх `HealthSummary` и дополнительных
срезов Supabase: воронка статей за 24 часа, текущая очередь, последние live-публикации,
последний ingest/enrich, Telegram channel post slots за сегодня, группировка open alerts, source
rejected/fetch errors, LLM/image cost за московский день и блок качества
(`article_quality_scores` + `article_feedback`). Если настроены
`YANDEX_METRIKA_OAUTH_TOKEN` и `YANDEX_METRIKA_COUNTER_ID`, сводка также показывает
трафик Яндекс.Метрики за предыдущий завершённый MSK-день: визиты, посетителей,
просмотры и динамику к дню ранее. Если API Метрики недоступен или секретов нет, отчёт
не падает и пишет коротко, что данные Метрики не получены.

Расписание workflow `.github/workflows/ops-report.yml`:

| Cron UTC | МСК | Назначение |
|---|---|---|
| `45 6 * * 1-5` | 09:45 Пн–Пт | Утренний отчёт после первого Telegram-поста |
| `45 8 * * 6,0` | 11:45 Сб–Вс | Утренний отчёт после первого Telegram-поста выходного дня |
| `30 17 * * *` | 20:30 ежедневно | Вечерний отчёт по насыщению дня |

Формат начинается со светофора и короткого бизнес-блока:

- `🟢` — ключевые контуры работают и действий не требуется; незначительные diagnostic warning
  в регулярном отчёте не подсвечиваются, если для них не нужен Codex-fix prompt;
- `🟡` — есть проблема, которую стоит разобрать системно, и ниже появится prompt для Codex;
- `🔴` — есть critical alerts, failed ingest/enrich/Telegram или за день нет live-публикаций.

Секции основного отчёта: `Главное`, `Что работает`, `Что не идеально`, `Трафик вчера`,
`Контент`, `Расходы`, `Что делать`. В `Что работает` сайт описывается через свежесть
live-публикаций за последние 6 часов, а календарные и rolling-окна разведены в
`Контент`: `сегодня с 00:00 МСК`, `последние 6ч`, `последние 24ч`. Это важно для
ранних утренних отчётов сразу после полуночи, когда за новый календарный день может
быть 0 live-публикаций, но свежие статьи всё ещё есть в 6-часовом окне. Технические
подробности не разворачиваются в каждом сообщении: `/alerts` и `/cost` остаются
отдельными admin-only командами.

`Промпт для Codex` появляется только для real action:

- сразу при `🔴`;
- при failed ingest/enrich/Telegram;
- если Telegram slot после ожидаемого времени отсутствует или ниже плана;
- если warning/info повторился `occurrence_count >= 3` или висит дольше 6 часов.

Временные хвосты вроде единичного `claude_parse_failed`, пары открытых batch-задач,
одного source warning или низкого 6h-window без критического эффекта не получают
prompt сразу и показываются как `🟢`: отчёт не отвлекает владельца на неважные
условности. Когда prompt нужен, он упакован в Telegram HTML `<pre><code>` как копируемый
code block и содержит root-cause задачу, релевантные таблицы/файлы, dry-run команду, тесты и
docs impact.

Warning/info по умолчанию не присылаются отдельными сообщениями: они копятся в
`pipeline_alerts` и объясняются в утренне-вечерней ops-сводке.

## Article quality judge and owner feedback

Ежедневный контроль качества состоит из двух независимых частей:

1. `npm run quality:judge` — берёт выборку опубликованных статей, вызывает Claude Haiku 4.5
   (`QUALITY_JUDGE_MODEL`, default `claude-haiku-4-5`), пишет `article_quality_scores` и
   usage/cost в `llm_usage_logs.operation='article_quality_judge'`.
2. `npm run quality:feedback` — отправляет владельцу один digest-message в
   `TELEGRAM_ADMIN_CHAT_ID`: 5-8 статей, короткие source markers (`канал`/`слабая`/`контроль`),
   score при наличии, ссылка и компактная причина только для слабых материалов. Inline-кнопки
   идут по номерам строк: `1 🔥` / `1 👌` / `1 👎`.

Workflow `.github/workflows/quality-feedback.yml` запускает оба шага ежедневно в 08:15 UTC
(11:15 МСК), после утреннего цикла публикаций.

Webhook feedback:

```bash
npm run tg-feedback:set-webhook
```

Команда ставит Telegram webhook на `https://news.malakhovai.ru/api/tg-feedback` с
`allowed_updates=['callback_query']` и secret token `TELEGRAM_FEEDBACK_SECRET_TOKEN`
(fallback — `CRON_SECRET`). Route принимает только callbacks от `TELEGRAM_OWNER_USER_ID`,
`TELEGRAM_OWNER_USERNAME` или из `TELEGRAM_ADMIN_CHAT_ID`, upsert-ит `article_feedback` и
редактирует только строку выбранной статьи подтверждением. Повторный тап перезаписывает оценку.

Операционный смысл: judge-оценка и owner feedback пока не влияют на publish/ranking. Это baseline
для будущих модельных переключений; расхождения judge ↔ владелец за 7 дней видны в ops-report.

Ручной запуск:

```bash
npm run ops:report -- --dry-run
npm run ops:report -- --kind=morning
npm run ops:report -- --kind=evening
```

Long-polling bot `npm run bot` также поддерживает admin-only команды:
`/status`, `/alerts`, `/cost`. Они работают только в чате, id которого совпадает
с `TELEGRAM_ADMIN_CHAT_ID`; всем остальным бот отвечает обычным welcome-сообщением.

## Broken article title guard and backfill

`validateEditorialDetailed()` блокирует новые `ru_title`, которые заканчиваются на русский
предлог или союз (`с`, `для`, `и`, `в`, `на` и т.п.). Это защита от LLM-ответов, где модель
механически режет заголовок по лимиту и оставляет на сайте фразу вроде `...конфликта с`.
Акронимы в верхнем регистре (`ПО`, `ИИ`, `API`) не считаются оборванными служебными словами.

Для уже опубликованных статей используется ручной backfill:

```bash
npm run titles:fix -- --dry-run
npm run titles:fix -- --apply
npm run titles:fix -- --detect-only
```

Скрипт сканирует только live-материалы (`published=true`, `quality_ok=true`,
`verified_live=true`, `publish_status='live'`), генерирует замену через Claude Haiku
(`TITLE_FIX_MODEL`), валидирует локально и обновляет только `ru_title` по `id` + старому
значению `ru_title`. Slug не меняется, чтобы не ломать URL и индексацию. Если хотя бы одна
замена rejected, `--apply` падает и не делает частичный backfill.

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

## Telegram channel posts monitor (2026-06-10)

`pipeline/tg-channel-monitor.ts` запускается из `pipeline-health.yml` каждые 2 часа. Триггер
создания: инцидент 2026-06-09..10 — pg_cron→pg_net молча перестал дёргать
`/api/cron/tg-channel-post`, канал молчал двое суток. Инцидент 2026-06-16 показал два связанных
отказа: за текущий день не появилось ни одной строки `telegram_channel_posts` (primary pg_cron/pg_net
не вызывает route), а 2026-06-15 остался `planned` slot 1 при `success` slot 2-5, потому что первый
успешный runner дня мог стартовать с позднего slot и старый `runChannelPost` отправлял только
запрошенный slot. Системный фикс — GitHub Actions backup-runner выше плюс catch-up в
`bot/channel-post-core.ts`. Логика monitor-а (по МСК):

- слот «должен был выйти» через 30 минут после планового времени (09:30/12:30/15:30/18:30/21:00);
- если due-слотов ≥ 2 (≈ с 13:00 МСК), а success-доставок за день меньше due-slots —
  `fireAlert('tg_channel_posts_missing', critical, cooldown 4ч)`; в payload различаются
  `no_rows` (pg_cron мёртв), `no_success` (план есть, ломается отправка) и
  `partial_success` (часть слотов отправлена, но missed planned slots/catch-up надо проверить);
- success-доставок не меньше due-slots — `resolveAlert`;
- открытые `tg_channel_posts_missing` за прошлые `day:YYYY-MM-DD` автоматически переводятся в
  `resolved`, чтобы вчерашний incident не держал текущий ops-status красным после начала нового
  delivery-дня;
- раньше 13:00 МСК — noop для текущего дня, но cleanup старых day-alerts всё равно выполняется.

Тесты: `tests/node/tg-channel-monitor.test.ts`.

## telegram_channel_posts status enum (миграция 017)

`telegram_channel_posts` — активный журнал Telegram delivery. Один день = до 5 строк по
`delivery_date + slot_no + channel_id`.

| Код | Когда |
|---|---|
| `planned` | слот выбран и ждёт своего cron-времени |
| `sending` | runner забрал слот, prefetch-ит обложку и отправляет `sendPhoto` multipart upload |
| `success` | Telegram вернул `message_id`, строка содержит `sent_at` |
| `failed_send` | ошибка prefetch обложки, Telegram API или runtime-ошибка отправки; следующий slot/backup может повторить отправку |
| `skipped_low_articles` | в дневном pool меньше 3 подходящих статей, весь день пропущен |
| `skipped_no_article` | для конкретного слота не хватило выбранных материалов |

Диагностика:

```sql
SELECT delivery_date, slot_no, status, article_id, telegram_message_id, sent_at, error_message
  FROM telegram_channel_posts
 ORDER BY delivery_date DESC, slot_no DESC
 LIMIT 10;
```

## digest_runs status enum (legacy, Wave 2.4, миграция 015)

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
