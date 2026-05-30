# Codex Publication Task: Сколько стоит внедрение ИИ в компанию

## Mode

- Publication mode: `create`.
- Slug: `skolko-stoit-vnedrenie-ii-v-kompaniyu`.
- Public URL: `/guides/skolko-stoit-vnedrenie-ii-v-kompaniyu`.
- Indexing: published with `noindex: false` after final image generation.

## Production Files

- Markdown: `content/guides/skolko-stoit-vnedrenie-ii-v-kompaniyu.md`
- Metadata: `content/guides/meta/skolko-stoit-vnedrenie-ii-v-kompaniyu.json`
- Images: `public/images/guides/skolko-stoit-vnedrenie-ii-v-kompaniyu/*.webp`

## Render Requirements

- Page must be accessible by direct URL.
- Page must be indexable after final image generation.
- Page may appear in `/guides`, homepage featured guide and sitemap after `noindex` is removed.
- Schema contract remains `Article`, `FAQPage` and `BreadcrumbList`.
- FAQ metadata must match visible FAQ.
- Related links only point to existing local routes.

## Checks

```bash
npm run evergreen:check -- --slug=skolko-stoit-vnedrenie-ii-v-kompaniyu
npm run docs:check
npm run build
```

Manual browser checks:

- `/guides/skolko-stoit-vnedrenie-ii-v-kompaniyu` returns 200.
- H1, cover and inline images render.
- `robots` meta does not contain noindex.
- JSON-LD includes `Article`, `FAQPage`, `BreadcrumbList`.
