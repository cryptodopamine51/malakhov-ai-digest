# File Map: Editorial Surface Quality 2026-05-12

> Parent task: `docs/task_editorial_surface_quality_2026-05-12.md`

## Source Of Truth To Read First

- `CLAUDE.md`
- `docs/INDEX.md`
- `docs/ARTICLE_SYSTEM.md`
- `docs/DESIGN.md`
- `docs/PROJECT.md`
- `docs/OPERATIONS.md`
- `docs/DECISIONS.md`

## Primary App Files

| File | Reason |
|---|---|
| `app/page.tsx` | Homepage hot story, recent headlines, all-news feed, hero subtitle. |
| `lib/articles.ts` | Homepage feed query, hot story query, related/recommendation data access. |
| `src/components/ArticleFeedList.tsx` | First featured article in `All news`. |
| `src/components/ArticleCard.tsx` | Card image selection, featured/related card UI. |
| `src/components/PulseList.tsx` | Fresh headlines block. |
| `src/components/TopicTabs.tsx` | Section order and chip pattern. |
| `src/components/Footer.tsx` | Footer copyright and copy cleanup. |
| `app/categories/[category]/[slug]/page.tsx` | Article render, inline images, recommendations, source footer, section navigation. |
| `app/globals.css` | Theme tokens and hero subtitle color. |
| `tailwind.config.ts` | Theme color token mapping if needed. |

## Media and Cover Pipeline

| File | Reason |
|---|---|
| `scripts/generate-ai-covers.ts` | Existing OpenAI Images cover script; add homepage-priority mode here. |
| `package.json` | Add convenience script if priority cover mode becomes a command. |
| `.github/workflows/ai-covers.yml` | Update only if priority mode becomes scheduled. |
| `lib/media-sanitizer.ts` | Usable-cover rules and render fallback behavior. |
| `pipeline/media-sanitizer.ts` | Re-export, usually no direct changes unless shared contract changes. |
| `pipeline/fetcher.ts` | Read only unless vc.ru/media investigation reveals extraction bug. |
| `pipeline/publish-verify.ts` | Only if vc.ru `publish_ready` article is actually stuck. |
| `pipeline/source-health.ts` | Only if source-health alert/follow-up path needs code. |

## Tests To Review Or Extend

| File | Reason |
|---|---|
| `tests/node/interest-ranking.test.ts` | Existing deterministic ranking tests. Extend for article recommendations if ranking helper changes. |
| `tests/node/media-sanitizer.test.ts` | Existing media safety tests. Extend only if sanitizer behavior changes. |
| `tests/node/pagination.test.ts` | Guard pagination behavior if homepage feed count/exclusion changes. |
| `tests/node/categories.test.ts` | Useful if section/category ordering or category helpers are reused. |
| New `tests/node/article-media-placement.test.ts` | Add if image slot selection is extracted. |
| New `tests/node/homepage-feed.test.ts` | Add if homepage exclusion logic is extracted into a pure helper. |
| New `tests/node/article-recommendations.test.ts` | Add if recommendation ranking/query helper can be tested without Supabase network. |

## Docs To Update During Implementation

| File | Required When |
|---|---|
| `docs/ARTICLE_SYSTEM.md` | Any change to article render, media policy, homepage feed behavior, recommendation selection, cover logic. |
| `docs/OPERATIONS.md` | Any change to scripts, GitHub workflows, cover generation commands, budgets, env, runtime checks. |
| `docs/DESIGN.md` | Hero subtitle contrast, recommendation layout, section chip navigation. |
| `docs/PROJECT.md` | If after-article section navigation is defined as a product entry point/surface. |
| `docs/DECISIONS.md` | If automatic medium-quality priority covers or recommendation strategy becomes a durable ADR. |

## Useful Local Commands

```bash
npm run context
rg -n "getArticlesFeed|getHotStoryOfTheDay|getRelatedArticles|interleaveBodyMedia|Все материалы переработаны|Переработано редакцией|hero-muted" app src lib docs
rg -n "gpt-image|image_cover_generation|ai-covers|quality=medium|daily-budget" scripts pipeline .github package.json docs
npm run docs:check
npx tsc --noEmit
npm run build
```

## Useful SQL Snippets

Homepage candidate sanity:

```sql
SELECT id, slug, ru_title, source_name, score, created_at, cover_image_url
FROM articles
WHERE published = true
  AND quality_ok = true
  AND verified_live = true
  AND publish_status = 'live'
ORDER BY created_at DESC, score DESC, id DESC
LIMIT 10;
```

vc.ru status:

```sql
SELECT source_name, ru_title, slug, publish_status, verified_live, quality_ok,
       created_at, publish_ready_at, verified_live_at, last_error_code, last_error
FROM articles
WHERE source_name ILIKE '%vc.ru%'
ORDER BY created_at DESC
LIMIT 20;
```

vc.ru source runs:

```sql
SELECT started_at, status, http_status, items_seen, items_new, items_duplicates,
       items_rejected_count, items_rejected_breakdown, error_message
FROM source_runs
WHERE source_name ILIKE '%vc.ru%'
ORDER BY started_at DESC
LIMIT 30;
```

Cover snapshot before priority apply:

```sql
CREATE TABLE articles_priority_cover_snapshot_20260512 AS
SELECT id, slug, cover_image_url
FROM articles
WHERE publish_status IN ('live', 'publish_ready')
ORDER BY created_at DESC
LIMIT 20;
```

## Risk Notes

- `scripts/generate-ai-covers.ts --apply` writes Supabase Storage and updates `articles.cover_image_url`; always dry-run first.
- Homepage duplicate fix changes query range semantics if exclusions are pushed into Supabase. Check page size and count behavior.
- Inline image changes should not weaken sanitizer. The render layer decides placement, not relevance.
- Do not include unrelated dirty files in commits.
