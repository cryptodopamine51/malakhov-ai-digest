# Baseline: Editorial Surface Quality 2026-05-12

> Captured during task packaging on 2026-05-12.
> This file records observed state before implementation. It is not a canonical source of truth.

## Local Repository State

At the time this package was created, the working tree already had unrelated modified files:

```text
M docs/OPERATIONS.md
M lib/ops-summary.ts
M tests/node/ops-summary.test.ts
```

Implementation must avoid reverting or accidentally staging those unless the owner confirms they are part of the same task.

## Homepage Duplicate

Observed from code and production HTML:

- `app/page.tsx` calls `getHotStoryOfTheDay()`.
- It excludes `hotStory.id` from `getRecentHeadlines()`.
- It does not exclude `hotStory.id` from `getArticlesFeed()`.
- Production HTML showed the same AWS/Hugging Face article in `Главное сегодня` and as the first featured card in `Все новости`.

Relevant files:

- `app/page.tsx`
- `lib/articles.ts`
- `src/components/ArticleFeedList.tsx`

## Inline Image Tail

Observed from code:

- `app/categories/[category]/[slug]/page.tsx` appends leftover images after all paragraphs:

```ts
while (imageIndex < images.length) {
  result.push(renderInlineImage(images[imageIndex], sourceName, title, `image-tail-${imageIndex}`))
  imageIndex++
}
```

This directly explains article pages that end with images.

Important nuance:

- The desired fix is not a hard limit of 2-3 images.
- Long articles may show more images if they are thematic and can be placed inside the body with editorial spacing.

## AI Covers

Current documented behavior:

- `scripts/generate-ai-covers.ts` default model: `gpt-image-1.5`.
- Scheduled workflow: `.github/workflows/ai-covers.yml`.
- Automatic scheduled path uses low quality with daily budget cap.
- `docs/OPERATIONS.md` says `medium` is a manual override for important cards.

Implication:

- Priority homepage medium covers should build on the existing script, not introduce public-request generation.

## vc.ru

Observed through Supabase query on 2026-05-12:

- `source_runs` for `vc.ru AI/стартапы` return HTTP 200.
- Recent runs usually show `items_seen=12`.
- Last 30 days had 2 vc.ru articles:
  - `mask-predlagal-altmanu-mesto-v-sovete-tesla-v-obmen-na-poglo`, live and verified;
  - `digg-perezapushchen-kak-agregator-novostey-ob-ii-na-osnove-x`, `publish_ready`, not verified at query time.

Interpretation:

- vc.ru is no longer a complete ingestion failure.
- Current work should focus on low yield and whether the latest `publish_ready` item transitions normally or is stuck.

## Copy Cleanup Targets

Search targets:

```text
src/components/Footer.tsx: © 2024–2026 news.malakhovai.ru
src/components/Footer.tsx: Все материалы переработаны редакцией
app/categories/[category]/[slug]/page.tsx: Переработано редакцией Malakhov AI Дайджест
```

Desired:

```text
© 2026 news.malakhovai.ru
```

Article footer keeps source attribution and source link only.

## Hero Subtitle

Current token:

```css
--hero-muted: #4f5f70;
[data-theme="dark"] --hero-muted: #c2c8cf;
```

Observed owner issue:

- Subtitle is present in HTML but visually too weak in the hero block.

Implementation should improve contrast/hierarchy without redesigning the hero.

## Existing Project Docs That Matter

- `CLAUDE.md`: context and docs-update rules.
- `docs/ARTICLE_SYSTEM.md`: article/media/homepage related surfaces.
- `docs/DESIGN.md`: hero, TopicTabs, homepage day block, article UI.
- `docs/OPERATIONS.md`: AI cover workflow and budgets.
- `docs/PROJECT.md`: product surfaces and required product behavior.
