# Task: Editorial Surface Quality 2026-05-12

> Date: 2026-05-12
> Status: ready for implementation
> Type: product + article render + media + operations task package
> Source: owner request in local Codex session on 2026-05-12.
> Control plane: `CLAUDE.md` was read and `npm run context` was run before this task package was created.

## Goal

Make the homepage, article pages, article recommendations, media rendering, source handling, and footer copy feel like a deliberate editorial product instead of an RSS aggregator.

The implementation must close all requested points in one coherent development wave:

1. The homepage hot story must not repeat as the first item in `All news`.
2. Priority homepage cards without a usable cover must receive an AI-generated cover through the existing background cover pipeline.
3. Article recommendations must stay fresh and relevant, not keep showing old static articles.
4. Article pages need a compact route to browse sections after recommendations.
5. vc.ru ingestion must be audited and any current publish issue must have a concrete resolution or follow-up.
6. Articles must not end with an image block, while still allowing more than 2-3 thematic images when the article length and content justify them.
7. Footer and article source footer must remove editorial-processing copy; footer year must be 2026 only.
8. The homepage hero subtitle must be readable in light and dark themes.

## Non-negotiable Project Constraints

- Public pages read materialized `articles` rows from Supabase. Do not generate content or images on public page requests.
- Do not use `legacy/` for new functionality.
- Article URLs stay canonical as `/categories/<primary_category>/<slug>`.
- Pipeline, media, article render, public surfaces, design, and operations changes require canonical doc updates in the same implementation PR.
- Use PR/Vercel flow for production. Do not manually copy files to production.

## Scope

### 1. Homepage duplicate removal

Current state:

- `app/page.tsx` excludes `hotStory.id` from `getRecentHeadlines()`.
- `getArticlesFeed()` does not accept exclusions, so the first featured item in `All news` can be the same article as `Main today`.

Required behavior:

- On page 1, `All news` excludes the current `hotStory.id`.
- Keep the existing fresh-feed ordering contract from `ADR-008`: `created_at desc`, then secondary tie-breakers.
- Pagination count may remain the count of all live articles, but implementation should avoid visible off-by-one weirdness on page 1. If total is adjusted for exclusions, document it.

Primary files:

- `app/page.tsx`
- `lib/articles.ts`
- `src/components/ArticleFeedList.tsx` only if a prop-level safeguard is needed.

### 2. Priority homepage AI covers

Current state:

- `scripts/generate-ai-covers.ts` generates OpenAI image covers and updates only `articles.cover_image_url`.
- Scheduled workflow runs low quality: `npm run covers:ai-low -- --category=all --latest-day --limit=12 --apply --daily-budget=1`.
- `docs/OPERATIONS.md` states default model is `gpt-image-1.5` because `gpt-image-2` requires verified organization; `medium` is allowed as manual override for important cards.

Required behavior:

- Add a priority mode to the existing cover generation path for homepage-visible cards:
  - `Main today` hot story;
  - first featured article in `All news` after hot story exclusion.
- If either article has no usable cover after sanitizer/card-cover rules, generate a cover through the background script.
- Priority mode must use the current project default model `gpt-image-1.5` and `quality=medium`, unless a separate access check confirms `gpt-image-2` is available.
- Keep budget cap and `llm_usage_logs` behavior.
- Do not generate on public requests.

Suggested interface:

```bash
npm run covers:ai-priority -- --homepage --apply --daily-budget=1
```

or extend the existing script:

```bash
npx tsx scripts/generate-ai-covers.ts --homepage --quality=medium --limit=2 --apply --daily-budget=1
```

Primary files:

- `scripts/generate-ai-covers.ts`
- `package.json`
- `.github/workflows/ai-covers.yml` if automatic priority execution is required
- `lib/articles.ts` if shared candidate selection is extracted
- `lib/media-sanitizer.ts` or `src/components/ArticleCard.tsx` if usable-cover classification must be shared

### 3. Article recommendations

Current state:

- Article page uses `getRelatedArticles(article.primary_category, article.id, 3)`.
- `getRelatedArticles()` sorts by `score desc` only, so older high-score articles can stay forever.
- Category pages already have deterministic freshness-aware ranking in `lib/interest-ranking.ts`.

Required behavior:

- Replace article-page recommendations with deterministic, freshness-aware recommendations.
- Use no personalization and no user tracking.
- Ranking should consider:
  - same primary category first;
  - shared secondary categories/topics where available;
  - freshness;
  - score;
  - source diversity;
  - media/content quality;
  - exclude current article.
- Primary candidate window: recent articles first, with fallback to wider window if fewer than minimum items.
- On desktop, render as a clean grid.
- On mobile, allow horizontal scroll with snap. The row should reveal that more cards exist, but must not use autoplay.

Primary files:

- `lib/articles.ts`
- `lib/interest-ranking.ts`
- `app/categories/[category]/[slug]/page.tsx`
- `src/components/ArticleCard.tsx`
- new optional component: `src/components/ArticleRecommendations.tsx`

### 4. Section navigation after recommendations

Required behavior:

- After article recommendations, show compact section navigation.
- Visual pattern: a row of topic chips/pills, not large cards.
- Current article primary category appears first and is visually active.
- Include the main sections in the same order as `TopicTabs`.
- Keep it compact and editorial. No marketing copy or explanatory paragraph.

