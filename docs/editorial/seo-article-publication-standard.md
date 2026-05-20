# SEO Article Publication Standard for Malakhov AI Digest

## 1. Purpose

Этот стандарт задает правила подготовки SEO-материалов Malakhov AI Digest перед публикацией.

Главная цель: не добавить абстрактный SEO-чеклист, а закрепить правила, совместимые с текущей архитектурой:

- news articles хранятся в Supabase table `articles`;
- canonical article URL строится как `/categories/<primary_category>/<slug>`;
- evergreen guides хранятся в `content/guides/`, а metadata задается JSON registry в `content/guides/meta/` и читается через `lib/guides.ts`;
- production canonical domain всегда `https://news.malakhovai.ru`.

## 2. Scope

Стандарт применяется к:

- новым и редактируемым evergreen-гайдам;
- ручным long-form материалам, если они добавляются в проект;
- существенным изменениям article render, metadata, sitemap, canonical, JSON-LD, image pipeline и internal linking;
- AI-generated news articles в части, которая уже поддержана pipeline.

Стандарт не требует ручного SERP/competitor анализа для каждой автоматической RSS-news статьи. Это конфликтовало бы с текущим cron-пайплайном.

## 3. Article types

**News article** - автоматическая статья из `articles`.

- Source: RSS item через `pipeline/ingest.ts`.
- Enrichment: `pipeline/claude.ts`, `pipeline/editorial-apply.ts`, `pipeline/enrich-submit-batch.ts`, `pipeline/enrich-collect-batch.ts`.
- URL: `getArticlePath(slug, primary_category)` from `lib/article-slugs.ts`.
- Page: `app/categories/[category]/[slug]/page.tsx`.
- Schema: `NewsArticle`.

**Evergreen guide** - ручной SEO-гайд.

- Content: `content/guides/<slug>.md`.
- Metadata: `content/guides/meta/<slug>.json`, loaded by `lib/guides.ts`.
- Page: `app/guides/[slug]/page.tsx`.
- Schema: `Article`, `FAQPage` when FAQ is visible, `BreadcrumbList`.

**Evergreen working package** - локальный редакционный пакет до публикации.

- Topic backlog: `content/evergreen/topics.json`.
- Package: `content/evergreen/packages/<slug>/`.
- Templates: `content/evergreen/templates/`.
- Scaffold: `npm run evergreen:new -- --topic-id=<id>`.
- Validator: `npm run evergreen:check -- --slug=<slug>`.
- Package is not public content until Markdown, metadata and images are moved to production guide paths.

**Listing / cluster page** - category, source, archive, home.

- Uses canonical metadata and article cards, but is not governed by the full article-writing brief.

## 4. Mandatory pre-writing SEO brief

Mandatory for evergreen guides and manual long-form materials.

Before writing, define:

- primary search query;
- 3-8 supporting queries;
- target reader and search intent;
- current page to update, if one exists;
- reason this deserves a new URL;
- unique Malakhov AI Digest value;
- planned URL slug;
- planned internal links;
- required image assets;
- source list and fact boundaries.

For automated news articles, the pipeline brief is the source article context:

- `original_url`;
- `original_title`;
- `source_name`;
- `source_lang`;
- `topics`;
- `primary_category`;
- `secondary_categories`;
- fetched article text, tables, images and videos.

Do not block RSS-news publishing because a manual SEO brief is absent.

## 5. Search intent and topic validation

For evergreen/manual materials, classify intent before writing:

- informational: explain a concept, process, market, tool, regulation or trend;
- practical: help the reader choose, implement or compare;
- news/context: explain why an event matters now;
- commercial-adjacent: answer business implementation questions without turning the text into sales copy.

The article must answer the query directly in the first screen: H1, lead and first section should make the topic unambiguous.

For news articles, the minimum intent is:

- what happened;
- who or what is involved;
- why it matters for AI industry, research, startups, investments, Russia or developers;
- what is known from the source and what remains unclear.

## 6. Anti-cannibalization check

Mandatory for evergreen/manual materials.

Before creating a new guide or long-form article:

- search `content/guides/`, `content/guides/meta/` and existing evergreen packages;
- search article/category docs when relevant;
- search current public article slugs in Supabase when env access is available;
- compare with sitemap/public URLs for important keywords;
- decide: create new, update existing, merge, or link internally.

If an existing evergreen page already targets the same query and intent, update that page instead of creating a duplicate.

