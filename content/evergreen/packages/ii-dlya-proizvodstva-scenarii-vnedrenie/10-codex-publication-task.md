# Codex Publication Task: ИИ для производства: сценарии, внедрение и окупаемость

## Mode

- Publication mode: `create`
- Slug: `ii-dlya-proizvodstva-scenarii-vnedrenie`
- Public URL: `/guides/ii-dlya-proizvodstva-scenarii-vnedrenie`
- Current status: `published`
- Images: 4 PNG generated in ChatGPT through Chrome and processed by `images:prep`.
- Deployed: 2026-06-19 to `https://news.malakhovai.ru/guides/ii-dlya-proizvodstva-scenarii-vnedrenie`.
- IndexNow: sent 2026-06-19, status 200.

If this is an update package, update the existing guide. Do not create a duplicate page for the same intent.

## Files to Create or Update

- Markdown: `content/guides/ii-dlya-proizvodstva-scenarii-vnedrenie.md`
- Metadata: `content/guides/meta/ii-dlya-proizvodstva-scenarii-vnedrenie.json`
- Images: `public/images/guides/ii-dlya-proizvodstva-scenarii-vnedrenie/*.webp`

## Inputs

- Final article: `07-final-article.md`
- Metadata: `08-metadata.json`
- Image brief: `09-image-brief.md`
- Source notes: `03-source-notes.md`

## Publication Rules

- Keep canonical `https://news.malakhovai.ru/guides/ii-dlya-proizvodstva-scenarii-vnedrenie`.
- Preserve Article, FAQPage when FAQ is visible, and BreadcrumbList structured data.
- FAQ in metadata must match visible FAQ in Markdown.
- Cover and inline images must have alt and captions.
- Internal links must point only to existing local routes unless clearly marked future in the package, not in published Markdown.
- Do not use image generation API.
- `noindex: true` is a transient state: keep it only while guide WebP files are missing. As
  soon as the owner generates the cover, runs `npm run images:prep`, and `evergreen:check` is
  green — set `noindex: false` and submit IndexNow. No multi-day review window.
- CTAs may only point to: `telegram-digest` (`@malakhovaidigest`), `contacts`
  (`malakhovai.ru/contacts`), `telegram-personal` (`@iddopamine`). Never promise a checklist /
  PDF / email guide that does not actually exist.

## Checks

```bash
npm run evergreen:check -- --slug=ii-dlya-proizvodstva-scenarii-vnedrenie
npm run docs:check
npm run build
```

Manual browser checks before release:

- `/guides/ii-dlya-proizvodstva-scenarii-vnedrenie` returns 200 locally.
- Cover and inline images load.
- Mobile viewport has no overlap.
- Tables scroll on mobile.
- CTA points to a real surface (digest channel, contacts form, or personal Telegram) — no
  promised lead-magnet artifacts.
