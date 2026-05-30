# Article System

## Жизненный цикл статьи

Статья проходит через последовательность:

1. Источник появляется в RSS.
2. `pipeline/ingest.ts` создаёт raw entry в `articles`.
3. `pipeline/enrich-submit-batch.ts` выбирает pending-статьи, считает score, fetch-ит исходник и готовит batch requests.
4. После успешного batch submit статья остаётся в `articles.enrich_status='processing'`, но ownership переходит в `anthropic_batch_items`.
5. `pipeline/enrich-collect-batch.ts` импортирует готовые provider results и apply-ит editorial outcome к статье.
6. Только после successful apply статья получает terminal enrich state, slug, media и `publish_ready`.
7. Сайт рендерит статью по чистому публичному URL.
8. Publish verification подтверждает, что материал живой на сайте.
9. Telegram digest использует уже опубликованные статьи.

## Статусы

### Ingest

- `ingested`
- `ingest_failed`

### Enrich

- `pending`
- `processing`
- `retry_wait`
- `enriched_ok`
- `rejected`
- `failed`
- `stuck`

### Publish

- `draft`
- `publish_ready`
- `verifying`
- `live`
- `verification_failed`
- `withdrawn`

Legacy boolean-поля (`enriched`, `published`) сохраняются для совместимости, но текущая логика должна опираться на status fields.

Переход `publish_ready`/`verifying` → `live` выполняется только через RPC
`public.publish_article(article_id, 'publish-verify')`. RPC атомарно проверяет
актуальное состояние строки и ставит `publish_status='live'`, `verified_live=true`,
`published=true`, `published_at` и `last_publish_verifier`. `publish-verify` обрабатывает
коды `published_live`, `already_live`, `rejected_quality`, `rejected_unverified`,
`not_eligible`; неуспешные коды пишутся в `article_attempts.stage='verify'` с
`error_code='publish_rpc_*'`. Прямой update в `live` разрешён только как emergency
bypass при `PUBLISH_RPC_DISABLED=1`; он поднимает alert `publish_rpc_bypass_active`.

### Article attempts trace

`article_attempts` хранит stage-level историю прохождения статьи. Помимо enrichment и verify,
Wave 3 добавляет `stage='fetch'`: если `pipeline/fetcher.ts::fetchArticleContent` не смог
получить пригодный HTML/text, `enrich-submit-batch` пишет отдельную строку с
`result_status='failed'` и нормализованным `error_code` из набора
`fetch_404`, `fetch_5xx`, `fetch_timeout`, `fetch_aborted`, `fetch_too_large`,
`fetch_empty`, `fetch_blocked`, `fetch_unknown`.

Publish verification также пишет verify-attempts для RPC-перехода: успешные
`published_live`/`already_live` идут как `result_status='ok'` с payload
`publish_transition_result`, а `rejected_*`/`not_eligible`/RPC errors — как
`result_status='failed'` с `error_code='publish_rpc_*'`.

### Operational dashboard trace

`/internal/dashboard` использует тот же `HealthSummary`, что и `/api/health`, и добавляет
таблицы по article-system surfaces: последние open/resolved alerts, stuck batch items,
последние live-переходы с lag от `publish_ready_at` до `verified_live_at`/`published_at`,
и последние `digest_runs`. Доступ только по `HEALTH_TOKEN`; без валидного query/header
страница отдаёт 404.

`lib/ops-summary.ts` строит поверх этих же данных Telegram ops-сводку для владельца:
воронка статей за 24 часа, текущая очередь, live-публикации за день/6 часов,
статус дайджеста, grouped alerts, source rejected/fetch errors и cost за московский день.
Workflow `ops-report.yml` шлёт её утром после дайджеста и вечером; одиночные warning/info
алёрты при этом не пушатся сразу, а остаются в сводке. Мгновенные Telegram-пуши из
`fireAlert` по умолчанию оставлены только для `critical`.

### Batch source of truth

Batch-specific lifecycle не хранится в `articles.enrich_status`.

Для него используются:

- `anthropic_batches`
- `anthropic_batch_items`

Ключевой смысл:

- `articles.enrich_status='processing'` в batch-flow означает, что статья находится внутри enrich pipeline, но final apply ещё не завершён;
- `articles.current_batch_item_id` указывает на активный batch-owned item, если ownership уже передан из article lease;
- item-level states (`queued_for_batch`, `batch_submitted`, `batch_processing`, `batch_result_ready`, `applying`, `applied`, `batch_failed`, `apply_failed_*`) живут только в batch tables.
- `recover-stuck` обслуживает только pre-submit article lease; если за один запуск он
  восстанавливает больше 3 статей, поднимается warning alert `lease_expired_spike`.
- Anthropic `custom_id` в Batch API имеет лимит 64 символа и допускает только
  `[a-zA-Z0-9_-]`. Pipeline строит короткий
  `item_<compact-batch-item-uuid>_attempt_<n>`, а полный контекст статьи хранит в
  `anthropic_batch_items` и `request_payload.article_context`. Collector матчится по
  `anthropic_batch_items.request_custom_id`; legacy `article:<article_id>:attempt:<n>:item:<item_id>`
  остаётся parseable для старых результатов.
- Claude output parse failures (`missing output_text`, invalid JSON, failed editorial validation)
  переводят item/article через `error_code='claude_parse_failed'` и поднимают warning
  alert `claude_parse_failed` с cooldown 4 часа и dedupe по `batch_id`.
- Ошибка записи `llm_usage_logs` больше не роняет collect/apply path: `writeLlmUsageLog`
  логирует проблему и поднимает warning alert `llm_usage_log_write_failed`.

### Editorial validation and routing experiments

`pipeline/claude.ts` содержит provider-neutral validator surface:

- `validateEditorialDetailed()` возвращает `{ ok, errors, warnings, riskFlags }`;
- `validateEditorial()` остаётся compatibility-wrapper-ом для существующего collect/apply path.

Validator дополнительно проверяет:

- каждый `link_anchor` должен присутствовать в `editorial_body` дословно;
- banned phrases из editorial prompt across title/lead/summary/teasers/body;
- standalone `AI` в русском тексте, кроме известных product/institution names;
- basic body/teaser/summary shape.

Lead anchor check считает конкретным якорем цифры, русские числительные, имена собственные,
латинские product/model names и camelCase identifiers вроде `openLight`. `card_teaser` 50-59
символов считается warning (`card_teaser короткий`), а не hard reject; ниже 50 остаётся ошибкой.

`pipeline/editorial-routing.ts` и `pipeline/editorial-apply.ts` задают fallback-first routing surface
для scheduled limited rollout:

- default config без env остаётся `premium` + `anthropic`;
- `cheap` выбирает DeepSeek writer без reviewer; `balanced` добавляет selective compact Claude reviewer;
- `buildDeterministicEditorialBrief()` заменяет дорогой Claude-orchestrator на code/template brief;
- `shouldReviewWithClaude()` включает reviewer в `balanced` только на validator failure, high score или high-risk topics.
- `parseRepairValidateEditorial()` и `prepareEditorialApplication()` являются общим final gate:
  provider output сначала парсится, затем проходит deterministic repair, strict validator,
  slug guard и media sanitizer, и только потом может быть записан в `articles`.

`pipeline/editorial-repair.ts` выполняет дешёвые deterministic fixes перед reviewer:

- safe replacement `AI` -> `ИИ` в русском тексте;
- удаление invalid `link_anchors`;
- сохранение/восстановление paragraph breaks для DeepSeek outputs;
- безопасное сокращение слишком длинного `ru_title`.

`scripts/run-editorial-routing.ts` (`npm run editorial:routing`) — production routing runner:

- default dry-run, без API spend и DB writes; `--apply` обязателен для записи;
- default `--limit=5`; apply-режим claim-ит только `pending`/`retry_wait` статьи без batch ownership;
- `cheap` применяет DeepSeek только к low-risk статьям, а `ai-research`, legal/regulation,
  medical, geopolitics и high-score отправляет в premium fallback;
- `balanced` использует compact Claude reviewer для high-score/money risk после успешной
  repair+validation; reviewer reject/parse fail отправляет статью в premium fallback;
- DeepSeek API error, empty output, parse error, hard validator error или `quality_ok=false`
  не публикуются напрямую, а ставят `anthropic_batch_items` с operation
  `editorial_premium_fallback`;
- successful low-risk DeepSeek output пишется прямым claim-safe update в `publish_ready`,
  но live-публикация всё равно остаётся за `publish-verify` RPC.

С 2026-05-11 `enrich.yml` запускает `npm run editorial:routing -- --mode=cheap --limit=15 --apply`
каждые 30 минут. Это не удаляет Anthropic Batch: high-risk статьи, DeepSeek/API failures,
validator failures и reviewer rejects по-прежнему создают обычный Anthropic Batch fallback item,
который обрабатывается текущим `enrich-collect-batch`.

## Score и publish gate

- Статья сначала оценивается scorer-ом (`pipeline/scorer.ts`).
- Базовый порог для отправки в Claude: `score >= 2`.
- Категорийные пороги задаются в `pipeline/scorer.config.ts`. Для `ai-research` порог выше:
  `score >= 4`, потому что раздел должен получать меньше, но глубже и качественнее материалов.
- Если score ниже порога, статья отклоняется до batch submit и не тратит Claude cost.

### Scoring formula (Wave 1, 2026-05-22)

- `+2` если в `original_title` / `ru_title` / первом килобайте `original_text` встречается
  AI-lab или продуктовый токен (openai/chatgpt/gpt-N/sora/anthropic/claude/deepmind/gemini/
  veo/imagen/mistral/cohere/xai/grok/llama/nvidia/blackwell/copilot/phi-N/yandexgpt/gigachat).
  Word-boundary через Unicode `\P{L}`, чтобы не цеплять подстроки.
- `+2` дополнительно, если **одновременно** в заголовке есть announcement-глагол
  (unveils/launches/announces/releases/introduces/debuts или ru-стемы `представ`,
  `запусти`/`запуска`, `анонсир`, `выпустил`/`выпустит`). Без AI-lab match этот бонус не
  начисляется — это страховка против обобщений в стиле «retailer launches loyalty programme».
- `+1` если статья помечена `ai-russia` (раньше было `+2`).
- `+1` если `original_text.length > 200`.
- `+1` если `pub_date` свежее 6 часов.
- `+1` если `source_name` входит в TOP_OUTLETS (Verge / MIT TR / Wired / Decoder / VentureBeat).
- `+1` если `editorial_body.length > 1000` (раньше использовался raw text — Habr/CNews-навигация
  раздувала длину без editorial-качества).
- `+1` за обложку, **кроме** `/article-images/ai-covers/`, `/article-images/template-covers/`,
  `/article-images/stock-covers/` — fill-in не считается сигналом качества источника.
- `−1` если заголовок < 5 слов.
- `+1` для `ai-startups`, если в title/text есть startup deal signal (Series A/B/C, seed, $XXm,
  раунд, привлек, оценк, инвестиц).
- Поле `source_lang === 'ru' +1` удалено — оно дублировало `ai-russia +2` и систематически
  поднимало Russian dev-материалы Habr/CNews выше глобальных индустриальных сюжетов
  Verge/Decoder. См. `docs/spec_2026-05-22_digest_editorial_priority.md` Wave 1.

Score пишется в `articles.score` на submit-этапе и не пересчитывается после enrich. Скрипты
re-enrich (`scripts/reenrich-all.ts`, `scripts/reenrich-topic-slices.ts`) пересчитывают score
по новой формуле для затронутого слайса.
- Для `ai-research` pre-submit gate дополнительно требует визуальный материал после
  `sanitizeArticleMedia`: `cover_image_url` или хотя бы одну inline-картинку из fetcher.
  Если после очистки визуала нет, статья отклоняется с `quality_reason='rejected_low_visual'`.
- После successful batch result collector отклоняет `ai-research`, если `editorial_body` короче
  1500 символов (`quality_reason='research_too_short: <length>'`).