For news articles, rely on `dedup_hash`, source freshness and canonical slug policy. Manual cannibalization checks are recommended only for planned explainers or repeated evergreen-like news themes.

## 7. Editorial value requirements

Every publishable article must add value beyond source translation.

Mandatory value elements:

- factual lead with a concrete anchor: company, product, number, date, model, institution or named method;
- clear explanation of why the item matters;
- no invented numbers, names, claims or quotes;
- no marketing hype;
- no ambiguous first-paragraph verbs like "закрыл", "остановил", "вышел из" without context;
- facts separated from interpretation when the topic is high-risk or uncertain.

Preferred Malakhov AI Digest angle:

- Russian-language context for an international AI story;
- practical consequence for developers, product teams, founders, investors or business readers;
- concise explanation of technical terms;
- connection to existing AI market, model or infrastructure trends.

Off-topic gate (applied before enrichment):

- An RSS item that matches the `OFF_TOPIC_KEYWORDS` blocklist in
  `pipeline/keyword-filters.ts` (Android Auto, AirPods, dishwasher, gaming chair, etc.) is rejected
  in `pipeline/rss-parser.ts` and never reaches Claude. The rejection reason is
  `off_topic_filter` in `source_runs.items_rejected_breakdown`.
- Broad tech feeds nominally tagged "AI" (ZDNet AI, Wired AI, CNet AI) must additionally pass
  the per-feed keyword filter (`needsKeywordFilter: true` + `EN_AI_CORE_KEYWORDS` on the title).

## 8. Article structure requirements

News article mandatory structure:

- one H1 from `ru_title`;
- lead, 1-2 sentences;
- summary block, 3-5 bullets;
- editorial body, 3+ paragraphs and normally 1200-5000 characters;
- source attribution;
- related articles and section navigation;
- compact CTA.

News articles normally do not require H2/H3/FAQ because the current render stores `editorial_body` as paragraph text.

Evergreen guide mandatory structure:

- one H1;
- strong lead that states the promise of the article;
- short summary or practical takeaway near the top;
- H2/H3 hierarchy;
- tables/lists only when they clarify real structure;
- conclusion or next-step section;
- FAQ when query demand supports it;
- related section links and CTA.

FAQ must be visible on the page if `FAQPage` JSON-LD is emitted.

## 9. Metadata requirements

Home page:

- Title: `AI новости на русском` (template appends `| Malakhov AI Дайджест` → ≤ 50 chars).
- Description: targets "AI новости на русском" + key category mix (релизы, исследования, стартапы, инвестиции, AI в России).
- Canonical: `/` (SITE_URL).
- Set via `app/page.tsx::metadata`.

News article:

- `ru_title` is both H1 and page title.
- `ru_title` target length: 20-90 characters.
- `card_teaser` is preferred meta description.
- `lead` is fallback meta description.
- `cover_image_url` or `/og-default.png` is used for social image.

Evergreen guide:

- `seoTitle` in `content/guides/meta/<slug>.json` is page title.
- `description` is meta description.
- `ogDescription` can be more social-oriented but must stay factual.
- `title` is H1 and can be longer/more editorial than `seoTitle`.

All metadata must avoid clickbait and unsupported promises.

## 10. URL and canonical requirements

Canonical domain:

- Always use `https://news.malakhovai.ru`.
- Do not use `malakhovai.ru` for news canonical, OG URL, RSS, sitemap or `llms.txt`.
- Do not read canonical domain from env for SEO artifacts.

News URL:

- Use `getArticlePath(slug, primary_category)`.
- Canonical path: `/categories/<primary_category>/<slug>`.
- Secondary categories do not change canonical.
- Legacy `/articles/<slug>` must remain redirect-only.

Guide URL:

- Use `/guides/<slug>`.
- Register guide metadata in `content/guides/meta/<slug>.json`.
- Add content in `content/guides/<slug>.md`.
- Use `noindex: true` in guide metadata only for direct-link production previews that need owner/editor review before indexing. Noindex guides must be excluded from public guide listings and sitemap until the flag is removed.

Slug requirements:

- ASCII only for news slugs.
- Human-readable.
- No random UUID/hex suffix in public URL.
- Collision suffixes like `-2`, `-3` are acceptable.
- Hard length cap: 75 chars (`pipeline/slug.ts::MAX_SLUG_LENGTH`). When the transliterated title
  exceeds the cap, the slug is cut at the last `-` (word boundary) so it never ends on a
  mid-root stub. Existing slugs are not retroactively re-cut.

