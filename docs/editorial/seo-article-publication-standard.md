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

### Evergreen quality bar (mandatory for guides and manual long-form)

Beyond the news-article value rules, every evergreen guide must hit the following minimum bar
(enforced by `scripts/evergreen-check.ts` — `error` blocks, `warn` is non-blocking but visible):

- **Lead anchor.** First 700 chars after the H1 must contain a number, date or proper-noun
  acronym. Generic prose without an anchor triggers `lead_has_anchor` warn.
- **Visible `verifiedAt`.** Metadata must include `verifiedAt: <ISO date>`. The guide page renders
  «Актуальность проверена: <дата>» in the header. `verifiedAt` older than 180 days warns.
- **Numerical worked example (static only).** Guides with a numerical intent (cost, ROI, payback,
  metrics, comparisons) must include at least one expanded calculation in the body — not a category
  table. Template: situation → data → formula → result → takeaway. The example is rendered as
  Markdown text/list/table; do **not** build an interactive React calculator client component for
  evergreen guides. Owner decision 2026-05-22: keep guides as static pages, no client-only widgets.
- **Case block.** At least one H3 starting with «Кейс / Сценарий / Ситуация / Мини-кейс», or an
  inline paragraph marked «Редакционный пример». Editorial cases must carry that marker
  explicitly. Source hierarchy: public (McKinsey/BCG/Gartner/Habr/vc.ru/«Яков и Партнёры»/IDC/НИУ ВШЭ)
  → anonymized → editorial example.
- **Counter-strategy.** A dedicated H2 «Когда не стоит / не окупится / не подходит / когда не / Ошибки внедрения»
  with 3–5 concrete criteria. Generic «когда нет бюджета» is not enough — name the constraint
  (no process repeatability, no result owner, no SLA, regulator boundary, monthly process churn).
- **Russian context.** For business/agents/marketing clusters: mention 152-ФЗ when data, clients,
  HR or contracts are involved; GigaChat / YandexGPT as local alternatives for pricing comparisons;
  Яндекс.Директ / ВКонтакте / OK as local marketing surfaces.
- **No forbidden moves.** Do not link to unpublished guides, fabricate prices/cases/quotes,
  emit FAQPage without visible FAQ, use marketing-hype clichés («секрет успешного внедрения»,
  «3 шага к ИИ-трансформации», «прорыв»), or duplicate a markdown TOC when the page renders
  the sticky aside `«В статье»`.

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
- Use `noindex: true` in guide metadata **only as a transient state** between draft commit and
  cover readiness. Once the cover is present (`raw-images/cover.png` → `npm run images:prep` →
  WebP in `public/images/guides/<slug>/`) and `npm run evergreen:check -- --slug=<slug>` is green,
  remove `noindex` immediately and ping IndexNow via `npx tsx scripts/indexnow-batch.ts --apply`.
  Owner policy 2026-05-22: **no 3–7-day review window**. Editorial review happens on the draft
  PR before merge; indexation starts the moment the cover lands. Noindex guides must be excluded
  from public guide listings and sitemap until the flag is removed.

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

### Evergreen image workflow

Evergreen-guide images are produced **only through the ChatGPT subscription** (Plus / Pro / Codex).
No image API is called — neither OpenAI Images, nor Anthropic, nor any runtime generator. This is
a project-level policy; do not work around it.

### SEO filename convention (mandatory, owner decision 2026-05-22)

Image filenames are an SEO signal in image search. Final WebP filenames must follow this convention,
which is reflected in `08-metadata.json::cover.src` and `inlineImagesByHeading[*].src` **before**
the owner generates any PNG:

- **Cover**: `<slug>-cover.webp` (or `<primary-keyword>-<short-modifier>.webp` if the slug is
  longer than ~40 characters and the cover URL would otherwise exceed 60 characters).
- **Inline**: `<slug-short>-<section-keyword>.webp`, where `slug-short` is the first 2–4
  significant words of the guide slug and `section-keyword` is a short descriptor of the section
  content (e.g. `scenarii`, `plan-30-dney`, `matrica-vybora`, `kogda-ne-stoit`).
- ASCII only, lowercase, hyphen-separated, ≤ 60 characters total.
- Generic names (`cover.webp`, `image1.webp`, `diagram.webp`, `untitled.webp`) are forbidden —
  they lose the SEO signal. Existing guides published before 2026-05-22 that still use
  `cover.webp` etc. stay as-is to keep production URLs and OG-image references stable; new
  guides use the new convention from day 1.

### Workflow

1. Codex/agent fills `09-image-brief.md` (template
   `content/evergreen/templates/image-brief.template.md`): `prompt`, `negative_prompt`, `alt`,
   `caption`, `aspect`, `filename_png`, `filename_webp` for cover and every inline image —
   filenames following the SEO convention above.
2. Owner/editor opens ChatGPT, copies the prompt, generates a PNG. **PNG can be saved with any
   filename** (ChatGPT often outputs `ChatGPT_image_<timestamp>.png` or similar) — the only
   requirement is that all PNGs for one guide land in
   `content/evergreen/packages/<slug>/raw-images/`. No manual renaming required.