- Для `ai-startups` scorer даёт небольшой boost, если в заголовке или тексте есть признаки
  конкретной сделки: `$...`, `Series A/B/C`, `seed`, `раунд`, `оценка`, `инвестиции`.
- Если quality check не пройден после successful batch result, статья уходит в `rejected` и остаётся в `draft`.
- Если quality check пройден и apply завершился успешно, статья становится `publish_ready`.

### Slug validation gate

- `pipeline/slug.ts::generateSlug` транслитерирует ru-заголовок в ASCII через TRANSLIT_MAP и стрипит всё, кроме `[a-z0-9-]`. Жёсткий лимит длины — 75 символов (`MAX_SLUG_LENGTH`); при превышении slug режется по последнему `-` (граница слова), чтобы не заканчиваться на mid-root («-bezopas»). Существующие slug-и не пересчитываются.
- `pipeline/slug.ts::normalizeSlug` — defensive helper, который приводит slug из любого источника (legacy backfill, ручной импорт) к каноническому виду. Использует тот же 75-символьный cap и word-boundary cut.
- `pipeline/slug.ts::assertAsciiSlug` — runtime guard, бросает на slug-ах с не-ASCII символами или с битой структурой. Вызывается в `pipeline/enrich-collect-batch.ts` после `ensureUniqueSlug`. Невалидный slug приводит item в `apply_failed_terminal` и НЕ записывается в `articles.slug` — это защита от регрессий вроде incident 2026-05-01.

### Telegram digest и pipeline-health detection

С 2026-05-02 ядро дайджеста живёт в `bot/daily-digest-core.ts` (экспортирует `runDailyDigest()`, возвращает `DigestResult` вместо `process.exit`). Точки входа:

- CLI: `bot/daily-digest.ts` (тонкий враппер с dotenv и `process.exit`) — `npm run tg-digest`.
- Vercel Cron: `app/api/cron/tg-digest/route.ts` — расписание 09:30 МСК Пн–Пт и 11:30 МСК Сб+Вс, см. `docs/OPERATIONS.md` секцию «Vercel Cron».

`runDailyDigest()` при пустой выборке статей за вчерашний день дополнительно проверяет количество статей в `enrich_status='processing'` старше 6 часов. Если их > 0, ядро:
- пишет `digest_runs.status='failed_pipeline_stalled'` (миграция 015) с `error_message='pipeline_stalled: N processing>6h'`,
- отправляет критический алёрт `digest_pipeline_stalled` в админский Telegram.

Без этого gate скрипт молча писал `skipped`, и проблему обнаруживали только постфактум по отсутствию сообщения в канале.

С W2.4 (миграция 015) каждая ветка `runDailyDigest()` пишет digest_runs row с точным кодом:

- `success` — отправка прошла, message_id сохранён;
- `skipped_already_claimed` — slot уже взят (через `claimDigestSlot`/UNIQUE partial index `idx_digest_runs_date_channel_live`) или tg_sent fallback;
- `skipped_no_articles` — нет live-статей за окно (без признаков заклинивания);
- `low_articles` — < 3 live статей, дайджест пропущен, health-отчёт админу (legacy код, остаётся);
- `failed_pipeline_stalled` — описано выше;
- `failed_send` — ошибка запроса в Supabase или ошибка Telegram API.

См. `docs/OPERATIONS.md` секция «digest_runs status enum (Wave 2.4, миграция 015)».

### `enrich_runs.rejected_breakdown` (Wave 2.3)

Каждый run `pipeline/enrich-submit-batch.ts` и `pipeline/enrich-collect-batch.ts` пишет в `enrich_runs.rejected_breakdown` JSONB Map ключ→счётчик причин reject за этот run. Submit-batch агрегирует pre-submit reject коды (`rejected_low_visual`, `low_score`); collect-batch агрегирует post-collect `editorial.quality_reason` (включая `research_too_short:1240` с длиной).

`/api/health` (`lib/health-summary.ts`) при чтении схлопывает ключи по префиксу до `:` — `research_too_short:1240` и `research_too_short:980` сливаются в `research_too_short`, чтобы оператор видел агрегат. Длинные free-text причины нормализуются в `quality_reject`, чтобы Telegram ops-сводка не превращалась в простыню. Сами строки в `enrich_runs` сохраняются с детализацией для post-mortem.

## Categories (модель статьи ↔ категория)

Каждая статья принадлежит **одной основной категории** и опционально **до двух смежным**.

- Справочник категорий — таблица `categories` (slug, name_ru, description_ru, order_index, is_active).
  Public read: только активные категории. Запись — только через service role.
- `articles.primary_category` — `text NOT NULL`, FK на `categories(slug)`. Используется для каноничного URL статьи и принадлежности к разделу.
- `articles.secondary_categories` — `text[]` (NOT NULL DEFAULT '{}', max 2). Используется только для дополнительной перелинковки и попадания статьи в смежные ленты. Canonical всё равно идёт на primary.
- Текущий стартовый список категорий совпадает по slug-у с прежними `topics`: `ai-industry`, `ai-research`, `ai-labs`, `ai-investments`, `ai-startups`, `ai-russia`, `coding`. Перенумерация slug-ов и редиректы — задача волны 2.2.
- Helper для маппинга legacy `topics[]` → `(primary, secondary)` — `lib/categories.ts::splitTopicsToCategories`. Используется в `pipeline/ingest.ts` при создании новых статей.
- Поле `articles.topics` сохраняется как read-only до полного cutover в волне 2 для возможности отката. Новые reads должны опираться на `primary_category` / `secondary_categories`, старые продолжают работать.

## Editorial fields

После enrichment у статьи могут появиться:

- `ru_title`
- `lead`
- `summary`
- `card_teaser`
- `tg_teaser`
- `editorial_body`
- `glossary`
- `link_anchors`
- `article_tables`
- `article_images`
- `article_videos`

`article_tables` могут прийти двумя путями:

- fetcher вытаскивает таблицы из HTML источника;
- Claude может сгенерировать таблицу в JSON-output, если в исходнике есть структурированные данные
  (сравнения, одинаковые атрибуты сущностей, timeline, benchmark/score). Если структурированных
  данных нет, таблица не создаётся. При apply сгенерированные Claude таблицы имеют приоритет над
  HTML-extracted таблицами.

## Media policy

### Cover image

Cover image берётся из исходника, если доступна. Fetcher выбирает обложку по цепочке:
`og:image:secure_url` → `og:image:url` → `og:image` → `twitter:image` →
`twitter:image:src` → `link[rel=image_src]` → JSON-LD `image` → первая релевантная
inline-картинка не меньше 80×80. Все URL абсолютизируются относительно URL статьи.

Для выбора production fallback-стратегии существует неиндексируемая лаборатория `/demo/image-lab`.
Она сравнивает пять направлений обложек для статей без хорошей картинки: source image, stock editorial treatment,
local SVG/editorial template, cover bank и AI budget cover. Это визуальный тест, а не production pipeline:
страницы статей и карточки по-прежнему читают `cover_image_url` из `articles`.

Production fallback backfill пишет обработанные WebP в **Cloudflare R2** (S3-совместимое
хранилище через `lib/r2.ts`) и затем обновляет `articles.cover_image_url`. Ключи объектов
префиксуются `article-images/`, поэтому публичный URL содержит сегмент `/article-images/...`
(`https://<R2_PUBLIC_BASE_URL>/article-images/<...>`) — от этого зависит классификация
обложек (`classifyCover`/`needsAiCover` ищут `.includes('/article-images/ai-covers/')` и т.п.,
а `lib/media-sanitizer.ts::isArticleImagesStorageUrl` распознаёт и legacy Supabase-storage URL,
и R2-домен):

- `stock-covers/<date>/...` — бесплатный stock fallback с editorial treatment;
- `ai-covers/<date>/...` — ручной OpenAI Images fallback для верхних карточек;
- `template-covers/<date>/...` — бесплатный локальный SVG/WebP fallback, когда API-бюджет
  недоступен или достигнут hard limit.

> **Миграция 2026-05-26 (Supabase → R2).** Раньше обложки лежали в Supabase Storage bucket
> `article-images` и отдавались посетителям прямо из метрического egress. На бесплатном tier
> (5 GB/мес) `next.config` с `images.unoptimized = true` (Vercel Hobby image-лимит исчерпан
> 2026-05-22) выжег egress за ~3 дня → Supabase заблокировал проект (`exceed_egress_quota`),
> что положило весь cron-pipeline. Переезд на R2 (egress бесплатен) убирает этот класс отказа.
> Существующие Supabase-обложки переносит `scripts/migrate-covers-to-r2.ts` (требует
> разблокированного Supabase). `isArticleImagesStorageUrl` продолжает распознавать оба формата.

#### Responsive cover variants (R2, активна с 2026-05-29)

`images.unoptimized = true` в `next.config.mjs` означает, что Vercel-оптимизатор
(`/_next/image`) выключен — иначе на Hobby tier он возвращает HTTP 402 после исчерпания
лимита трансформаций. Без оптимизатора браузеру отдаётся полноразмерная (1200px) обложка
на всех вьюпортах → лишний вес и хуже LCP.

Вариант без зависимости от Vercel-оптимизатора: хранить готовые уменьшенные WebP-варианты
рядом с base-обложкой в R2 и отдавать их нативным `<img srcset>`.

- `lib/image-variants.ts` (pure, client-safe) — единственный источник истины по ширинам:
  `COVER_BASE_WIDTH=1200`, `COVER_VARIANT_WIDTHS=[400,800]`; `variantUrlFor`/`variantKeyFor`
  вставляют `-<width>` перед `.webp`; `isR2ImageUrl` распознаёт наши R2-обложки
  (host `*.r2.dev` или `NEXT_PUBLIC_R2_PUBLIC_BASE_URL`, путь `/article-images/...`, `.webp`);
  `r2VariantSrcSet` строит `"<url-400> 400w, <url-800> 800w, <base> 1200w"`.
- `lib/r2-images.ts::uploadWebpWithVariants` (server, sharp) — drop-in замена `uploadToR2`
  для cover-аплоадов: льёт base + варианты. Подключена в `pipeline/image-generator.ts`,
  `scripts/generate-ai-covers.ts`, `scripts/backfill-template-covers.ts`,
  `scripts/backfill-stock-covers.ts`,
  `scripts/replace-test-covers-with-editorial-templates.ts`.
- `scripts/backfill-cover-variants.ts` — генерит варианты для всех уже существующих
  R2-обложек (base не трогает; `--skip-existing` пропускает готовые).
- Рендер: `src/components/SafeImage.tsx` (карточки, `fill`) и hero на странице статьи
  (`app/categories/[category]/[slug]/page.tsx`) при включённой фиче отдают нативный
  `<img srcset>` для R2-обложек, иначе — обычный `next/image`.

Фича **включена в production с 2026-05-29** (`NEXT_PUBLIC_R2_IMAGE_VARIANTS=on`). Полный backfill
прогнан (489 R2-обложек: generated=481, skipped=8, failed=0) → инвариант закрыт: у каждой
R2-обложки есть `-400`/`-800`. Инвариант остаётся в силе: пока флаг включён, отсутствие варианта =
404 на выбранный браузером кандидат, поэтому новые cover-аплоады обязаны идти через
`uploadWebpWithVariants` (forward-path уже подключён). Порядок включения/отката — в
`docs/OPERATIONS.md` (секция «Responsive cover variants»). Внешние (не-R2) обложки по-прежнему идут
через `next/image` (`unoptimized`).

Homepage-priority AI cover mode (`scripts/generate-ai-covers.ts --homepage`) выбирает только две
видимые позиции главной: `getHotStoryOfTheDay()` и первый featured item в «Все новости» после
исключения hot story. Он генерирует cover только если после sanitizer/card-cover rules нет usable
cover, использует тот же OpenAI Images → R2 путь, обновляет только
`articles.cover_image_url` и пишет `llm_usage_logs.operation='image_cover_generation'`.