## 11. Image and alt requirements

Mandatory:

- Every evergreen guide needs a local cover image.
- Guide cover target: 1200x675 WebP (16:9). News article cover renders at 1200×630 (1.91:1, Open Graph / Twitter Card standard); existing source covers downscale via `next/image` without stretching.
- Guide inline images must have descriptive `alt` and captions in `content/guides/meta/<slug>.json`.
- News articles use sanitized source/fallback media and must not render ads, author portraits, UI icons or promo images.
- `og:image` must resolve to a real image, the promoted inline image (see fallback chain), or `SITE_LOGO_URL` as the brand-level fallback.

Cover fallback chain (news articles, computed at render time):

1. `articles.cover_image_url` if it survives `sanitizeArticleMedia` in `lib/media-sanitizer.ts`.
2. If the cover was empty or rejected, the first sanitized inline image is promoted into the
   cover slot (`coverPromotedFromInline=true`). Sanitizer has already filtered out SVG icons,
   ad banners, promo blocks, author headshots and `<80px` images, so the first survivor is a
   safe "real" image.
3. If even that promotion fails, `og:image` falls back to `SITE_LOGO_URL` (a real branded asset,
   stronger social signal than a generic placeholder). `NewsArticle.image` and
   `NewsArticle.publisher.logo` use the same `SITE_LOGO_URL` rather than `/og-default.png`.

Recommended:

- Generated/local article covers should be 16:9 and text-free.
- File names for local/generated images should be readable and include the guide/article slug or topic.
- Use WebP for local/generated assets.

Allowed fallback:

- News source images can keep original external URLs when they pass sanitizer.
- Article cover alt may fall back to article title.

Future improvement:

- Separate 1:1 social image variant is not implemented yet.

## 12. Source and fact-checking requirements

Mandatory:

- Keep `original_url` and `source_name`.
- Attribute the source on the article page.
- Numbers, dates, funding amounts, benchmark scores, quotes and named claims must come from the source or a clearly identified verified context.
- If the source lacks enough facts, the material must not be stretched into fake depth.
- High-risk topics need extra caution: legal/regulation, medical, geopolitics, privacy, money/funding.

For AI-generated news, the validator and prompt are necessary but not sufficient for sensitive claims. When the topic is high-risk and the material is manual/evergreen, use human review before publication.

## 13. AI-generated content rules

AI-generated content may be used only under the project editorial contract:

- source-grounded writing;
- strict JSON output for news pipeline;
- deterministic validation through `validateEditorialDetailed()`;
- deterministic repair only for safe mechanical fixes;
- no fabricated facts;
- no banned phrases from `docs/editorial_style_guide.md` / `pipeline/claude.ts`;
- `AI` should be written as `ИИ` in Russian text except product/institution names;
- `quality_ok=false` means the material stays unpublished/draft.

For evergreen/manual materials, Claude/Codex may draft text, but the final page must pass the same factual and SEO checklist as human-written copy.

## 14. Internal linking requirements

News article:

- Target 3–5 meaningful `link_anchors` (hard minimum 2). Less than 2 anchors raises a validator
  warning (`link_anchors слишком мало`); more than 5 also warns. Publication is not blocked by
  the count gate so a genuinely thin story can still ship, but the signal is surfaced upstream.
- Anchor text must exist verbatim in `editorial_body`.
- Avoid generic anchors like "искусственный интеллект" or "языковые модели".
- Keep automatic recommendations after the article.
- Keep category breadcrumb and `ArticleSectionNav`.

Evergreen guide:

- Include 2-5 relevant internal links to categories, guides or important articles.
- Prefer links that help a reader continue the task, not links inserted only for SEO.
- Link to `/russia` and category pages when they are the right topical cluster.

Digest issue links are not mandatory because public digest issue pages do not exist in the current architecture.

## 15. Structured data requirements

Current implemented schema:

- root layout: `Organization` (with `sameAs` linking to public brand channels — see `lib/site.ts::SITE_SAME_AS`) and `WebSite` (with `potentialAction: SearchAction` pointing at `/search?q={search_term_string}`);
- news article: `NewsArticle` (with `abstract`, `wordCount`, `articleSection`, `inLanguage: 'ru'`) + `BreadcrumbList` (Главная → категория → статья);
- news video: `VideoObject` inside `NewsArticle` when video exists;
- guide: `Article`;
- guide FAQ: `FAQPage`;
- guide breadcrumbs: `BreadcrumbList`;
- category/russia pages: `CollectionPage`;
- `/sources`: `CollectionPage` with `mainEntity: ItemList` of source links;
- `/about`: `AboutPage` JSON-LD; indexable surface with editorial policy and E-E-A-T signals;
- search results (`/search`): `SearchResultsPage` (the page itself is `noindex, follow`);
- `/archive/<date>`: `noindex, follow` (no JSON-LD — thin navigational surface).

Rules:

- Do not emit FAQPage unless FAQ is visible to users.
- Use `datePublished` and `dateModified`.
- Author/publisher is organization-level unless a personal author model is added.
- Schema URL must match canonical URL.
- Image in schema must match available cover or fallback image.

Future improvement:

- Align all publisher logo references with `SITE_LOGO_URL` where practical. ✅ Implemented for news articles in 2026-05-21 wave.
- Add article-level BreadcrumbList for news if needed. ✅ Implemented in 2026-05-21 wave.

## 16. Technical SEO checklist

Mandatory for article/guide template changes:

- canonical uses `SITE_URL` / `absoluteUrl()` correctly;
- page metadata has title and description;
- Open Graph URL equals canonical URL;
- Twitter card is `summary_large_image` for article/guide pages;
- public pages are indexable unless explicitly internal/demo/legal exception;
- `/demo/`, `/internal/`, `/api/`, `/_next/` stay blocked by robots;
- sitemap includes only public canonical URLs;
- sitemap has ISR when it reads from DB;
- a Google News sitemap (`/news-sitemap.xml`) ships alongside the main sitemap, covers articles published within the last 48h, capped at 1000 URLs, and is referenced from `robots.txt`;
- `robots.txt` lists explicit allow-rules for LLM-side crawlers (GPTBot, ChatGPT-User, OAI-SearchBot, Google-Extended, ClaudeBot, anthropic-ai, claude-web, PerplexityBot, CCBot, Applebot-Extended, DuckAssistBot, MistralAI-User, cohere-ai) alongside the wildcard `*` rule. The `/demo/`, `/internal/`, `/api/`, `/_next/` blocks are repeated on each named rule. Adding Bytespider/Amazonbot is an owner decision (not in the default list);
- RSS, `llms.txt` and the full markdown dump `/llms-full.txt` (top 100 articles + all evergreen guides in full form, ISR 1h, capped at 5 MB) all use `news.malakhovai.ru`;
- legacy article/topic routes redirect instead of duplicating content;
- `publish-verify` remains the path from `publish_ready` to `live`;
- IndexNow remains soft-fail and must not block publication.

Listing pages (home, `/russia`, `/categories/<category>`) must stay cacheable on the Vercel CDN:

- do not read `searchParams`, `cookies()` or `headers()` on the server for these surfaces;
- keep `export const revalidate = 300` and ensure `npm run build` shows `○ Static` or `● SSG`, not `ƒ Dynamic`;
- pagination is client-side Load more (`HomeFeedList` for the home page, `CategoryArticleList` for category pages and `/russia`) backed by JSON endpoints `/api/feed` and `/api/categories/<category>/articles`;
- after deploy `curl -sI https://news.malakhovai.ru/` must show a public `cache-control` and `x-vercel-cache: HIT` on a repeat request. See `docs/OPERATIONS.md → Rendering policy`.

Manual checks for important evergreen/manual releases:

- page returns 200;
- canonical URL returns 200;
- old/legacy URL redirects if relevant;
- cover and `og:image` load;
- mobile viewport has no overlapping title, image or CTA;
- no broken internal links.

## 17. Publication readiness checklist

News article is publishable only when:

- `quality_ok=true`;
- `enrich_status='enriched_ok'`;
- `publish_status` reaches `live` through publish verification;
- `verified_live=true`;
- `published=true`;
- `slug` exists and is valid;
- `primary_category` exists;
- title, lead, summary, card teaser and editorial body are present;
- source attribution exists;
- canonical URL is `/categories/<primary_category>/<slug>`;
- sitemap can include the URL after live status.

Evergreen/manual article is publishable only when:

- SEO brief is complete;
- cannibalization check is done;
- title and meta description are unique and factual;
- slug is human-readable;
- guide metadata is registered in `content/guides/meta/<slug>.json`;
- content exists in `content/guides/<slug>.md`;
- cover and inline images have alt text;
- JSON-LD matches visible content;
- internal links are relevant;
- mobile render is checked;
- sitemap entry is expected.

