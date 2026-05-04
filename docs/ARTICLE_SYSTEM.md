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

## Score и publish gate

- Статья сначала оценивается scorer-ом.
- Базовый порог для отправки в Claude: `score >= 2`.
- Категорийные пороги задаются в `pipeline/scorer.config.ts`. Для `ai-research` порог выше:
  `score >= 4`, потому что раздел должен получать меньше, но глубже и качественнее материалов.
- Если score ниже порога, статья отклоняется до batch submit и не тратит Claude cost.
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

- `pipeline/slug.ts::generateSlug` транслитерирует ru-заголовок в ASCII через TRANSLIT_MAP и стрипит всё, кроме `[a-z0-9-]`.
- `pipeline/slug.ts::normalizeSlug` — defensive helper, который приводит slug из любого источника (legacy backfill, ручной импорт) к каноническому виду.
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

`/api/health` (`lib/health-summary.ts`) при чтении схлопывает ключи по префиксу до `:` — `research_too_short:1240` и `research_too_short:980` сливаются в `research_too_short`, чтобы оператор видел агрегат. Сами строки в `enrich_runs` сохраняются с детализацией для post-mortem.

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

Cover image берётся из исходника, если доступна.

Для выбора production fallback-стратегии существует неиндексируемая лаборатория `/demo/image-lab`.
Она сравнивает пять направлений обложек для статей без хорошей картинки: source image, stock editorial treatment,
local SVG/editorial template, cover bank и AI budget cover. Это визуальный тест, а не production pipeline:
страницы статей и карточки по-прежнему читают `cover_image_url` из `articles`.

Production fallback backfill пишет обработанные WebP в Supabase Storage bucket `article-images`
и затем обновляет `articles.cover_image_url`:

- `stock-covers/<date>/...` — бесплатный stock fallback с editorial treatment;
- `ai-covers/<date>/...` — ручной OpenAI Images fallback для верхних карточек;
- `template-covers/<date>/...` — бесплатный локальный SVG/WebP fallback, когда API-бюджет
  недоступен или достигнут hard limit.

Источники с текстовыми обложками (`Habr AI`, `vc.ru`, `CNews`) остаются в denylist для исходных
картинок, но карточки и страницы статей разрешают URL из нашего bucket `article-images`, потому что
это уже нормализованный editorial treatment, а не source text-cover.

### Inline images and tables

Fetcher вытаскивает релевантные inline images и таблицы из оригинального HTML и сохраняет их в structured fields статьи.
Для research-материалов отсутствие и cover, и inline images считается publish-risk: такие статьи
отсекаются до вызова Claude, чтобы раздел не заполнялся сухими короткими заметками.

### Media sanitizer

Единая точка очистки медиа — `lib/media-sanitizer.ts::sanitizeArticleMedia`;
`pipeline/media-sanitizer.ts` оставлен как re-export для pipeline-скриптов.
Она применяется в трёх местах:

- `pipeline/enrich-submit-batch.ts` — перед score/publish gate и перед записью `article_context`;
- `pipeline/enrich-collect-batch.ts` — перед RPC `apply_anthropic_batch_item_result`;
- `app/categories/[category]/[slug]/page.tsx` и карточки — как render fallback для legacy данных.

Sanitizer отбрасывает рекламные/промо URL и контекст (`adfox`, `doubleclick`, `yabs`,
`/ads/`, `/banner`, `/promo`, `career.habr.com`, career/course/job text), author/byline/headshot
картинки (`Photo of ...`, `author`, `byline`, `avatar`, `profile`, `headshot`) и inline images
с generic или нерелевантной подписью. Fetcher передаёт расширенный контекст изображения:
`caption`, `title`, размеры, class/id родителя, link href и ближайший `figure`.

Backfill старых live-статей выполняется тем же sanitizer-ом через
`npx tsx scripts/sanitize-existing-article-media.ts --dry-run` и только после просмотра отчёта
может запускаться с `--apply`.

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
- `vc.ru AI/стартапы`, `RB.ru`, `TechCrunch Startups`, `Crunchbase News`, `TechCrunch Venture`
  дают материалы для `ai-startups`, но проходят через startup keyword filters.
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
- `Google DeepMind Blog` добавлен как официальный research/labs RSS. Проверенные стандартные RSS
  endpoints `anthropic.com` на момент проверки отвечали 404, поэтому Anthropic остаётся источником
  через broad AI feeds и keyword filters, а не через неофициальный агрегатор.
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
```

Правила:
- canonical статьи всегда строится по её `primary_category`. Появление статьи в листинге secondary-категории на canonical не влияет;
- production canonical-домен news-сайта задан в `lib/site.ts` как `https://news.malakhovai.ru`;
- sitemap, RSS, llms.txt, Telegram digest, internal-ссылки и related — все используют новый URL через `getArticlePath(slug, primary_category)` / `getArticleUrl(siteUrl, slug, primary_category)` из `lib/article-slugs.ts`;
- sitemap, RSS и `llms.txt` не берут canonical-домен из env: все публичные URL в этих поверхностях должны оставаться на `news.malakhovai.ru`;
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
- Archive и source pages используют те же article records.
- Telegram digest использует `tg_teaser`, `ru_title`, score и public article URL (`/categories/<primary>/<slug>`).
- Category pages (`/categories/[category]`, `/russia`) и главная под hero рендерят `TopicTabs`
  (см. `docs/DESIGN.md`) — это навигационный слой, не источник фильтрации; сам список статей берётся
  через `getArticlesByCategoryPage` (primary OR secondary, `.range()` + `count: exact`) /
  `getRussiaArticles` / `getArticlesFeed`.
- Category pages грузят 20 статей за раз. Первый серверный рендер принимает `?page=N`;
  клиентская кнопка «Показать ещё» догружает следующую страницу через
  `/api/categories/<category>/articles?page=N`, дописывает карточки к текущему списку и обновляет URL
  для шаринга. При выходе за последний page сервер редиректит на последнюю доступную страницу.
- Обычная лента раздела сортируется по свежести (`pub_date desc nulls last`, затем
  `created_at desc`, `score desc`, `id desc`). Score больше не поднимает старую статью выше
  свежей в основной ленте.
- Блок «Самое интересное» на `/categories/[category]` и `/russia` строится отдельным
  deterministic ranking-ом (`lib/interest-ranking.ts`): editorial score + time decay +
  source weight + content/media quality + diversity по источникам. Он скрывается, если после
  фильтрации меньше трёх кандидатов, и не требует персонального tracking.
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