3. `npm run images:prep -- --slug=<slug>` (`scripts/images-prep.ts`) reads `raw-images/*.png`
   and runs a two-pass mapping against `08-metadata.json`:
   - **Pass 1 — exact stem match.** PNG files whose stem matches a meta slot stem are routed to
     that slot directly.
   - **Pass 2 — ordered fallback.** Remaining PNGs (random names) are matched in alphabetical
     order against unfilled meta slots in declared order (cover first, then inline images in
     `inlineImagesByHeading` order). Each rename is surfaced in the log as
     `renamed ← <random.png>`.
   The script then resizes (1200×675 cover, 1200×800 inline rect, 1200×1200 inline square) and
   writes WebP using `sharp` with **cover quality 90, inline quality 88, effort 6,
   smartSubsample=false** (full 4:4:4 chroma — important for graphic illustrations with thin
   lines and text-like detail). Quality bumped 2026-05-22 from previous q=82 which produced
   ~30 KB WebP outputs with visible compression artifacts. A PNG larger than 5 MB raises a warn.
4. `npm run evergreen:check -- --slug=<slug>` enforces metadata, cover size (≥ 50 KB) and image
   presence.

Local SVG / Canvas diagrams are allowed as inline replacements for matrices, 30/60/90 roadmaps,
pilot-vs-production comparisons and calculator visualisations. Covers always come from ChatGPT,
never from SVG.

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

### Russian market case white-list (internal, do not publicly enumerate)

Owner decision 2026-05-22: when an evergreen guide cites a Russian market fact, a case study, a
penetration rate or a regulatory point, pull it from one of the sources below. **The list itself
must not be published on the site or in `llms.txt`** — readers should keep a reason to ask us for
analysis instead of seeing the source kitchen. Attribute individual sources inline only when a
specific number/case is taken from them.

Tier 1 — trusted without caveats:

- **Яков и Партнёры** (`yakov.partners`) — strategic reports on AI / digital transformation, ex-McKinsey Russia methodology, not promotional.
- **НИУ ВШЭ ИСИЭЗ** (`issek.hse.ru`) — official digital-economy indicators and panel surveys.
- **TAdviser** (`tadviser.ru`) — largest catalog of Russian-company AI/IT implementation cases.
- **CNews Analytics** (`cnews.ru`) — 15+ years of Russian IT market analytics and rankings.

Tier 2 — primary sources for local models / platforms:

- **Sber / SberAI blog** (developers of GigaChat; first-party numbers for the model family).
- **Yandex Research** (`yandex.com/research`) — first-party for YandexGPT, YaLM, ML papers from the Yandex team.

Tier 3 — journalistic outlets with above-average fact-checking:

- **Forbes Russia** (`forbes.ru`) — cases of large-business AI implementation.
- **Ведомости.Технологии** (`vedomosti.ru/technology`) — business cases, market deals.

Use with caution (fact-check before citing):

- **Habr** — strong on technical cases, but check author karma and comments; opinions vs. real production numbers can blur.
- **vc.ru** — useful for business cases, but explicitly separate editorial pieces from sponsored / promotional posts (paid format clearly labeled).

Consciously excluded:

- **РБК Тренды** — case content frequently reads as paid promotion; not a primary source.
- **Коммерсант** — strong outlet but very few AI-specific cases; ad-hoc only.

Hierarchy when a fact is needed but no source exists in the white-list: drop the number and either
(a) reframe the claim qualitatively, (b) use an editorial example with the explicit marker
«Редакционный пример», or (c) leave the section without the fake-precision claim.

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

- Include 2-5 relevant internal links to categories, guides or important articles in the body
  (≥ 2 inline links to `/guides/...`, `/categories/<cat>` or `/russia`, not counting the
  related-block in metadata). `evergreen:check` warns when fewer than 2 inline links are found.
- Prefer links that help a reader continue the task, not links inserted only for SEO.
- Link to `/russia` and category pages when they are the right topical cluster.
- Do not link to unpublished guides as if they exist — `evergreen:check` blocks links to missing
  guide markdown via `forbidden_future_links`.
- CTA cap: ≤ 2 inline-CTAs (`inlineCtas`) + 1 final-CTA block with 3 cards (`ctaCards`).
  `evergreen:check` warns when `inlineCtas > 2` or total CTA > 5; the guide page also warns at
  build time when more than 2 inline CTAs are configured.
- **No lead-magnet promises.** CTAs must point only to assets that actually exist. Do not promise
  «получите чеклист в Telegram», «бесплатный PDF», «гайд на почту» or any artifact that is not
  produced and held ready. Allowed CTAs in the project today (owner decision 2026-05-22):
  - **«AI-новости в Telegram»** → `t.me/malakhovaidigest` (daily digest channel, real, indexed
    via `SITE_TELEGRAM_URL` / `Organization.sameAs`).
  - **«Архитектурный разбор ИИ»** / **«Оставить заявку»** → `malakhovai.ru/contacts`
    (consultation form, real). Topic-specific phrasing is welcome
    (`«Калькулятор проекта по ИИ» → contacts`, `«Проверьте бюджет до разработки» → contacts`).
  - **«Личный разговор» / «Написать в Telegram»** → `t.me/malakhovai` (personal Telegram).
  Default `ctaCards` for guides that do not override are defined in
  `app/guides/[slug]/page.tsx::DEFAULT_FINAL_CTA_CARDS` and use exactly these three slots.