For a temporary review link, the guide may be available on the production route with `noindex: true`.
In that state it is not considered fully indexable/published: it should not appear in sitemap or public
guide listings until editorial review is complete and `noindex` is removed.

## 18. Post-publication checks

Automatic:

- `publish-verify` checks live article URL and promotes to `live`.
- Sitemap updates through ISR.
- IndexNow pings Yandex/Bing when `INDEXNOW_KEY` is configured.

Manual for important evergreen/manual articles:

- submit or inspect sitemap in Google Search Console;
- inspect URL in Yandex Webmaster when needed;
- check indexing after 24-72 hours;
- check impressions/CTR after 7-14 days;
- update title/description only if data shows mismatch with intent;
- review evergreen guides at least quarterly or when major AI market facts change.

## 19. What is already implemented in the project

Already implemented:

- `SITE_URL = https://news.malakhovai.ru` in `lib/site.ts`;
- article canonical URLs under `/categories/<primary_category>/<slug>`;
- redirects from legacy `/articles/<slug>` and `/topics/<topic>`;
- article metadata: title, description, canonical, Open Graph, Twitter;
- file-based guide metadata registry and local guide image model;
- `NewsArticle` (with `abstract`, `wordCount`, `articleSection`, `inLanguage: 'ru'`) + article-level `BreadcrumbList`; guide `Article`, guide `FAQPage`; root `Organization` (with `sameAs` to brand channels) + `WebSite` (with `potentialAction: SearchAction`);
- `/sources` `CollectionPage` + `ItemList`; `/about` `AboutPage`; `/search` `SearchResultsPage`;
- sitemap with live articles, guides and static routes (including `/about`);
- sitemap ISR every 30 minutes; Google News sitemap at `/news-sitemap.xml` (ISR 10 min, 48h window, ≤1000 URLs);
- robots rules for public/internal/demo/API surfaces; explicit allow-list for 13 LLM bots (GPTBot, ClaudeBot, PerplexityBot, Google-Extended, …);
- listing pages (home, `/russia`, `/categories/<cat>`) are cacheable on the Vercel CDN — no server-side `searchParams`; pagination is client-side Load more (`/api/feed`, `/api/categories/<cat>/articles`);
- RSS, `llms.txt` (with cluster map + guides + machine entry points) and `/llms-full.txt` (top 100 articles + all guides in full Markdown, ISR 1h, capped at 5 MB);
- WebSite SearchAction + `/search` page (force-dynamic, noindex/follow);
- media sanitizer for source images, with runtime cover fallback (promotes the first sanitized inline image into the cover slot when source cover is empty/rejected) and `SITE_LOGO_URL` brand-fallback for `og:image` / `NewsArticle.image` / `NewsArticle.publisher.logo`;
- article cover renders at 1200×630 (Open Graph / Twitter Card standard);
- editorial prompt, validator, repair and quality gate; link_anchors target 3–5 with a soft 2-anchor warning gate;
- off-topic blocklist (`OFF_TOPIC_KEYWORDS`) applied to every RSS feed before per-feed keyword filter; ZDNet AI / Wired AI require `EN_AI_CORE_KEYWORDS` on the title;
- slug length cap 75 with word-boundary cut (`pipeline/slug.ts::capSlugAtWordBoundary`);
- publish readiness statuses and `publish-verify`;
- IndexNow ping for newly verified live articles + post-deploy batch (`scripts/indexnow-batch.ts`);
- related articles, category links and Telegram CTA.

## 20. What is planned for later

Future improvements, not mandatory for the current standard:

- separate SEO title field for news articles;
- primary/additional keyword fields in a dedicated editorial metadata layer;
- automatic cannibalization report against live Supabase articles;
- SERP competitor notes stored with evergreen briefs;
- 1:1 social image variant;
- canonical URL-aware rewrite of `scripts/check-links.ts`;
- automated mobile screenshot smoke for article/guide templates;
- Search Console / Yandex Webmaster API integration;
- scheduled evergreen review workflow;
- public digest issue pages, if the product adds them later;
- Person-author swap for `NewsArticle.author` (replace Organization with an editor `Person` linked to `/about`) — pending owner publishing a public editor bio;
- additional `sameAs` channels (x.com, YouTube) once owner makes those public.
