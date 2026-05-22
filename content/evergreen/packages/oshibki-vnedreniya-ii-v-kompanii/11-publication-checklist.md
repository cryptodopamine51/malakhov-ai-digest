# Publication Checklist: Ошибки внедрения ИИ в компании

## Editorial

- [x] Search intent answered in first screen (таблица 10 ошибок).
- [x] Practical result (чек-лист рисков для пилота).
- [x] No invented numbers / cases (всё в `03-source-notes.md`).
- [x] Claims verified.
- [x] Banned phrases removed.
- [x] `Вывод Malakhov AI` specific.

## SEO

- [x] Unique SEO title / description.
- [x] One H1.
- [x] Clean H2/H3.
- [x] Canonical correct.
- [x] FAQ visible (FAQPage emitted).
- [x] Internal links relevant.
- [x] Anti-cannibalization decision documented.

## Images

- [x] Cover WebP exists (placeholder).
- [x] Cover alt + caption.
- [x] Inline images alt + captions.
- [x] No image API used.

## CTAs

- [x] Only real surfaces: `telegram-digest` / `contacts` / `telegram-personal`.
- [x] No lead-magnet promises.
- [x] `inlineCtas` = 2; `ctaCards` = 3.

## Indexation

- [ ] `noindex: true` removed once `cover.webp` regenerated via ChatGPT.
- [ ] `npx tsx scripts/indexnow-batch.ts --apply` post-deploy.

## Technical

- [x] `content/guides/oshibki-vnedreniya-ii-v-kompanii.md` exists.
- [x] `content/guides/meta/oshibki-vnedreniya-ii-v-kompanii.json` valid JSON.
- [x] `npm run evergreen:check` passes (cover warn only).
- [x] `npm run build` passes.
