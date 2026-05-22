# Codex Publication Task: Как выбрать первый ИИ-проект в бизнесе

## Mode

- Mode: `new`
- Slug: `kak-vybrat-pervyj-ii-proekt-v-biznese`
- Public URL: `/guides/kak-vybrat-pervyj-ii-proekt-v-biznese`

## Files Created

- Markdown: `content/guides/kak-vybrat-pervyj-ii-proekt-v-biznese.md` ✅
- Metadata: `content/guides/meta/kak-vybrat-pervyj-ii-proekt-v-biznese.json` ✅
- Images: `public/images/guides/kak-vybrat-pervyj-ii-proekt-v-biznese/*.webp` ✅ (placeholders)

## Publication Rules

- Canonical correct ✅
- Article + FAQPage + BreadcrumbList ✅
- FAQ совпадает с visible FAQ ✅
- Alt + caption на cover/inline ✅
- Internal links валидны ✅
- `noindex: true` пока нет cover ✅
- CTA на 3 разрешённых поверхностях ✅

## Checks

```bash
npm run evergreen:check -- --slug=kak-vybrat-pervyj-ii-proekt-v-biznese
npm run docs:check
npm run build
```

## Post-Publication Steps (Owner)

1. Cover в ChatGPT → `raw-images/cover.png`.
2. (Опц.) inline images.
3. `npm run images:prep -- --slug=kak-vybrat-pervyj-ii-proekt-v-biznese`.
4. `evergreen:check` → green.
5. `noindex: true` → `false`.
6. Push → Vercel deploy.
7. `npx tsx scripts/indexnow-batch.ts --apply`.
