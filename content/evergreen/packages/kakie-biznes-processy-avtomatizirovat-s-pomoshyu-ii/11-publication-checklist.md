# Publication Checklist: Какие бизнес-процессы автоматизировать с помощью ИИ

## Editorial

- [x] Search intent answered in the first screen (матрица + 10 сценариев).
- [x] Article has a clear practical result.
- [x] No invented numbers, prices, product functions, or cases (всё в `03-source-notes.md`).
- [x] Claims in `03-source-notes.md` checked.
- [x] Banned phrases removed.
- [x] `Вывод Malakhov AI` is specific and useful.

## SEO

- [x] Unique SEO title.
- [x] Unique description.
- [x] One H1.
- [x] H2/H3 hierarchy is clean.
- [x] Canonical path: `/guides/kakie-biznes-processy-avtomatizirovat-s-pomoshyu-ii`.
- [x] FAQ visible (FAQPage emitted).
- [x] Internal links relevant.
- [x] Anti-cannibalization decision documented in `01-seo-brief.md`.

## Images

- [x] Cover WebP exists at `/public/images/guides/kakie-biznes-processy-avtomatizirovat-s-pomoshyu-ii/cover.webp` (placeholder).
- [x] Cover has alt and caption in metadata.
- [x] Inline images have alt and captions.
- [x] Image files are local (placeholders).
- [x] No image API used.

## CTAs

- [x] CTAs point only to real surfaces: `telegram-digest`, `contacts`, `telegram-personal`.
- [x] No CTA promises a checklist, PDF, email guide or any non-existing artifact.
- [x] `inlineCtas` = 2; `ctaCards` = 3.

## Indexation

- [ ] `noindex: true` removed once `cover.webp` is regenerated via ChatGPT and `evergreen:check` is green.
- [ ] `npx tsx scripts/indexnow-batch.ts --apply` queued for post-deploy ping.

## Technical

- [x] `content/guides/kakie-biznes-processy-avtomatizirovat-s-pomoshyu-ii.md` exists for publication.
- [x] `content/guides/meta/kakie-biznes-processy-avtomatizirovat-s-pomoshyu-ii.json` exists and is valid JSON.
- [x] `npm run evergreen:check -- --slug=kakie-biznes-processy-avtomatizirovat-s-pomoshyu-ii` passes (cover warn only).
- [x] `npm run docs:check` passes.
- [x] `npm run build` passes.
- [x] Sitemap will include the guide through `getAllGuides()` once `noindex` is removed.
