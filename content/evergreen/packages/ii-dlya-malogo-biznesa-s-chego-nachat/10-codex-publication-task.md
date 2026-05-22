# Codex Publication Task: ИИ для малого бизнеса: с чего начать

## Mode

- Publication mode: `create`
- Slug: `ii-dlya-malogo-biznesa-s-chego-nachat`
- Public URL: `/guides/ii-dlya-malogo-biznesa-s-chego-nachat`

If this is an update package, update the existing guide. Do not create a duplicate page for the same intent.

## Files to Create or Update

- Markdown: `content/guides/ii-dlya-malogo-biznesa-s-chego-nachat.md`
- Metadata: `content/guides/meta/ii-dlya-malogo-biznesa-s-chego-nachat.json`
- Images: `public/images/guides/ii-dlya-malogo-biznesa-s-chego-nachat/*.webp`

## Inputs

- Final article: `07-final-article.md`
- Metadata: `08-metadata.json`
- Image brief: `09-image-brief.md`
- Source notes: `03-source-notes.md`

## Publication Rules

- Keep canonical `https://news.malakhovai.ru/guides/ii-dlya-malogo-biznesa-s-chego-nachat`.
- Preserve Article, FAQPage when FAQ is visible, and BreadcrumbList structured data.
- FAQ in metadata must match visible FAQ in Markdown.
- Cover and inline images must have alt and captions.
- Internal links must point only to existing local routes unless clearly marked future in the package, not in published Markdown.
- Do not use image generation API.

## Checks

```bash
npm run evergreen:check -- --slug=ii-dlya-malogo-biznesa-s-chego-nachat
npm run docs:check
npm run build
```

Manual browser checks before release:

- `/guides/ii-dlya-malogo-biznesa-s-chego-nachat` returns 200 locally.
- Cover and inline images load.
- Mobile viewport has no overlap.
- Tables scroll on mobile.
- CTA is not misleading for this topic.
