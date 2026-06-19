# Publication Checklist: ИИ для производства

## Editorial

- [x] Search intent answered in the first screen.
- [x] Article has a clear practical result for the reader.
- [x] No invented numbers, prices, product functions, or client cases.
- [x] Claims in `03-source-notes.md` are checked.
- [x] Banned phrases from `docs/editorial_style_guide.md` removed from final article and metadata.
- [x] `Вывод Malakhov AI` is specific and useful.

## SEO

- [x] Unique SEO title.
- [x] Unique description.
- [x] One H1.
- [x] H2/H3 hierarchy is clean.
- [x] Canonical path is `/guides/ii-dlya-proizvodstva-scenarii-vnedrenie`.
- [x] FAQ is visible in markdown and mirrored in metadata.
- [x] Internal links are relevant and not broken against existing guide files.
- [x] Anti-cannibalization decision is documented.

## Images

- [x] Cover canonical WebP exists at the path declared in `08-metadata.json`.
- [x] Every local guide image has `-480.webp` and `-768.webp` siblings.
- [x] Cover has alt and caption in metadata.
- [x] Inline images have alt and captions.
- [x] Image files are local planned assets only.
- [x] No image API was used by this workflow.

## CTAs

- [x] CTAs point only to real surfaces: `telegram-digest`, `contacts`, `telegram-personal`.
- [x] No CTA promises a checklist, PDF, email guide or any artifact that does not actually exist.
- [x] `inlineCtas` ≤ 2; `ctaCards` has exactly 3 entries.

## Indexation

- [x] `noindex: true` removed once guide images and responsive variants are in `public/images/guides/ii-dlya-proizvodstva-scenarii-vnedrenie/`.
- [x] `npx tsx scripts/indexnow-batch.ts --apply` completed after deploy.

## Technical

- [x] `content/guides/ii-dlya-proizvodstva-scenarii-vnedrenie.md` exists for publication.
- [x] `content/guides/meta/ii-dlya-proizvodstva-scenarii-vnedrenie.json` exists and is valid JSON.
- [x] `npm run images:prep -- --slug=ii-dlya-proizvodstva-scenarii-vnedrenie` passes after PNG are added.
- [x] `npm run evergreen:check -- --slug=ii-dlya-proizvodstva-scenarii-vnedrenie` passes after images exist.
- [x] `npm run docs:check` passes.
- [x] `npm run build` passes.
- [x] Local browser/curl smoke check passes.
- [x] Production deploy and post-deploy smoke check complete.
- [x] Sitemap includes the guide through `getAllGuides()`.