- **Author card (`AuthorCard`).** `src/components/AuthorCard.tsx` is the shared author/funnel
  surface (owner decision 2026-06-01). It is not a lead-magnet — it links only to real assets:
  personal Telegram (`PERSONAL_TELEGRAM_URL` → `t.me/malakhovai`) and a consultation link.
  - Guides: visible byline (photo + name + «проверено <date>») in the header, plus `AuthorCard`
    at the end. Personal authorship is shown because guides are expert content.
  - News: a «Подготовлено редакцией Malakhov AI» line under the H1 (never sign pipeline-generated
    news as Ivan Malakhov personally) plus `AuthorCard` next to `TelegramCTA`.
  - The consultation button points to `/services` from guides/news, and straight to
    `malakhovai.ru/contacts` on `/services` itself (`consultationHref="contacts"`).
  - Channel digest (`@malakhovaidigest`) and personal Telegram (`@malakhovai`) are distinct
    buttons — keep them separate. Source of truth: `lib/site.ts`.
- **Consultation CTA on news** (owner decision 2026-06-01). News pages carry an accent block
  «Внедряю ИИ в бизнес — обсудим задачу» → `/services` (internal, with `utm_medium=article_cta`),
  plus a «Разобраться глубже» bridge to a topical guide (`lib/guide-bridge.ts`). These are real
  surfaces (services page + published guide), so they respect the no-lead-magnet rule.

Digest issue links are not mandatory because public digest issue pages do not exist in the current architecture.

## 15. Structured data requirements

Current implemented schema:

- root layout: `Organization` (with `sameAs` linking to public brand channels — see `lib/site.ts::SITE_SAME_AS`, and `founder: Person` referencing `/about#person`) and `WebSite` (with `potentialAction: SearchAction` pointing at `/search?q={search_term_string}`);
- news article: `NewsArticle` (with `abstract`, `wordCount`, `articleSection`, `inLanguage: 'ru'`, `author` Person linked to `/about#person`) + `BreadcrumbList` (Главная → категория → статья);
- news video: `VideoObject` inside `NewsArticle` when video exists;
- guide: `Article` with `author` Person (`@id: /about#person`, name «Иван Малахов», jobTitle «Editor, Malakhov AI Digest»), `wordCount` (computed from markdown at build), `articleSection: guide.category`, `keywords: guide.tags.join(', ')`, `inLanguage: 'ru-RU'`;
- guide FAQ: `FAQPage`;
- guide breadcrumbs: `BreadcrumbList`;
- category/russia pages: `CollectionPage`;
- `/sources`: `CollectionPage` with `mainEntity: ItemList` of source links;
- `/about`: `AboutPage` JSON-LD with `mainEntity: Person` (editor) — indexable surface with editorial policy and E-E-A-T signals; the Person record is also referenced from `NewsArticle.author` and `Organization.founder`;
- `/services`: `ProfessionalService` JSON-LD (`provider: Person` linked to `/about#person`, `offers: Offer` consultation, `areaServed: RU`) + `BreadcrumbList` (Главная → Услуги). Commercial landing surface; canonical `news.malakhovai.ru/services`;
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
- guide metadata is registered in `content/guides/meta/<slug>.json` (including `verifiedAt`; `caseSourcing` optional but recommended);
- content exists in `content/guides/<slug>.md`;
- lead has a factual anchor in the first sentence;
- the body has at least one expanded numerical worked example (for numerical intents);
- the body has at least one case block (public source / anonymized / editorial example with marker);
- the body has a counter-strategy H2 («когда не стоит / не окупится / Ошибки внедрения»);
- ≥ 2 inline internal links to `/guides`, `/categories`, `/russia` in the body;
- ≤ 2 inline-CTAs + 1 final CTA-block (3 cards);
- cover and inline images have alt text and cover file is ≥ 50 KB (regenerate via ChatGPT subscription or approved local workflow if smaller);
- JSON-LD matches visible content (author Person, wordCount, articleSection, keywords);
- internal links are relevant;
- mobile render is checked;
- `npm run evergreen:check -- --slug=<slug>` passes without errors;
- sitemap entry is expected.

`noindex: true` is a transient state for guides whose cover has not yet been generated in ChatGPT.
It is **not** a multi-day editorial review window — owner decision 2026-05-22 is that editorial
review happens on the draft PR before merge, and the moment the cover lands the guide goes live
and is submitted to IndexNow. Guides in `noindex` state are excluded from sitemap and the
`/guides` listing until the flag is removed.

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
- `/sources` `CollectionPage` + `ItemList`; `/about` `AboutPage` + editor `Person`; `/search` `SearchResultsPage`;
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
- additional `sameAs` channels (x.com, YouTube) once owner makes those public.