Suggested label:

```text
Продолжить по разделам
```

Primary files:

- `app/categories/[category]/[slug]/page.tsx`
- `src/components/TopicTabs.tsx` or a small reusable section-nav component
- `docs/DESIGN.md`

### 5. Inline image placement: no image tail

Current state:

- `interleaveBodyMedia()` inserts one inline image after paragraph index 2.
- Then it appends all remaining images at the end:
  `while (imageIndex < images.length) result.push(renderInlineImage(... image-tail ...))`.
- This can make the article end with one or more images, which looks unprofessional.

Required behavior:

- Do not append leftover images as a tail.
- Do not impose a hard 2-3 image cap.
- Show as many relevant images as the article can support editorially.
- Images must be distributed inside the body with sensible spacing.
- The last rendered body block must not be an image. If no good internal slot exists, skip the extra image rather than placing it at the end.
- Tables and pull quotes must still render in predictable positions.

Suggested algorithm:

- Treat paragraph count as the main capacity signal.
- Keep a minimum spacing of about 3 paragraphs between inline images.
- Do not place an image after the final paragraph.
- For short articles, this naturally limits output.
- For long articles, allow more images: for example, every 4-5 paragraphs if images are available.
- Preserve sanitizer responsibility: image relevance is still determined before render by `sanitizeArticleImagesForRender()`.

Primary files:

- `app/categories/[category]/[slug]/page.tsx`
- `lib/media-sanitizer.ts` only if render reveals sanitizer gaps
- tests for media render helper, if helper is extracted

### 6. vc.ru audit and follow-up

Current finding on 2026-05-12:

- `vc.ru AI/стартапы` feed responds with HTTP 200 in recent `source_runs`.
- Recent runs show `items_seen=12`.
- There are two vc.ru articles in the last 30 days:
  - 2026-05-07, live and verified;
  - 2026-05-12, `publish_ready`, not yet `verified_live`.
- So the issue is no longer "vc.ru never produces articles"; it is low yield plus a current publish-ready follow-up.

Required behavior:

- Verify why the 2026-05-12 vc.ru article is still `publish_ready`.
- If it is simply waiting for the hourly `publish-verify` workflow, document that and confirm it transitions.
- If it is stuck, fix the publish verification or create a focused follow-up.
- Keep a source-health acceptance: if vc.ru produces no live articles for 7 days, surface a concrete alert/follow-up.

Primary files:

- `pipeline/publish-verify.ts` if stuck publish logic is confirmed
- `.github/workflows/publish-verify.yml` only if schedule/runtime is the problem
- `pipeline/source-health.ts` if alerting needs improvement
- `docs/ARTICLE_SYSTEM.md`
- `docs/OPERATIONS.md`

### 7. Footer and article source copy cleanup

Required behavior:

- Footer bottom line becomes:

```text
© 2026 news.malakhovai.ru
```

- Remove `Все материалы переработаны редакцией`.
- On article page, remove:

```text
· Переработано редакцией Malakhov AI Дайджест.
```

- Keep source attribution and outbound source link.

Primary files:

- `src/components/Footer.tsx`
- `app/categories/[category]/[slug]/page.tsx`

### 8. Hero subtitle contrast

Current state:

- Subtitle text exists, but it is visually too low-contrast or too easy to miss in the large bordered hero block.

Required behavior:

- Subtitle must be clearly readable in both light and dark themes.
- Keep the editorial minimal style.
- Avoid decorative hero redesign. This is a contrast and hierarchy fix.

Primary files:

- `app/page.tsx`
- `app/globals.css`
- `tailwind.config.ts` only if adding/updating token usage
- `docs/DESIGN.md`

## Required Canonical Doc Updates During Implementation

- `docs/ARTICLE_SYSTEM.md`
  - homepage `hotStory` exclusion from `All news`;
  - article recommendation selection;
  - inline image placement rule;
  - priority AI covers if article/media system behavior changes.
- `docs/OPERATIONS.md`
  - priority AI cover command/workflow, model/quality/budget, if implemented.
- `docs/DESIGN.md`
  - recommendation layout, section chips after articles, hero subtitle contrast.
- `docs/PROJECT.md`
  - update only if section navigation after article is treated as a new product surface/entry point.
- `docs/DECISIONS.md`
  - update only if a new architectural decision is made, for example automatic medium-quality priority cover workflow.

## Out of Scope

- No rewrite of the full article generation pipeline.
- No manual CMS workflow.
- No personalization/tracking for recommendations.
- No `legacy/` changes.
- No automatic migration to `gpt-image-2` unless access and pricing are explicitly validated.

## Verification Summary

Implementation is not complete until these pass:

```bash
npm run docs:check
npx tsc --noEmit
npm run build
npx tsx --test tests/node/interest-ranking.test.ts tests/node/media-sanitizer.test.ts tests/node/pagination.test.ts
```

Add or adjust tests for any new extracted helpers.

Docs impact for implementation: `ARTICLE_SYSTEM.md`, `OPERATIONS.md`, `DESIGN.md`, optionally `PROJECT.md` and `DECISIONS.md`.
