# Publication Checklist: ИИ-агенты в продажах

## Editorial

- [ ] Search intent answered in the first screen.
- [ ] Article has a clear practical result for the reader.
- [ ] No invented numbers, prices, product functions, or cases.
- [ ] Claims in `03-source-notes.md` are checked.
- [ ] Banned phrases from `docs/editorial_style_guide.md` removed.
- [ ] `Вывод Malakhov AI` is specific and useful.

## SEO

- [ ] Unique SEO title.
- [ ] Unique description.
- [ ] One H1.
- [ ] H2/H3 hierarchy is clean.
- [ ] Canonical path is `/guides/ii-agenty-v-prodazhah`.
- [ ] FAQ is visible if FAQ metadata exists.
- [ ] Internal links are relevant and not broken.
- [ ] Anti-cannibalization decision is documented.

## Images

- [ ] Cover WebP exists at `/public/images/guides/ii-agenty-v-prodazhah/cover.webp`.
- [ ] Cover has alt and caption in metadata.
- [ ] Inline images have alt and captions.
- [ ] Image files are local or approved external assets.
- [ ] No image API was used by this workflow.

## CTAs

- [ ] CTAs point only to real surfaces: `telegram-digest` (`@malakhovaidigest`), `contacts` (`malakhovai.ru/contacts`), `telegram-personal` (`@malakhovai`).
- [ ] No CTA promises a checklist, PDF, email guide or any artifact that does not actually exist.
- [ ] `inlineCtas` ≤ 2; `ctaCards` has exactly 3 entries (final block).

## Indexation

- [ ] `noindex: true` removed once `cover.webp` is in `public/images/guides/ii-agenty-v-prodazhah/` and `evergreen:check` is green.
- [ ] `npx tsx scripts/indexnow-batch.ts --apply` queued for post-deploy ping.

## Technical

- [ ] `content/guides/ii-agenty-v-prodazhah.md` exists for publication.
- [ ] `content/guides/meta/ii-agenty-v-prodazhah.json` exists and is valid JSON.
- [ ] `npm run evergreen:check -- --slug=ii-agenty-v-prodazhah` passes.
- [ ] `npm run docs:check` passes.
- [ ] `npm run build` passes.
- [ ] Sitemap will include the guide through `getAllGuides()`.
