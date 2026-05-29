# Task — адаптивные cover-варианты в R2 + remotePatterns (P1)

> Рабочий, не канонический. Источник: `docs/senior_review_2026-05-29.md` (P1.3 + P1.4).
> Статус: DONE (код, dormant) 2026-05-29 — локально, не закоммичено. Включение фичи + замер CWV — owner step.

## Поправка к премиссе (ревью P1.3 было неточно)

В ревью `unoptimized:true` был привязан к egress Supabase. Это неверно. Корень `unoptimized:true` —
**лимит image-трансформаций Vercel Hobby** (`/_next/image` начал возвращать HTTP 402
`OPTIMIZED_IMAGE_REQUEST_PAYMENT_REQUIRED` 2026-05-22, см. комментарий в `next.config.mjs`).
Переезд на R2 (2026-05-26) закрыл *другой* отказ — egress-блокировку Supabase, — но не вернул
оптимизацию изображений: ограничение Hobby на трансформации никуда не делось. Поэтому простое
снятие `unoptimized:true` (вариант A) снова упёрлось бы в 402.

## Решение (выбран вариант B)

Хранить готовые уменьшенные WebP-варианты рядом с base-обложкой в R2 и отдавать их нативным
`<img srcset>` — это даёт per-device-resize без зависимости от Vercel-оптимизатора. Реализовано,
но **выключено по умолчанию** (флаг `NEXT_PUBLIC_R2_IMAGE_VARIANTS`), потому что требует
предварительного backfill вариантов и замера CWV владельцем.

## Что сделано

- `lib/image-variants.ts` (pure, client-safe) — ширины (`COVER_BASE_WIDTH=1200`,
  `COVER_VARIANT_WIDTHS=[400,800]`), `variantUrlFor`/`variantKeyFor`, `isR2ImageUrl`,
  `r2VariantSrcSet`. Единый источник истины по ширинам для аплоада и рендера.
- `lib/r2-images.ts::uploadWebpWithVariants` (server, sharp) — base + варианты. Подключено в
  `pipeline/image-generator.ts`, `scripts/generate-ai-covers.ts`,
  `scripts/backfill-template-covers.ts`, `scripts/backfill-stock-covers.ts`,
  `scripts/replace-test-covers-with-editorial-templates.ts`.
- `scripts/backfill-cover-variants.ts` — варианты для всех существующих R2-обложек
  (`--dry-run` / `--skip-existing` / `--limit`).
- Рендер за флагом: `src/components/SafeImage.tsx` (карточки, `fill`) и hero статьи
  (`app/categories/[category]/[slug]/page.tsx`). Флаг off → обычный `next/image` (`unoptimized`).
- Тест: `tests/node/image-variants.test.ts` (7 кейсов). Прогон: `tsc --noEmit` ✅, `npm run lint` ✅,
  `npm test` 246/246 ✅.
- Docs: `docs/ARTICLE_SYSTEM.md` (Responsive cover variants), `docs/OPERATIONS.md`
  (env + секция + порядок включения), `.env.example`, `next.config.mjs` (комментарий).

## P1.4 (remotePatterns) — отложено осознанно

`remotePatterns` оставлен `hostname:'**'`. При `unoptimized:true` + нативной раздаче вариантов
`**` не несёт transform-cost/security-риска (оптимизатор не работает). Сузить до фактического
списка хостов хрупко: обложки приходят с множества внешних CDN (habrastorage.org,
leonardo.osnova.io, theverge.com, zdnet.com, …) и меняются с источниками. Ревизия — только если
будет возвращён Next-оптимизатор.

## Definition of Done (что осталось владельцу)

- [x] Принято решение (вариант B) и реализовано (dormant).
- [ ] Прогнать `scripts/backfill-cover-variants.ts` до `failed=0`.
- [ ] Замерить CWV (LCP, CLS) ДО на главной + странице статьи.
- [ ] `NEXT_PUBLIC_R2_IMAGE_VARIANTS=on` в Vercel + редеплой.
- [ ] Замерить CWV ПОСЛЕ; LCP не хуже, лучше.
- [ ] (опц.) Сузить `remotePatterns` — только при возврате оптимизатора.

## Doc impact

Docs updated: `docs/ARTICLE_SYSTEM.md`, `docs/OPERATIONS.md`, `.env.example`, `next.config.mjs`.
