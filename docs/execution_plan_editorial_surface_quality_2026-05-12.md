# Execution Plan: Editorial Surface Quality 2026-05-12

> Date: 2026-05-12
> Parent task: `docs/task_editorial_surface_quality_2026-05-12.md`
> Status: ready for implementation

## Pre-flight

1. Run `npm run context`.
2. Check `git status --short`.
3. Identify unrelated dirty files and do not include them in commits.
4. Confirm current production baseline:
   - homepage hot story slug;
   - first `All news` slug;
   - latest vc.ru article status;
   - article example that currently ends with an image.
5. Decide whether this implementation is one PR or several. Recommended split below.

## Recommended PR Split

### PR 1: Homepage and copy cleanup

Risk: low.

Scope:

- Add exclusion support to `getArticlesFeed()`.
- Pass `hotStory.id` from `app/page.tsx`.
- Remove footer/editorial-processing copy.
- Improve hero subtitle contrast.
- Update docs: `ARTICLE_SYSTEM.md`, `DESIGN.md`, maybe `PROJECT.md`.

Checks:

```bash
npm run docs:check
npx tsc --noEmit
npm run build
```

Manual smoke:

- Homepage: `Main today` and first `All news` are different.
- Footer shows only `© 2026 news.malakhovai.ru`.
- Article source footer shows source only.
- Hero subtitle readable in light/dark.

### PR 2: Article media placement

Risk: medium.

Scope:

- Extract image slot selection from `interleaveBodyMedia()` or make it locally testable.
- Remove image-tail behavior.
- Allow dynamic image count based on article length and spacing.
- Ensure last body block is never an image.
- Update `ARTICLE_SYSTEM.md`.

Suggested helper contract:

```ts
function selectInlineImageSlots(paragraphCount: number, imageCount: number): number[]
```

Expected behavior:

- `paragraphCount < 4` returns `[]` or at most one internal slot that is not after the final paragraph.
- Long article with many images can return several slots.
- No slot equals `paragraphCount - 1`.
- Slots are spaced by at least 3 paragraphs.

Checks:

```bash
npm run docs:check
npx tsc --noEmit
npm run build
```

Add focused node test if helper is extracted.

Manual smoke:

- Open the known Miro/AWS article.
- Verify no final image tail appears.
- Verify legitimate internal images still appear inside the article body.

### PR 3: Article recommendations and section navigation

Risk: medium.

Scope:

- Add `getArticleRecommendations()` or equivalent in `lib/articles.ts`.
- Reuse or extend `lib/interest-ranking.ts`.
- Replace article page `getRelatedArticles()` usage.
- Add mobile horizontal scroll and desktop grid.
- Add compact section chips after recommendations.
- Update `ARTICLE_SYSTEM.md`, `DESIGN.md`, and possibly `PROJECT.md`.

Recommendation rules:

- Exclude current article.
- Prefer same primary category and shared categories/topics.
- Use freshness first, with wider fallback.
- Limit source dominance.
- Hide block when fewer than minimum viable recommendations remain.

Checks:

```bash
npm run docs:check
npx tsx --test tests/node/interest-ranking.test.ts
npx tsc --noEmit
npm run build
```

Manual smoke:

- Article recommendations are not a static old set.
- Mobile layout scrolls horizontally.
- Desktop layout remains a grid.
- Section chips appear after recommendations and current category is highlighted.

### PR 4: Priority AI covers

Risk: medium-high because it can spend OpenAI budget and write to Supabase Storage.

Scope:

- Add homepage-priority candidate selection to `scripts/generate-ai-covers.ts`.
- Use `quality=medium` only for priority mode.
- Keep model default `gpt-image-1.5`.
- Keep budget cap and usage logs.
- Add package script if useful.
- Decide whether scheduled workflow calls this mode or it remains manual.
- Update `OPERATIONS.md`, `ARTICLE_SYSTEM.md`, and possibly `DECISIONS.md`.

Safe rollout:

1. Dry run:
   ```bash
   npx tsx scripts/generate-ai-covers.ts --homepage --quality=medium --limit=2
   ```
2. Review candidate list.
3. Apply only if candidates are correct:
   ```bash
   npx tsx scripts/generate-ai-covers.ts --homepage --quality=medium --limit=2 --apply --daily-budget=1
   ```
4. Verify `llm_usage_logs` and `articles.cover_image_url`.

Checks:

```bash
npm run docs:check
npx tsc --noEmit
npm run build
```

Manual smoke:

- Homepage-visible cards no longer show empty/template placeholders when priority cover was generated.
- No public route triggers image generation.

### PR 5: vc.ru publish/status follow-up

Risk: depends on findings.

Scope:

- Verify current `publish_ready` vc.ru article status.
- If normal delayed verification, document current state and close.
- If stuck, patch the narrow failure in `publish-verify` or workflow configuration.
- If low-yield monitoring needs improvement, add source-health follow-up or alert.
- Update `ARTICLE_SYSTEM.md` or `OPERATIONS.md` if behavior changes.

Checks:

```bash
npm run docs:check
npx tsc --noEmit
npm run build
```

If `publish-verify.ts` changes, add or run relevant publish verification tests.

## Final Wave Verification

Run:

```bash
npm run docs:check
npx tsc --noEmit
npm run build
npx tsx --test tests/node/interest-ranking.test.ts tests/node/media-sanitizer.test.ts tests/node/pagination.test.ts
```

Production smoke after deploy:

1. Homepage renders.
2. `Main today` is not repeated as first `All news`.
3. Hero subtitle is readable in light and dark.
4. Footer copy is clean.
5. Open known article with previous image tail. It does not end with an image.
6. Article recommendations render and section chips are visible.
7. vc.ru current status is understood and documented.

## Rollback Notes

- Homepage/render changes rollback through Vercel deployment rollback.
- AI cover writes update `articles.cover_image_url`; before any bulk apply, snapshot affected rows:

```sql
CREATE TABLE articles_priority_cover_snapshot_20260512 AS
SELECT id, slug, cover_image_url
FROM articles
WHERE publish_status IN ('live', 'publish_ready')
ORDER BY created_at DESC
LIMIT 20;
```

- Do not revert unrelated local changes.
