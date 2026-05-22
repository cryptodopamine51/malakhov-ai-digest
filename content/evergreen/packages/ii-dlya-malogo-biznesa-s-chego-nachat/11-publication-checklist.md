# Publication Checklist: ИИ для малого бизнеса: с чего начать

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
- [ ] Canonical path is `/guides/ii-dlya-malogo-biznesa-s-chego-nachat`.
- [ ] FAQ is visible if FAQ metadata exists.
- [ ] Internal links are relevant and not broken.
- [ ] Anti-cannibalization decision is documented.

## Images

- [ ] Cover WebP exists at `/public/images/guides/ii-dlya-malogo-biznesa-s-chego-nachat/cover.webp`.
- [ ] Cover has alt and caption in metadata.
- [ ] Inline images have alt and captions.
- [ ] Image files are local or approved external assets.
- [ ] No image API was used by this workflow.

## Technical

- [ ] `content/guides/ii-dlya-malogo-biznesa-s-chego-nachat.md` exists for publication.
- [ ] `content/guides/meta/ii-dlya-malogo-biznesa-s-chego-nachat.json` exists and is valid JSON.
- [ ] `npm run evergreen:check -- --slug=ii-dlya-malogo-biznesa-s-chego-nachat` passes.
- [ ] `npm run docs:check` passes.
- [ ] `npm run build` passes.
- [ ] Sitemap will include the guide through `getAllGuides()`.
