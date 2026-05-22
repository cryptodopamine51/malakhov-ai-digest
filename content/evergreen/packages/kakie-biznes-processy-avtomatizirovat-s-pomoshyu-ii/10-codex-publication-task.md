# Codex Publication Task: Какие бизнес-процессы автоматизировать с помощью ИИ

## Mode

- Publication mode: `new`
- Slug: `kakie-biznes-processy-avtomatizirovat-s-pomoshyu-ii`
- Public URL: `/guides/kakie-biznes-processy-avtomatizirovat-s-pomoshyu-ii`

## Files Created

- Markdown: `content/guides/kakie-biznes-processy-avtomatizirovat-s-pomoshyu-ii.md` ✅
- Metadata: `content/guides/meta/kakie-biznes-processy-avtomatizirovat-s-pomoshyu-ii.json` ✅
- Images: `public/images/guides/kakie-biznes-processy-avtomatizirovat-s-pomoshyu-ii/*.webp` ✅ (placeholders из cost-гайда, ждут ChatGPT)

## Publication Rules

- Canonical: `https://news.malakhovai.ru/guides/kakie-biznes-processy-avtomatizirovat-s-pomoshyu-ii` ✅
- Article + FAQPage (visible) + BreadcrumbList ✅
- FAQ в meta совпадает с FAQ в Markdown ✅
- Cover + inline images имеют alt + caption ✅
- Internal links указывают на существующие routes ✅
- No image generation API ✅
- `noindex: true` — пока нет cover; снять после ChatGPT-генерации и `npm run images:prep` ✅
- CTA только на `telegram-digest` / `contacts` / `telegram-personal` ✅

## Checks

```bash
npm run evergreen:check -- --slug=kakie-biznes-processy-avtomatizirovat-s-pomoshyu-ii
npm run docs:check
npm run build
```

## Post-Publication Steps (Owner)

1. Сгенерировать cover в ChatGPT по prompt из `09-image-brief.md`, положить PNG в `raw-images/cover.png`.
2. (Опционально) Сгенерировать 3 inline images аналогично.
3. `npm run images:prep -- --slug=kakie-biznes-processy-avtomatizirovat-s-pomoshyu-ii`.
4. `npm run evergreen:check` → должен быть green без warnings.
5. В meta `noindex: true` → `false`.
6. Commit + push → Vercel deploy.
7. `npx tsx scripts/indexnow-batch.ts --apply`.