`needsAiCover()` (Wave 2, 2026-05-22): источник истины — `sanitizeArticleMedia` со ВСЕМ
доступным медиа (cover + `article_images`). Если sanitizer вернул usable cover (исходный или
промоутированный из inline) — AI-cover **не нужен**. Старый хардкод
`['Habr AI', 'vc.ru', 'vc.ru AI/стартапы', 'CNews']` убран: он перетирал реальные продуктовые
фото в `article_images` (например, vc.ru про Flipper One — 5 фото устройства из
`leonardo.osnova.io` лежали в `article_images`, а на главной показывалась AI-illustration
«Russian enterprise operations room»). Template/stock-обложки остаются заменяемыми на AI —
это локальные fill-in, AI обычно лучше.

`scripts/backfill-cover-from-inline.ts` (новый) — без вызовов OpenAI и без fetcher'а
сканирует статьи с `cover_image_url LIKE '%/article-images/ai-covers/%'` и непустым
`article_images`, прогоняет sanitizer (cover=null + articleImages из БД) и, если promotion
из inline даёт usable cover, заменяет AI-cover в `articles.cover_image_url`. Используется
для разовых ретроспективных починок; default — `--dry-run`, `--apply` обязателен для записи,
`--slug=<slug>` ограничивает одной статьёй. См.
`docs/spec_2026-05-22_digest_editorial_priority.md` Wave 2.

Scheduled AI cover mode обрабатывает только последние два московских календарных дня, чтобы
платный OpenAI Images budget тратился на свежие карточки. Старые видимые дыры закрывает
`scripts/backfill-template-covers.ts`: он локально генерирует WebP из SVG/editorial template,
загружает в `article-images/template-covers/<date>/...` и обновляет только
`articles.cover_image_url`.

Источники с текстовыми обложками (`Habr AI`, `vc.ru`, `vc.ru AI/стартапы`, `CNews`) остаются в
denylist для **cover-URL** с паттернами `/share/|/social/|/cover/|og-image|share-image|
card-image|default-cover|placeholder|no-image` (см. `lib/media-sanitizer.ts::looksLikeTextCover`),
но карточки и страницы статей разрешают URL из нашего bucket `article-images`, потому что это
уже нормализованный editorial treatment, а не source text-cover. С Wave 2 (2026-05-22)
`vc.ru` входит в `CONTEXTUAL_IMAGE_SOURCE_RE`, поэтому inline-картинки vc.ru с generic-caption
(«Источник здесь и далее: …») перестали отсекаться sanitizer'ом и могут быть промоутены в cover,
если оригинальный cover был отброшен.

### Inline images and tables

Fetcher вытаскивает релевантные inline images и таблицы из оригинального HTML и сохраняет их в structured fields статьи.
Для research-материалов отсутствие и cover, и inline images считается publish-risk: такие статьи
отсекаются до вызова Claude, чтобы раздел не заполнялся сухими короткими заметками.
Render layer больше не добавляет оставшиеся изображения хвостом после всех абзацев. Inline images
раскладываются только по внутренним слотам тела статьи (`lib/article-media-placement.ts`): короткие
статьи естественно показывают мало или ноль картинок, длинные могут показать больше 2–3 изображений
при минимальном расстоянии между слотами, и последний block тела не должен быть image.

### Media sanitizer

Единая точка очистки медиа — `lib/media-sanitizer.ts::sanitizeArticleMedia`;
`pipeline/media-sanitizer.ts` оставлен как re-export для pipeline-скриптов.
Она применяется в трёх местах:

- `pipeline/enrich-submit-batch.ts` — перед score/publish gate и перед записью `article_context`;
- `pipeline/enrich-collect-batch.ts` — перед RPC `apply_anthropic_batch_item_result`;
- `app/categories/[category]/[slug]/page.tsx` и карточки — как render fallback для legacy данных.

Sanitizer (Wave 2 update + Wave 4 hardening 2026-05-23) дополнительно отбрасывает
**source-side stock-placeholder** URL'ы — например, CNews повторно использует
`static.cnews.ru/img/articles/.../gemini_generated_image_*.png` как заглушку для разных
статей без фото. Без этого фильтра broader backfill промоутил бы одну и ту же картинку
как cover для нескольких неродственных материалов. Reject code: `stock_placeholder`,
матчится по `/gemini[-_]?generated[-_]?image|ai[-_]?generated[-_]?image/i` в `src`.

Sanitizer отбрасывает рекламные/промо URL и контекст (`adfox`, `doubleclick`, `yabs`,
`/ads/`, `/banner`, `/promo`, `career.habr.com`, career/course/job text), UI-иконки
и share-элементы (`/icon/`, `/sprite/`, share/social/arrow/button SVG), author/byline/headshot
картинки (`Photo of ...`, `author`, `byline`, `avatar`, `profile`, `headshot`) и inline images
с generic или нерелевантной подписью. SVG не допускается как cover (`svg_cover`), потому что
для editorial-новостей это почти всегда логотип или интерфейсная иконка. Fetcher передаёт
расширенный контекст изображения:
`caption`, `title`, размеры, class/id родителя, link href и ближайший `figure`.

**Runtime cover fallback**: после sanitizer-а если `coverImageUrl=null`
(не было исходного cover или он был отброшен) и в `articleImages` остались
sanitized картинки, sanitizer промоутит первую sanitized inline-картинку в
cover (`SanitizedMedia.coverPromotedFromInline=true`). Это снижает число
страниц, которые на runtime отдают `/og-default.png`. Render слой
(`app/categories/[category]/[slug]/page.tsx::generateMetadata`) при отсутствии
cover после promotion использует `SITE_LOGO_URL` как brand-fallback, а
`NewsArticle.publisher.logo` и `NewsArticle.image` тоже опираются на
`SITE_LOGO_URL` (а не на `/og-default.png`).

Backfill старых live-статей выполняется тем же sanitizer-ом через
`npx tsx scripts/sanitize-existing-article-media.ts --dry-run` и только после просмотра отчёта
может запускаться с `--apply`.
Для восстановления отсутствующих или отброшенных cover используется
`npx tsx scripts/backfill-cover-images.ts --dry-run`: он без вызовов Claude фетчит исходник
с `includeText=false`, применяет ту же media-цепочку и обновляет только `cover_image_url` /
`article_images` после явного `--apply`.

