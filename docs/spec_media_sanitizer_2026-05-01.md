# Spec: article media sanitizer

Дата: 2026-05-01
Статус: implementation spec

## Problem

Текущая логика inline images слишком доверяет исходным сайтам. Она отсекает только часть мусора по `src`, но не понимает рекламный/авторский контекст. Поэтому в статьи попадают:

- рекламные баннеры;
- career/course promo;
- author portraits/headshots;
- картинки с подписью, не связанной с темой статьи.

## Design goal

Один общий sanitizer должен применяться:

1. при fetch/enrich до записи в Supabase;
2. при backfill старых статей;
3. при render как страховка для legacy данных.

Это исключит расхождение «новые статьи чистые, старые всё ещё показывают мусор».

## Data contract

Новый internal type:

```ts
export interface ArticleImageCandidate {
  src: string
  alt: string
  title?: string | null
  caption?: string | null
  width?: number | null
  height?: number | null
  parentClassName?: string | null
  parentId?: string | null
  parentHref?: string | null
  nearestFigureClassName?: string | null
  source?: 'og' | 'inline' | 'generated' | 'unknown'
}

export interface MediaSanitizerContext {
  sourceName: string
  originalUrl: string
  originalTitle: string
  ruTitle?: string | null
  lead?: string | null
  summary?: string[] | null
  originalText?: string | null
}

export interface MediaReject {
  src: string
  reason: string
}

export interface SanitizedMedia {
  coverImageUrl: string | null
  articleImages: { src: string; alt: string }[]
  rejects: MediaReject[]
}
```

Если schema change нежелателен, expanded metadata используется только внутри pipeline/backfill, а в БД остаётся текущий shape `{ src, alt }[]`.

## Reject rules

### Hard reject by URL/domain/path

Reject if `src`, normalized URL, or parent link contains:

- `adfox`
- `doubleclick`
- `googlesyndication`
- `yandex/direct`
- `yabs`
- `/ads/`
- `/ad/`
- `/advert`
- `/banner`
- `/promo`
- `career.habr.com`
- `habr.com/ru/companies/habr_career`

### Hard reject by text/class/id

Normalize `alt`, `title`, `caption`, parent class/id, figure class/id, parent href.

Reject if text contains:

- English: `ad`, `ads`, `advert`, `advertisement`, `banner`, `promo`, `sponsored`, `partner`, `career`, `jobs`, `vacancy`, `course`, `courses`
- Russian: `реклама`, `промо`, `партнерский`, `партнёрский`, `карьера`, `вакансии`, `вакансия`, `работа`, `курс`, `курсы`, `обучение`

Avoid false positive for normal words by checking word boundaries for short tokens like `ad`.

### Author/byline/headshot reject

Reject if text/class/id contains:

- `author`, `byline`, `bio`, `profile`, `avatar`, `contributor`, `headshot`, `portrait`
- `Photo of ...`
- `Portrait of ...`
- `Author photo`
- `Фото автора`
- `Автор:`

Source-specific:

- Ars Technica: reject captions matching `Photo of [A-Z]` unless article title/lead includes that person as the subject.
- Habr AI: reject career/course banners and images linked to career/course pages.

### Dimension/aspect heuristics

Reject:

- width or height under 80 px;
- very wide banner `ratio >= 2.8`, unless caption/title strongly matches article subject;
- very tall narrow portrait `ratio <= 0.6`, if caption/class indicates author/profile/headshot;
- generic social/share images from known sources already handled as text covers.

### Relevance heuristic

Build meaningful tokens from:

- `originalTitle`
- `ruTitle`
- `lead`
- first 2 summary bullets
- named terms from `originalText` if cheap

Keep inline image if one of these is true:

- caption/alt contains at least one significant article token/entity;
- image is from source-specific allowlist and not rejected by hard rules;
- caption is a real descriptive phrase and source is known to put relevant article images in body.

Reject if:

- caption is generic: `image`, `photo`, `illustration`, `source`, filename, URL;
- caption is only a person name and article is not about that person;
- no caption/alt and not a known good article image.

## Cover image rules

`cover_image_url` can be retained more often than inline images, but must be rejected if:

- URL/domain/path hard-rejects;
- source is in `SOURCES_WITH_TEXT_COVERS` and card logic would hide it anyway;
- image is Habr share/text cover and a generated image should be used instead;
- dimensions/metadata prove it is banner/promo.

When cover is rejected:

- set `cover_image_url = null`;
- let card render placeholder or generated fallback flow.

## Integration points

### Fetcher

In `extractInlineImages()`:

- collect expanded candidate metadata;
- skip excluded ancestors before candidate creation;
- return max 5 after sanitizer or return raw max N and sanitize later.

Preferred: return raw candidate metadata internally, sanitize before storing.

### Batch collect

Before `apply_anthropic_batch_item_result`:

```ts
const sanitized = sanitizeArticleMedia({
  coverImageUrl: articleContext.cover_image_url ?? article.cover_image_url,
  articleImages: articleContext.article_images ?? [],
  context: { ...article/editorial fields },
})
```

Use:

- `p_cover_image_url: sanitized.coverImageUrl`
- `p_article_images: sanitized.articleImages`

### Render safety

In `selectInlineImages()`:

- call a lightweight sanitizer on current `article.article_images`;
- do not render rejected legacy images.

### Backfill

Script:

```bash
npx tsx scripts/sanitize-existing-article-media.ts --dry-run
npx tsx scripts/sanitize-existing-article-media.ts --apply --limit=200
```

Dry-run output must include:

- total scanned;
- total changed;
- per-source reject summary;
- examples of removed URLs/captions.

## Tests

Minimum fixtures:

1. Habr career course banner is rejected.
2. Generic ad banner with `adfox` URL is rejected.
3. Ars Technica `Photo of Stephen Clark` author image is rejected.
4. Relevant product screenshot with title token is kept.
5. Relevant research chart with meaningful caption is kept.
6. Empty/generic caption image is rejected.
7. Existing `{ src, alt }` legacy shape still works.

## Acceptance

- Existing problem articles no longer show ad/author images.
- New pipeline writes sanitized images only.
- Backfill can run safely in dry-run and apply modes.
- Sanitizer logs enough reason data to debug false positives.
