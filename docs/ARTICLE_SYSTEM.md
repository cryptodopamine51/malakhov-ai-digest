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

### Batch source of truth

Batch-specific lifecycle не хранится в `articles.enrich_status`.

Для него используются:

- `anthropic_batches`
- `anthropic_batch_items`

Ключевой смысл:

- `articles.enrich_status='processing'` в batch-flow означает, что статья находится внутри enrich pipeline, но final apply ещё не завершён;
- `articles.current_batch_item_id` указывает на активный batch-owned item, если ownership уже передан из article lease;
- item-level states (`queued_for_batch`, `batch_submitted`, `batch_processing`, `batch_result_ready`, `applying`, `applied`, `batch_failed`, `apply_failed_*`) живут только в batch tables.

## Score и publish gate

- Статья сначала оценивается scorer-ом.
- Текущий порог для отправки в Claude: `score >= 2`.
- Если score ниже порога, статья отклоняется до batch submit и не тратит Claude cost.
- Если quality check не пройден после successful batch result, статья уходит в `rejected` и остаётся в `draft`.
- Если quality check пройден и apply завершился успешно, статья становится `publish_ready`.

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

## Media policy

### Cover image

Cover image берётся из исходника, если доступна.

Для выбора production fallback-стратегии существует неиндексируемая лаборатория `/demo/image-lab`.
Она сравнивает пять направлений обложек для статей без хорошей картинки: source image, stock editorial treatment,
local SVG/editorial template, cover bank и AI budget cover. Это визуальный тест, а не production pipeline:
страницы статей и карточки по-прежнему читают `cover_image_url` из `articles`.

### Inline images and tables

Fetcher вытаскивает релевантные inline images и таблицы из оригинального HTML и сохраняет их в structured fields статьи.

### Video

Если в исходном материале есть тематически уместное встроенное видео, оно должно попадать в статью.

Текущая логика:
- fetcher определяет поддерживаемые embed/direct video источники;
- новые статьи после enrich сохраняют `article_videos` в статье после применения миграции `007_article_videos.sql`;
- для старых статей без сохранённого видео страница статьи может получить media fallback из исходника;
- до применения `007_article_videos.sql` collector остаётся совместим со старой RPC-сигнатурой, поэтому deploy не ломает batch apply;
- на странице статьи видео показывается отдельным блоком;
- structured data страницы включает `VideoObject`, если видео есть.

Поддерживаемые провайдеры:
- YouTube
- Vimeo
- Rutube
- VK video
- direct video files

## Slug policy

Публичные URL статьи должны быть чистыми:

```text
/articles/<human-readable-slug>
```

Правила:
- новые slug создаются без случайных hex/uuid-хвостов;
- при коллизии используются понятные суффиксы `-2`, `-3`, ...;
- slug назначается только в apply path, а не в submit phase;
- legacy slug с техническим хвостом допускается только как входной адрес;
- legacy URL должен редиректить на clean public slug;
- canonical, sitemap и внутренние ссылки должны использовать clean slug.

## Рендер статьи

Страница статьи отвечает за:

- title, lead, editorial body;
- glossary и related links при наличии;
- media blocks: cover, inline images, tables, video;
- source attribution;
- internal linking и SEO metadata;
- JSON-LD, включая `VideoObject` при наличии видео.

## Связанные поверхности

- Главная и topic pages используют опубликованные статьи.
- Archive и source pages используют те же article records.
- Telegram digest использует `tg_teaser`, `ru_title`, score и public article URL.
- Topic pages (`/topics/[topic]`, `/russia`) и главная под hero рендерят `TopicTabs`
  (см. `docs/DESIGN.md`) — это навигационный слой, не источник фильтрации; сам список
  статей берётся теми же `getArticlesByTopic` / `getRussiaArticles` / `getArticlesFeed`.
- Главная страница в верхнем VC-блоке использует `getHotStoryOfTheDay()`
  (статья с наивысшим score за последние 24 часа из live; если score ниже порога —
  fallback на самую свежую опубликованную) и `getRecentHeadlines()` (чисто хронологический
  список свежих заголовков для левой колонки). Подробности UX и стилей — в `docs/DESIGN.md`.

## Когда обновлять этот файл

Обновлять при изменении:
- ingest/enrich/publish flow, включая submit/collect ownership;
- score threshold или quality gates;
- article schema на уровне editorial/media fields;
- slug и URL policy;
- логики media extraction/rendering;
- digest article selection.