Когда sanitizer отбрасывает хотя бы один media candidate в submit или collect, pipeline пишет
`article_attempts.stage='media_sanitize'`. В submit `result_status='rejected'` означает, что
после очистки не осталось ни cover, ни inline images и research-статья была отклонена
pre-submit gate. Остальные sanitizer-срабатывания пишутся как `ok` с payload по reject-причинам
и оставшемуся медиа.

## Sources and feed filters

Broad RSS feeds допускаются только с keyword filters:

- `vc.ru` сейчас имеет рабочий официальный RSS `https://vc.ru/rss/all`; тематические AI/startups
  endpoints на момент проверки отвечали 404, поэтому используется общий feed с жёсткими AI/startup
  filters из `pipeline/keyword-filters.ts`.
- Русские keyword filters нормализуют `ё→е`; короткий ключ `ии` матчится только по границе слова,
  чтобы не цеплять подстроки внутри слов вроде «инициатива» или «Великобритании». Для vc.ru
  добавлены варианты `нейронк`, `ии-`, `ии-агент`, `ии-ассистент`.
- `vc.ru AI/стартапы`, `RB.ru`, `TechCrunch Startups`, `Crunchbase News`, `TechCrunch Venture`
  дают материалы для `ai-startups`, но проходят через startup keyword filters.
- Для vc.ru source health дополнительно следит за live-yield: если по `source_name ILIKE '%vc.ru%'`
  нет live/verified статьи за 7 дней, поднимается `source_low_live_yield` follow-up.
- Для самых широких startup feeds доступен `keywordGroups`: каждая группа должна иметь хотя бы одно
  совпадение. Например, RB.ru должен совпасть и с AI-группой, и со startup/deal-группой, чтобы
  обычные новости про маркетплейсы или инвестиции не попадали в `ai-startups`.
- Для шумных broad feeds можно включить `keywordSearchFields='title'`: keyword matching идёт только
  по заголовку, чтобы HTML/navigation/related text в RSS description не протаскивал нерелевантные
  материалы.
- Для ru broad feeds свежесть определяется по RSS `pubDate`; проверка даты в URL доступна только
  как opt-in `requireDateInUrl`, потому что `vc.ru` и `RB.ru` не обязаны иметь дату в canonical URL.
- `parseFeed` возвращает rejected summary: `keyword_filter` для items без нужных keyword-групп и
  `requireDateInUrl` для ru-feeds, где включён URL-date gate. `ingest` дополняет этот breakdown
  причиной `dedup`, когда item уже есть по `dedup_hash`, и пишет счётчики в `source_runs`.
- **Off-topic blocklist** (`OFF_TOPIC_KEYWORDS` в `pipeline/keyword-filters.ts`) применяется ко
  всем фидам до per-feed keyword filter и до Claude enrichment. Цель — не пускать гаджетный/
  consumer-tech контент (`android auto`, `airpods`, `dishwasher`, `gaming chair`, ...) с broad
  AI-тэгнутых feeds (ZDNet AI, Wired AI, CNet AI) в стадию enrichment, чтобы не тратить токены и
  не размывать topical authority. Совпадение даёт reason `off_topic_filter` в
  `source_runs.items_rejected_breakdown`. Список расширяется по мере наблюдаемых off-topic
  кейсов.
- `ZDNet AI` и `Wired AI` дополнительно переведены на `needsKeywordFilter: true` с
  `EN_AI_CORE_KEYWORDS` и `keywordSearchFields: 'title'` — даже если RSS назван «AI», он де-факто
  смешанный, поэтому требуется явный AI-токен в заголовке.
- `Google DeepMind Blog` добавлен как официальный research/labs RSS. Проверенные стандартные RSS
  endpoints `anthropic.com` на момент проверки отвечали 404, поэтому Anthropic остаётся источником
  через broad AI feeds и keyword filters, а не через неофициальный агрегатор.
- `Google Blog` (`https://blog.google/technology/ai/rss/`) — продуктовый блог Google для Gemini /
  Veo / Imagen / I/O-анонсов. Endpoint 301-редиректится на
  `/innovation-and-ai/technology/ai/rss/`, но Google использует категорию `AI` широко
  (community-инвестиции, инфраструктурные посты), поэтому фид остаётся `needsKeywordFilter: true`
  с `EN_AI_CORE_KEYWORDS` и `keywordSearchFields: 'title'`. Добавлен в Wave 3 спека
  `docs/spec_2026-05-22_digest_editorial_priority.md`: раньше Google product-анонсы долетали к
  нам только через посредников (Verge/TechCrunch) с задержкой и без `+3` AI_LABS-бонуса.
- `Habr Startups` использует hub `startuprise` и проходит через startup keyword filter, потому что
  сам hub шире AI.
- Если в течение недели source health или ручная проверка показывает >30% мусора из broad feed,
  фильтр нужно ужесточить или временно отключить источник в `pipeline/feeds.config.ts`.

### Video

Если в исходном материале есть тематически уместное встроенное видео, оно должно попадать в статью.

Текущая логика:
- fetcher (`pipeline/fetcher.ts`) определяет поддерживаемые embed/direct video источники;
- селекторы тела статьи покрывают Habr (`.tm-article-body`, `.article-formatted-body`, `.post__text`), vc.ru/DTF (`.content--full`), RB.ru (`.s-news__text`, `.b-article__text`), а также общие `article`, `main`, `.content`, `.post`, `[class*="article"]`, `[class*="content"]`;
- если в article-контейнерах нет iframe-ов, fallback ищет ВСЕ iframe-ы на странице, фильтруя по known video host (YouTube/Vimeo/Rutube/VK) и исключая sidebar/related/comments по class/id;
- новые статьи после enrich сохраняют `article_videos` в статье после применения миграции `007_article_videos.sql`;
- для старых статей без сохранённого видео страница статьи может получить media fallback из исходника;
- до применения `007_article_videos.sql` collector остаётся совместим со старой RPC-сигнатурой, поэтому deploy не ломает batch apply;
- на странице статьи видео показывается отдельным блоком;
- structured data страницы включает `VideoObject`, если видео есть;
- backfill для уже опубликованных статей: `npx tsx scripts/backfill-article-videos.ts`.

