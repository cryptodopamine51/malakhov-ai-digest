# Spec: «Самое интересное» ranking

Дата: 2026-05-01
Статус: MVP spec

## Goal

Добавить в разделы отдельный блок «Самое интересное», который показывает потенциально более интересные материалы, не ломая свежую сортировку основной ленты.

Главное правило:

- основная лента раздела = свежие новости;
- «Самое интересное» = отдельный deterministic ranking.

## Research summary

Готовые библиотеки:

- Microsoft Recommenders: production reference с DKN, LSTUR, NAML, NRMS, SAR, LightFM, TF-IDF. Хорошо как источник подходов, но тяжело для MVP без user feedback. https://github.com/recommenders-team/recommenders
- TensorFlow Recommenders: полный ML workflow для retrieval/ranking, требует отдельной ML-инфраструктуры. https://github.com/tensorflow/recommenders
- LightFM: гибридная рекомендация по user/item metadata, полезна для cold start, но требует событий. https://github.com/lyst/lightfm
- implicit: ALS/BPR/nearest-neighbor по implicit feedback, нужен объём кликов/просмотров. https://github.com/benfred/implicit
- X algorithm: полезная архитектура candidates -> filtering -> scoring -> diversity -> selection. Берём идею pipeline, не тащим модель. https://github.com/xai-org/x-algorithm
- Hacker News/Reddit-style hot ranking: хороший MVP для новостной поверхности, где свежесть и score должны затухать по времени. Reference: https://www.righto.com/2009/06/how-does-newsyc-ranking-work.html

Вывод: сейчас делать прозрачный heuristic rank. ML оставить после сбора anonymous aggregate events.

## Candidate pool

For category page:

- `published = true`
- `quality_ok = true`
- `verified_live = true`
- `publish_status = live`
- article belongs to category:
  - `primary_category = category`
  - OR `secondary_categories` contains category
- window:
  - primary: last 7 days;
  - fallback: last 30 days if fewer than 4 candidates.

Limit candidate pool:

- fetch top 48 by `created_at desc` for freshness window;
- optionally fetch top 48 by `score desc` for strong older candidates;
- merge/dedupe server-side.

## Inputs

Use current fields:

- `score`
- `created_at`
- `pub_date`
- `source_name`
- `primary_category`
- `secondary_categories`
- `topics`
- `lead`
- `summary`
- `editorial_body`
- `card_teaser`
- `cover_image_url`
- `article_images`

No user-level fields in MVP.

## MVP formula

In `lib/interest-ranking.ts`:

```ts
interest =
  editorialScore * 1.0 +
  freshnessScore * 3.0 +
  sourceWeight +
  contentQualityBonus +
  mediaQualityBonus -
  duplicatePenalty
```

Where:

- `editorialScore = clamp(article.score, 0, 10)`
- `ageHours = now - max(pub_date, created_at)`
- `freshnessScore = exp(-ageHours / 48) * 10`
- `sourceWeight`:
  - +1.2 for trusted/top sources;
  - +0.6 for known stable sources;
  - 0 default.
- `contentQualityBonus`:
  - +0.5 if lead exists;
  - +0.5 if summary has 3+ bullets;
  - +0.5 if editorial_body length >= 1200;
  - +0.3 if card_teaser exists.
- `mediaQualityBonus`:
  - +0.3 if sanitized cover exists;
  - 0 if no media;
  - -0.5 if sanitizer rejected media for this article during ranking context.
- `duplicatePenalty`:
  - after initial scoring, enforce diversity during selection.

## Diversity selection

After sorting candidates by `interest desc`:

1. Select up to 4.
2. Prefer no more than 1 article per `source_name`.
3. Allow second article from same source only if candidate score gap is > 2.
4. Prefer at least 2 different primary/secondary categories if pool allows.
5. Do not show article already used as page hero if category page keeps featured first article.

## UI

Component: `src/components/InterestingArticles.tsx`

Placement:

- category pages: after category hero + `TopicTabs`, before fresh list;
- `/russia`: same pattern.

Layout:

- title: `Самое интересное`;
- 3-4 cards;
- use existing `ArticleCard` variants where possible;
- avoid nested cards;
- keep newsroom style, no marketing hero.

Fallback:

- if fewer than 3 viable candidates, hide the module;
- do not render empty placeholder.

## API/query design

Option A for MVP:

- `getInterestingArticlesByCategory(category, limit = 4)` in `lib/articles.ts`;
- fetch candidate pool from Supabase;
- rank in TypeScript using `rankInterestingArticles()`.

Option B later:

- materialized view or RPC with precomputed rank;
- useful only if category pages become slow.

MVP should use Option A unless build/runtime becomes too slow.

## Future event collection

Only after MVP:

- anonymous aggregate events, no user profile:
  - article impression;
  - article click;
  - dwell bucket;
  - category/day/source aggregate.
- store daily aggregates, not raw personal trails.
- use aggregates to tune source/content weights.

ML candidates later:

- LightFM if item metadata + implicit feedback is enough;
- implicit ALS/BPR if click matrix grows;
- TensorFlow Recommenders if full recommendation pipeline becomes justified.

## Tests

1. Newer medium-score article beats old high-score article only in fresh list, not necessarily in interesting block.
2. Interesting rank can pick older high-quality article if still within window.
3. Diversity prevents 4 cards from same source.
4. Hidden when fewer than 3 candidates.
5. Deterministic ordering with fixed `now`.

## Acceptance

- Section page has «Самое интересное» when enough content exists.
- Fresh list remains sorted by freshness.
- Ranking can be explained from formula and test fixtures.
- No personal tracking required.
