# Codex Publication Task: Ошибки внедрения ИИ в компании

## Mode

- Publication mode: `new`
- Slug: `oshibki-vnedreniya-ii-v-kompanii`
- Public URL: `/guides/oshibki-vnedreniya-ii-v-kompanii`

## Files Created

- Markdown: `content/guides/oshibki-vnedreniya-ii-v-kompanii.md` ✅
- Metadata: `content/guides/meta/oshibki-vnedreniya-ii-v-kompanii.json` ✅
- Images: `public/images/guides/oshibki-vnedreniya-ii-v-kompanii/*.webp` ✅ (placeholders)

## Publication Rules

- Canonical correct ✅
- Article + FAQPage (visible) + BreadcrumbList ✅
- FAQ в meta совпадает с FAQ в Markdown ✅
- Cover + inline images имеют alt + caption ✅
- Internal links ведут на существующие routes ✅
- `noindex: true` — пока нет cover ✅
- CTA только на `telegram-digest` / `contacts` / `telegram-personal` ✅

## Checks

```bash
npm run evergreen:check -- --slug=oshibki-vnedreniya-ii-v-kompanii
npm run docs:check
npm run build
```

## Post-Publication Steps (Owner)

1. Cover в ChatGPT → `raw-images/cover.png`.
2. (Опц.) 3 inline images.
3. `npm run images:prep -- --slug=oshibki-vnedreniya-ii-v-kompanii`.
4. `npm run evergreen:check` → green без warnings.
5. `noindex: true` → `false` в meta.
6. Commit + push.
7. `npx tsx scripts/indexnow-batch.ts --apply`.