Поддерживаемые провайдеры:
- YouTube
- Vimeo
- Rutube
- VK video
- direct video files

## URL policy

Публичные URL статьи и раздела (волна 2.2):

```text
/categories/<category-slug>            — лента раздела
/categories/<category-slug>/<slug>     — страница статьи
/guides/<slug>                         — evergreen-гайд вне новостной БД
```

Правила:
- canonical статьи всегда строится по её `primary_category`. Появление статьи в листинге secondary-категории на canonical не влияет;
- production canonical-домен news-сайта задан в `lib/site.ts` как `https://news.malakhovai.ru`;
- sitemap, RSS, llms.txt, Telegram digest, internal-ссылки и related — все используют новый URL через `getArticlePath(slug, primary_category)` / `getArticleUrl(siteUrl, slug, primary_category)` из `lib/article-slugs.ts`;
- sitemap, RSS и `llms.txt` не берут canonical-домен из env: все публичные URL в этих поверхностях должны оставаться на `news.malakhovai.ru`;
- evergreen-гайды хранят Markdown в `content/guides/`, metadata registry в
  `content/guides/meta/<slug>.json`, картинки в `public/images/guides/<slug>/`;
  `lib/guides.ts` читает registry и добавляет гайды в sitemap как статичные monthly URL;
- `app/sitemap.ts` использует ISR (`export const revalidate = 1800`), чтобы пересобираться каждые 30 минут из live-выборки и не зависать на состоянии последнего деплоя — без этого свежие статьи невидимы для Яндекс/Google до следующего билда;
- `pipeline/publish-verify.ts` после успешного перехода статьи в `live` вызывает `pingIndexNow()` (`lib/indexnow.ts`) на `https://api.indexnow.org/indexnow`, чтобы Yandex / Bing узнали о новом URL за минуты, а не за дни. Ключ — env `INDEXNOW_KEY`, проверочный файл — `app/indexnow.txt/route.ts`. Без env-переменной ping молча no-op'ится, publish-path не ломается. Google не участвует в IndexNow и продолжает индексировать через sitemap;
- публичные листинги (`/archive/[date]`, `/sources`, `/sources/[source]`, `/categories/[category]`, `/russia`) задают canonical / `og:url` на news-домен через `lib/site.ts::absoluteUrl`;
- новые slug создаются без случайных hex/uuid-хвостов; при коллизии используются понятные суффиксы `-2`, `-3`, ...;
- slug назначается только в apply path, а не в submit phase;
- legacy slug с техническим хвостом допускается только как входной адрес и редиректится на чистый;
- legacy URL `/articles/<slug>` отвечает 308-редиректом на `/categories/<primary>/<slug>` (резолв в `app/articles/[slug]/page.tsx`);
- legacy URL `/topics/<slug>` отвечает 308-редиректом на `/categories/<slug>` (slug-и категорий совпадают со старыми topic-ами; см. `app/topics/[topic]/page.tsx`);
- хлебные крошки на странице статьи: `Главная → Категория → Источник`.

## Рендер статьи

Страница статьи отвечает за:

- title, lead, editorial body;
- glossary и related links при наличии;
- media blocks: cover, inline images, tables, video;
- source attribution;
- internal linking и SEO metadata;
- JSON-LD, включая `VideoObject` при наличии видео.

## Связанные поверхности

- Главная и category pages используют опубликованные статьи.
- `/guides` и `/guides/[slug]` используют file-based контент из `content/guides/` и metadata из
  `content/guides/meta/` через `lib/guides.ts`; это SEO-слой evergreen-материалов, не ingest/enrich/publish flow.
- Evergreen metadata поддерживает `noindex: true` для production-preview страниц: такой guide доступен
  по прямому `/guides/<slug>`, но не показывается в `/guides`, не поднимается в featured guide на
  главной и не попадает в sitemap; `app/guides/[slug]/page.tsx` отдаёт robots `noindex`.
- `GuideMeta` (`lib/guides.ts`) включает обязательные `publishedAt`, `updatedAt`, `verifiedAt`
  (ISO-date — дата последней проверки фактов; рендерится в шапке гайда как «Актуальность
  проверена: …»), опциональное `caseSourcing` (`public` / `anonymized` / `editorial` — для
  редакционного аудита) и опциональное `relatedArticleCategories` для блока «Связанные статьи».
  `app/guides/[slug]/page.tsx::buildJsonLd` собирает `Article` с
  `author = Person` (`/about#person`), `wordCount` (считается из markdown), `articleSection`
  (категория) и `keywords` (`tags.join(', ')`). Страница гайда использует
  `GuideMobileToc`, `GuideDesktopToc`, `GuideBackToTop` и общий `guideArticleStyles`;
  источники рендерятся в раскрываемом блоке, а `relatedArticleCategories` подтягивает live-статьи
  через `getGuideRelatedArticles()`.
- `content/evergreen/` — локальный редакционный workflow для evergreen-пакетов:
  `topics.json` хранит backlog, `templates/` задаёт шаги подготовки, `packages/<slug>/`
  хранит SEO-бриф, исследование, черновик, редактуру, metadata draft, image brief,
  Codex publication task и checklist. Эти файлы не становятся публичным контентом,
  пока Codex не перенесёт approved Markdown в `content/guides/<slug>.md`, metadata в
  `content/guides/meta/<slug>.json` и изображения в `public/images/guides/<slug>/`.
