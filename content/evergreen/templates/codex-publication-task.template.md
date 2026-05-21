# Codex Publication Task: {{title}}

## Mode

- Publication mode: `{{mode}}`
- Slug: `{{slug}}`
- Public URL: `/guides/{{slug}}`

If this is an update package, update the existing guide. Do not create a duplicate page for the same intent.

## Files to Create or Update

- Markdown: `content/guides/{{slug}}.md`
- Metadata: `content/guides/meta/{{slug}}.json`
- Images: `public/images/guides/{{slug}}/*.webp`

## Inputs

- Final article: `07-final-article.md`
- Metadata: `08-metadata.json`
- Image brief: `09-image-brief.md`
- Source notes: `03-source-notes.md`

## Publication Rules

- Keep canonical `https://news.malakhovai.ru/guides/{{slug}}`.
- Preserve Article, FAQPage when FAQ is visible, and BreadcrumbList structured data.
- FAQ in metadata must match visible FAQ in Markdown.
- Cover and inline images must have alt and captions.
- Internal links must point only to existing local routes unless clearly marked future in the package, not in production Markdown.
- Do not use image generation API.

## Checks

```bash
npm run evergreen:check -- --slug={{slug}}
npm run docs:check
npm run build
```

Manual browser checks before release:

- `/guides/{{slug}}` returns 200 locally.
- Cover and inline images load.
- Mobile viewport has no overlap.
- Tables scroll on mobile.
- CTA is not misleading for this topic.

