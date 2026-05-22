# Publication Checklist: Как выбрать первый ИИ-проект в бизнесе

## Editorial

- [x] Search intent answered in first screen.
- [x] Practical result (скоринг + 12 кандидатов).
- [x] No invented numbers / cases (всё в `03-source-notes.md`).
- [x] Claims verified.
- [x] Banned phrases removed.

## SEO

- [x] Unique SEO title / description.
- [x] One H1.
- [x] Canonical correct.
- [x] FAQ visible.
- [x] Internal links relevant.
- [x] Anti-cannibalization documented.

## Images

- [x] Cover WebP exists (placeholder).
- [x] Cover alt + caption.
- [x] Inline alt + captions.
- [x] No image API.

## CTAs

- [x] Only real surfaces.
- [x] No lead-magnet promises.
- [x] `inlineCtas` = 2; `ctaCards` = 3.

## Indexation

- [ ] `noindex: true` removed once cover regenerated.
- [ ] `npx tsx scripts/indexnow-batch.ts --apply` post-deploy.

## Technical

- [x] Files exist for publication.
- [x] `evergreen:check` passes (cover warn only).
- [x] `build` passes.
