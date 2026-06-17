# Task: responsive image delivery for VPN/mobile users

Date: 2026-06-17
Status: ready for implementation
Owner: Codex

## Goal

Make image-heavy pages on `news.malakhovai.ru` load fast on mobile and VPN connections while keeping editorial image quality high enough for covers, guide illustrations, article cards, and inline images.

Primary target: users in Russia often browse through VPN, where bandwidth and latency are materially worse. The site must avoid sending desktop-size images to mobile devices.

## Current Findings

Current project state:

- `scripts/images-prep.ts` already uses `sharp` to convert guide PNG assets into WebP.
- Guide images are generated as one canonical file per slot:
  - cover: `1200x675`
  - inline: usually `1200x800`
- `next.config.mjs` has `images.unoptimized: true`.
  - This is intentional: Vercel image optimization previously hit `OPTIMIZED_IMAGE_REQUEST_PAYMENT_REQUIRED` / `402` limits.
  - Consequence: `next/image` no longer gives us adaptive generated variants.
- Guide HTML currently emits a single WebP URL for each guide image, not a real local `srcset`.
- Article R2 covers already have a partial variant strategy (`-400`, `-800`, original) in several surfaces.
- Live guide image headers show Vercel CDN hits, but `cache-control` is currently `public, max-age=0, must-revalidate`, so browsers may revalidate often.

Measured new guide image weight:

| Guide | Images | Total KB | Max Single Image KB |
|---|---:|---:|---:|
| `ii-agenty-v-podderzhke-klientov` | 4 | 307 | 119 |
| `lokalnye-nejroseti-kak-zapustit-ii-na-svoem-kompyutere` | 4 | 391 | 110 |
| `nejroseti-dlya-marketinga-25-scenariev` | 4 | 451 | 179 |
| `perplexity-v-rossii-kak-polzovatsya-i-oplatit-pro` | 3 | 252 | 93 |
| `vibe-coding-chto-eto-i-kak-ispolzovat-predprinimatelyu` | 3 | 280 | 120 |
| `chatgpt-v-rossii-ustanovka-podpiska-plus-oplata` | 3 | 275 | 139 |

Conclusion: compression exists and is not broken, but delivery is not adaptive enough. The main win is responsive variants plus correct `srcset`/`sizes`, not just lowering WebP quality.

## Ready-Made Solutions Reviewed

### 1. `sharp`

Source:

- GitHub/npm: https://github.com/lovell/sharp
- Installed/current npm package checked: `sharp@0.35.1`
- License: Apache-2.0

Fit:

- Already installed in this repo.
- Already used by `scripts/images-prep.ts`.
- Fast, deterministic, works in Node scripts, supports WebP and AVIF.

Decision:

- Use as the core build-time image processor.
- Do not replace it.
- Extend the existing pipeline instead of adding another optimizer.

### 2. `@unpic/react`

Source:

- GitHub: https://github.com/ascorbic/unpic-img
- Docs: https://unpic.pics/img/react/
- Installed/current npm package checked: `@unpic/react@1.0.2`
- License: MIT

What it gives:

- A responsive `<img>` component.
- Generates `srcset`/`sizes` best-practice markup.
- Can use supported image CDNs directly, avoiding framework image optimizers.

Fit for us:

- Useful if we move guide/article images to a CDN with URL-based transformations, such as Cloudflare Images.
- Less useful for local static files in `public/images/guides`, because it cannot magically create local `-640/-768/-1200` files. We still need to generate those variants.

Decision:

- Do not add in phase 1.
- Keep as a phase 2 option if we enable Cloudflare Images transformations or standardize all images behind a supported CDN.

### 3. Cloudflare Images / Image Transformations with R2

Sources:

- Cloudflare Images overview: https://developers.cloudflare.com/images/
- Cloudflare Next.js integration: https://developers.cloudflare.com/images/optimization/transformations/integrate-with-frameworks/
- Cloudflare R2 + Image Resizing reference architecture: https://developers.cloudflare.com/reference-architecture/diagrams/content-delivery/optimizing-image-delivery-with-cloudflare-image-resizing-and-r2/

What it gives:

- Edge resizing and format negotiation.
- Can transform images stored on an origin including R2.
- Can integrate with Next via a custom image loader.

Fit for us:

- Strong fit for article/R2 image delivery if the account/product is enabled.
- Potentially the best long-term path for all editorial images.
- Requires Cloudflare configuration and possibly paid product limits. It is not a pure code-only drop-in.

Decision:

- Phase 2 candidate.
- Do not block phase 1 on Cloudflare product setup.
- Keep current R2 pre-generated variants for articles until Cloudflare Transformations are confirmed.

### 4. `next-image-export-optimizer`

Source:

- GitHub: https://github.com/Niels-IO/next-image-export-optimizer
- Installed/current npm package checked: `next-image-export-optimizer@1.20.1`
- License: MIT

What it gives:

- Optimizes images for Next static export workflows.
- Uses `sharp`.
- Generates responsive images and placeholders after export.