- Image pipeline для evergreen: `09-image-brief.md` готовит prompts/filenames; владелец
  генерирует PNG через подписку ChatGPT (Plus/Pro/Codex) — image API не используется — и кладёт
  файлы в `content/evergreen/packages/<slug>/raw-images/<filename>.png`; `npm run images:prep --
  --slug=<slug>` (`scripts/images-prep.ts`) ресайзит и конвертирует в WebP (cover 1200×675,
  inline rect 1200×800, square 1200×1200, quality 82) и кладёт в
  `public/images/guides/<slug>/<filename>.webp`. `npm run evergreen:check -- --slug=<slug>`
  проверяет meta-схему (`verifiedAt`, `caseSourcing`, CTA cap), lead anchor, counter-strategy
  H2, case block, ≥ 2 inline `/guides|/categories|/russia` ссылок, редакционные запреты
  (`не X, а Y`, `proof of concept`, `production`, `no-code`, `AI-сигналы` и т.п.) в финальном
  markdown/metadata, cover ≥ 80 KB и `noindex` старше 14 дней.
- Archive и source pages используют те же article records.
- Article pages (`app/categories/[category]/[slug]/page.tsx`) SSG/ISR-ятся с `revalidate=3600`.
  Related/recommendation cards намеренно пропускаются во время `npm run build`
  (`process.env.npm_lifecycle_event === 'build'`), потому что они делают несколько широких
  Supabase-запросов на каждую статью и могут выбить Vercel/Next static generation timeout.
  На runtime ISR/revalidation рекомендации снова считаются обычным `getArticleRecommendations()`.
- Telegram digest использует `tg_teaser`, `ru_title`, score и public article URL (`/categories/<primary>/<slug>`).
  Selection (`bot/daily-digest-core.ts`):
  - SELECT top-50 за вчерашний MSK-день по `score desc, pub_date desc` среди
    `live + quality_ok + verified_live + tg_sent=false + tg_teaser/slug present`.
  - `filterLiveArticles` отсекает недоступные URL (HEAD-проверка с timeout 5s).
  - `selectDigestArticles()` (`bot/digest-selection.ts`) сохраняет source cap:
    `perSourceCap=2`, `target=5`. Без этого кэпа Habr AI регулярно занимал 4–5 из 5
    слотов и заталкивал индустриальные сюжеты (Gemini-launches, OpenAI-релизы) ниже.
  - Тот же selector строит deterministic `storyKey` по `primaryEntity + eventType + signature`
    и не берёт две strong-статьи про один инфоповод в один дайджест. Пример:
    Crunchbase/TechCrunch/The Decoder про раунд Anthropic $65B → один
    `anthropic:funding:65b`.
  - Перед selection загружается память последних successful дайджестов за 72 часа через
    `digest_runs.article_ids`; strong `storyKey`, уже отправленный недавно, пропускается.
    Это закрывает кейс, когда один источник публикует тот же инфоповод после границы
    MSK-дня и он всплывает на следующий день.
  - Дополнительный cap: не больше 2 strong-статей с одной `primaryEntity` в финальных 5.
    Разные события одной компании допустимы: `Anthropic funding` и `Claude Opus release`
    имеют разные `eventType` и могут сосуществовать.
  - `validateDigestComposition()` проверяет финальный список перед отправкой и логирует
    duplicate story keys, source/entity distribution и skipped-причины. Runtime не требует
    новой миграции: диагностика идёт в logs, а retro-аудит доступен через
    `npm run digest:audit-selection -- --date=YYYY-MM-DD`.
- Category pages (`/categories/[category]`, `/russia`) и главная под hero рендерят `TopicTabs`
  (см. `docs/DESIGN.md`) — это навигационный слой, не источник фильтрации; сам список статей берётся
  через `getArticlesByCategoryPage` (primary OR secondary, `.range()` + `count: exact`) /
  `getRussiaArticles` / `getArticlesFeed`.
- Category pages грузят 20 статей за раз. Первый серверный рендер принимает `?page=N`;
  клиентская кнопка «Показать ещё» догружает следующую страницу через
  `/api/categories/<category>/articles?page=N`, дописывает карточки к текущему списку и обновляет URL
  для шаринга. При выходе за последний page сервер редиректит на последнюю доступную страницу.
- Главная «Все новости», обычная лента раздела, `/russia` и `/sources/<source>` сортируются по
  времени добавления в наш каталог: `created_at desc`, затем `pub_date desc nulls last`,
  `score desc`, `id desc` там, где поле доступно для tie-breaker. Score больше не поднимает
  старую статью выше свежей в основной ленте.
- На главной «Все новости» исключает текущую hot story из всей своей пагинации; total для блока
  считается уже после исключения, чтобы page 1 и последующие страницы не дублировали один материал.
- Блок «Самое интересное» на `/categories/[category]` и `/russia` строится отдельным
  deterministic ranking-ом (`lib/interest-ranking.ts`): editorial score + time decay +
  source weight + content/media quality + diversity по источникам. Primary-окно кандидатов —
  72 часа по `created_at`, fallback — до 30 дней; freshness decay использует `exp(-ageHours / 24)`.
  Блок скрывается, если после фильтрации меньше трёх кандидатов, и не требует персонального tracking.
- Рекомендации на странице статьи используют `getArticleRecommendations(article)`: same primary
  category имеет первый приоритет, затем shared secondary/topics, freshness, score, source diversity
  и content/media quality. Primary-окно кандидатов — последние 72 часа, fallback — до 30 дней;
  блок скрывается, если после исключения текущей статьи меньше трёх рекомендаций.
- Legacy маршруты `/articles/[slug]` и `/topics/[topic]` остаются только как 308-редиректы.
- Главная страница в верхнем VC-блоке использует `getHotStoryOfTheDay()`
  (статья с наивысшим score за последние 24 часа из live; если score ниже порога —
  fallback на самую свежую опубликованную) и `getRecentHeadlines()` (чисто хронологический
  список свежих заголовков для левой колонки). Подробности UX и стилей — в `docs/DESIGN.md`.

## Когда обновлять этот файл

Обновлять при изменении:
- ingest/enrich/publish flow, включая submit/collect ownership;
- score threshold или quality gates;
- article schema на уровне editorial/media fields;
- модели категорий (primary/secondary) и справочника `categories`;
- slug и URL policy;
- логики media extraction/rendering;
- digest article selection.
