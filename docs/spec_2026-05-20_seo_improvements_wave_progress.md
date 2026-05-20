# SEO Improvements Wave — Session Progress Journal

> Подробный отчёт по итерациям. Краткие строки — в `spec_2026-05-20_seo_improvements_wave.md` §8.
> Этот файл — рабочий журнал сессии, не канон. После закрытия волны итоги переносятся в канонические доки.

---

## Iteration 0.1 + 0.2 — Pre-flight (closed)

**Commit**: `93468ec`.

**What was done**:
- Spec approved by owner (verbal "запусти").
- Production snapshot captured:
  - Cache headers on `/`, `/russia`, `/categories/ai-industry` → all `private, no-cache, no-store / MISS`.
  - Sitemap = 1012 `<loc>` entries.
  - Robots.txt has explicit allow for only `OAI-SearchBot`, `Googlebot`, `Bingbot` (3 bots).
  - Supabase counts: `liveTotal=1100`, `liveNoCover=3`, `liveDefaultCover=0`.
  - BreadcrumbList JSON-LD on article pages: missing.
  - `/news-sitemap.xml`, `/llms-full.txt`, `/about`: missing.

**Findings**:
- Spec §4.2 said "20% свежих статей с og-default" — but DB shows 0 live articles with `cover_image_url ILIKE '%og-default%'`. Previous backfill 2026-05-07 (`articles_cover_snapshot_20260507`) already cleaned this. Only 3 articles remain with `cover_image_url IS NULL`. This significantly reduces scope of phase 6.1/6.3.

---

## Iteration 1.1 — ISR cache on listing pages (closed)

**Commit**: `b16279e`.

**Root cause discovered (different from spec)**:
- Spec assumed `revalidate = 300` was missing. It was already present in all three files.
- Real cause: `await searchParams` in Next.js 15 forces Dynamic rendering, which overrides ISR. ConsentManager and Header are client components — not the source.

**Changes**:
- `app/page.tsx` — removed `searchParams`, page 1 only on server.
- `app/russia/page.tsx` — removed `searchParams` (CategoryArticleList already client-side).
- `app/categories/[category]/page.tsx` — removed `searchParams`.
- New: `app/api/feed/route.ts` — JSON endpoint for client-side Load-more on the home page.
- New: `src/components/HomeFeedList.tsx` — client component with Load-more button.

**No 301 redirects for `?page=N`** — canonical on paginated URLs already points at base, so no SEO regression. Decision logged in spec.

**Build verification**:
- Before: `/`, `/russia`, `/categories/[category]` = `ƒ Dynamic`.
- After: `/`, `/russia` = `○ Static`, `/categories/[category]` = `● SSG`. All three: `revalidate=5m, expire=1y`.

**Acceptance pending**:
- Live cache-control verification — after deploy/promote.

**Docs updated**:
- `docs/OPERATIONS.md` — added "Rendering policy" section.
- `docs/editorial/seo-article-publication-standard.md` §16 — added "Listing pages must stay cacheable on the Vercel CDN" block.
- This was the first commit that put `seo-article-publication-standard.md` into git (it was previously untracked in the working tree despite being listed as canonical in `CLAUDE.md`).

---

## Iteration 1.2 — Off-topic filter (closed)

**Files changed**:
- `pipeline/keyword-filters.ts` — added `OFF_TOPIC_KEYWORDS` (30+ items).
- `pipeline/rss-parser.ts` — applies `OFF_TOPIC_KEYWORDS` to every feed before per-feed
  `needsKeywordFilter`; new `off_topic_filter` reason in the `RssRejectedReason` union.
- `pipeline/feeds.config.ts` — `ZDNet AI` and `Wired AI` now have `needsKeywordFilter: true`,
  `keywords: EN_AI_CORE_KEYWORDS`, `keywordSearchFields: 'title'`.
- `tests/node/rss-parser-rejected.test.ts` — new test: an "Android Auto" item from ZDNet AI
  is rejected via `off_topic_filter` while a sibling OpenAI-tagged item passes through. All
  7 tests in the file pass.

**Decisions diverging from spec**:
- Did NOT raise `DEFAULT_MIN_SCORE_FOR_CLAUDE` for ZDNet/Wired/vc.ru.
  - Reasoning: a per-source score-bar is a blunt instrument compared with the topic-level
    blocklist plus per-feed keyword filter, and `ai-research` is already at 4. Tuning the
    score-bar without observability into actual rejected items would risk over-dropping good
    industry stories.
  - If post-deploy `source_runs.items_rejected_breakdown.off_topic_filter` shows we still
    leak gadget content, the cheaper next step is to extend `OFF_TOPIC_KEYWORDS` rather than
    bump the score threshold.
- Did NOT add `article_attempts.stage='off_topic_filter'` logging.
  - Reasoning: `article_attempts` is created downstream from rss-parser (in ingest after a
    candidate becomes a Supabase row). At parser level we have a stricter equivalent —
    `source_runs.items_rejected_breakdown.off_topic_filter` — which the existing
    `buildSourceRejectedStats` aggregator already handles without changes. Adding a parallel
    stage to `article_attempts` would duplicate the signal.

**Coverage**:
- Off-topic gate runs for ALL feeds (regardless of `needsKeywordFilter`). Russian feeds
  (vc.ru, CNews, RB.ru) already had keyword filters, but they now also benefit from the
  global blocklist if a non-Russian off-topic term ever leaks through.

**Build/test verification**:
- `npx tsx --test tests/node/rss-parser-rejected.test.ts` → 7/7 pass.
- Full build deferred to iteration 5.1 to avoid recompile per iteration (build takes ~3 min).

**Docs updated**:
- `docs/ARTICLE_SYSTEM.md` — extended `Sources and feed filters` with the off-topic blocklist
  and the ZDNet/Wired tightening note.
- `docs/editorial/seo-article-publication-standard.md` §7 — added "Off-topic gate" block.