Fit for us:

- Our app is not a simple `next export` static site.
- We deploy Next on Vercel with SSG/ISR/dynamic routes and Supabase-backed article pages.
- Our guide image sources are content metadata strings, not primarily static imports.

Decision:

- Do not adopt.
- Good reference for ideas, but it would fight the current deployment model.

### 5. `responsive-loader`

Source:

- GitHub: https://github.com/dazuaz/responsive-loader
- Installed/current npm package checked: `responsive-loader@3.1.2`
- License: BSD-3-Clause

What it gives:

- Webpack loader that creates multiple images and returns `srcset`.

Fit for us:

- Works best when images are imported into JS/TS modules.
- Our guide images are content files referenced from JSON/Markdown metadata under `public/images/guides`.
- Next App Router + content-driven file names make loader integration awkward and brittle.

Decision:

- Do not adopt.

### 6. `image-minimizer-webpack-plugin`

Source:

- Docs: https://webpack.js.org/plugins/image-minimizer-webpack-plugin/
- Installed/current npm package checked: `image-minimizer-webpack-plugin@5.0.0`
- License: MIT

Fit for us:

- Good for webpack asset imports.
- Not ideal for content-managed guide images and R2 article images.
- Adds bundler complexity where a simple `sharp` script is easier to verify.

Decision:

- Do not adopt for phase 1.

### 7. `@squoosh/lib`

Source:

- GitHub/npm: https://github.com/GoogleChromeLabs/squoosh
- Installed/current npm package checked: `@squoosh/lib@0.5.3`
- License: Apache-2.0

Fit for us:

- Useful for experiments, but not needed.
- `sharp` is already installed, faster operationally, and enough for WebP/AVIF generation.

Decision:

- Do not adopt.

## Recommended Architecture

Use a small internal solution built on existing `sharp`:

1. Generate responsive static variants during `images:prep`.
2. Render guide images with native `srcset`.
3. Keep Vercel image optimizer disabled.
4. Reuse existing R2 variant helpers for article images.
5. Add image audit and validation gates.

This gives the main performance benefit without adding a new image service or a heavy bundler dependency.

## Implementation Plan

### Phase 1: Guide responsive variants

Update `scripts/images-prep.ts`:

- Keep canonical file:
  - `name.webp` at metadata dimensions (`1200x675` or `1200x800`)
- Generate responsive siblings:
  - `name-480.webp`
  - `name-768.webp`
  - optional `name-960.webp` only if visual QA shows tablet needs it

Suggested quality budgets:

| Variant | Use | Target Quality | Target Size |
|---|---|---:|---:|
| `480w` | small cards, very slow mobile | WebP q70-74 | <= 35 KB |
| `768w` | mobile full-width, high-DPI phones | WebP q76-80 | <= 70 KB |
| `960w` | tablet / narrow desktop if added | WebP q80-82 | <= 100 KB |
| canonical `1200w` cover | desktop cover, OG fallback | WebP q84-88 | <= 140 KB |
| canonical `1200w` inline | desktop inline | WebP q82-86 | <= 180 KB hard, <= 220 KB absolute max |

Notes:

- Current WebP quality (`cover=90`, `inline=88`) is visually good but can be reduced after screenshot comparison.
- Use `sharp.resize(width, height, { fit: 'cover', position: 'attention' })`.
- Keep `effort: 6`.
- Keep filenames SEO-friendly and stable.

### Phase 2: Responsive rendering component

Add `src/components/ResponsiveLocalImage.tsx` or guide-specific `GuideResponsiveImage`.

Responsibilities:

- Accept `src`, `alt`, `width`, `height`, `caption`, `priority`, `className`, `sizes`.
- Derive variant filenames:
  - `/path/name.webp`
  - `/path/name-480.webp`
  - `/path/name-768.webp`
  - `/path/name-960.webp` if present
- Render native HTML:
  - `<img src="name.webp" srcSet="name-480.webp 480w, name-768.webp 768w, name.webp 1200w" sizes="...">`
- Use:
  - `loading="lazy"` for inline images
  - eager/fetch priority for cover images
  - `decoding="async"`
  - explicit `width`/`height` to avoid CLS

Replace in `app/guides/[slug]/page.tsx`:

- guide cover `<Image>` -> responsive local image
- `GuideImageFigure` inline `<Image>` -> responsive local image

Important:

- Do not rely on `next/image` for guide images while `images.unoptimized: true`.
- Native `srcset` is the predictable path here.

### Phase 3: Cache headers

Update `next.config.mjs` headers for local guide images:

Option A, safer with current same-name overwrite workflow:

```txt
Cache-Control: public, max-age=604800, stale-while-revalidate=2592000
```

Option B, faster but requires content-versioned filenames:

```txt
Cache-Control: public, max-age=31536000, immutable
```

Recommendation:

- Use Option A first.
- Move to immutable only if the image workflow starts changing filenames when content changes.

### Phase 4: Article image audit

Audit these render surfaces:

- `app/categories/[category]/[slug]/page.tsx`
- `src/components/ArticleCard.tsx`
- `src/components/SafeImage.tsx`
- home page featured cards
- related article cards on guide pages

Required behavior:

- R2 images with existing `-400` / `-800` variants must render `srcset`.
- Local guide images must render generated local variants.
- External non-mirrored images should either:
  - be mirrored to R2, or
  - stay lazy and use conservative dimensions until mirrored.

### Phase 5: Validation gates

Extend `scripts/evergreen-check.ts`:

- Every referenced local guide WebP must have:
  - canonical file
  - `-480.webp`
  - `-768.webp`
- Dimensions must match expected widths/aspect ratio.
- Size budgets:
  - `480w <= 35 KB`
  - `768w <= 70 KB`
  - `1200w cover <= 140 KB`
  - `1200w inline <= 180 KB`, hard fail above `220 KB`
- Keep current descriptive filename guard.

Add tests:

- `readWebpDimensions` for variants.
- Variant filename derivation.
- `images:prep` writes all expected variants.
- `evergreen:check` fails when a variant is missing or oversized.

### Phase 6: Image audit command

Add script:

```json
"images:audit": "tsx scripts/images-audit.ts"
```

Audit output:

- top 30 heaviest local guide images
- per-guide total canonical image weight
- per-guide mobile expected image weight
- missing variants
- live URL header spot checks for cache-control

Optional:

- Add `--url=<page>` to fetch HTML and estimate the selected mobile/desktop image payload.

### Phase 7: Backfill all published guides

Run:

```bash
npm run images:prep -- --slug=<slug>
```

for every published guide that has local images.

Do not change canonical URLs unless replacing image content. Add only variant siblings.

### Phase 8: Verification

Run:

```bash
npm run evergreen:check -- --slug=<each published guide>
npx tsx --test tests/node/images-prep.test.ts tests/node/evergreen-quality-standard.test.ts
npm run build
```

Visual QA:

- `/`
- `/guides`
- heavy guide: `/guides/nejroseti-dlya-marketinga-25-scenariev`
- one article page with R2 cover
- mobile widths: 390, 430
- tablet width: 768
- desktop width: 1440

Network QA:

- On mobile viewport, guide cover should download `-768.webp` or smaller, not canonical `1200w`.
- Inline images should lazy-load only when approaching viewport.
- Full mobile guide image payload should target `180-260 KB`, not `300-450 KB`.

## Acceptance Criteria

- Mobile guide pages use responsive variants in HTML.
- Canonical guide image URLs remain valid.
- New variants exist for every published guide image.
- `evergreen:check` fails on missing/oversized variants.
- `npm run build` passes.
- Live `/images/guides/*` cache headers no longer force revalidation on every visit.
- Article cards and article pages use available R2 variants consistently.
- No visible quality regression in guide covers and inline images.
- No layout shift from image loading.

## Implementation Task Prompt

Use this prompt when executing:

```txt
Implement responsive image delivery for guides and article image surfaces.

Constraints:
- Preserve dirty worktree; do not revert unrelated changes.
- Keep `next.config.mjs images.unoptimized: true`.
- Do not add a new image optimization service in phase 1.
- Use existing `sharp` pipeline in `scripts/images-prep.ts`.
- Generate local variants `-480.webp` and `-768.webp` for guide images, keeping canonical WebP unchanged.
- Render guide images with native `srcset`/`sizes`.
- Add cache headers for `/images/guides/:path*`.
- Extend evergreen/image tests and checks.
- Backfill variants for all published guides.
- Run targeted tests and `npm run build`.
- Deploy only after live payload/header checks pass.
```

## Source Notes

- Next.js docs: `sizes` affects generated `srcset`; without correct sizing, browsers may download unnecessarily large images.
  - https://nextjs.org/docs/app/api-reference/components/image
- Next.js image optimization overview: built-in Image can serve correctly sized images, but our optimizer is intentionally disabled due Vercel quota behavior.
  - https://nextjs.org/docs/app/getting-started/images
- Unpic React: useful responsive image component for CDN-backed image URLs.
  - https://unpic.pics/img/react/
  - https://github.com/ascorbic/unpic-img
- next-image-export-optimizer: good for static export, not selected for this app architecture.
  - https://github.com/Niels-IO/next-image-export-optimizer
- responsive-loader: webpack import-time responsive image generation, not selected for content metadata images.
  - https://github.com/dazuaz/responsive-loader
- Cloudflare Images: good phase 2 option for R2/origin-backed transformations.
  - https://developers.cloudflare.com/images/
  - https://developers.cloudflare.com/images/optimization/transformations/integrate-with-frameworks/
  - https://developers.cloudflare.com/reference-architecture/diagrams/content-delivery/optimizing-image-delivery-with-cloudflare-image-resizing-and-r2/
- ImageMinimizerWebpackPlugin: useful for webpack image imports, not selected for content metadata images.
  - https://webpack.js.org/plugins/image-minimizer-webpack-plugin/
