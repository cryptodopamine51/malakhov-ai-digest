# Acceptance criteria: content quality task

Дата: 2026-05-01
Статус: acceptance checklist

## Required automated checks

Run before deploy:

```bash
npm run build
npm run docs:check
```

Run targeted tests after implementation:

```bash
npx tsx --test tests/node/media-sanitizer.test.ts
npx tsx --test tests/node/interest-ranking.test.ts
npx tsx --test tests/node/category-sorting.test.ts
```

If test filenames differ, update this document during implementation.

## Media sanitizer acceptance

### Must reject

- Habr career/course banner.
- Generic ad banner by class/id/url.
- `adfox`, `doubleclick`, `yabs`, `yandex/direct` media.
- `Photo of Stephen Clark` author portrait from Ars Technica.
- `author`, `byline`, `avatar`, `profile`, `headshot` images.
- Generic caption images: `image`, `photo`, filename, URL-only caption.

### Must keep

- Relevant product screenshot with caption matching article subject.
- Relevant research chart/table image.
- Relevant company/product image when article is about that company/product.
- Generated editorial image if it was created by our own pipeline and not ad/author-like.

### Render checks

- Removed image leaves no empty figure/border/caption shell.
- Article typography still flows correctly.
- If all inline images are removed, article remains readable.

## Backfill acceptance

Dry-run:

- prints total scanned/changed;
- prints reason summary;
- prints examples;
- makes no DB writes.

Apply:

- requires `--apply`;
- updates only `cover_image_url` and/or `article_images`;
- writes or prints audit info sufficient for rollback;
- leaves `published`, `quality_ok`, `verified_live`, `publish_status`, `slug`, text fields unchanged.

Production data:

- no known Habr career banners remain in live articles;
- no known Ars author photo case remains in live articles;
- random sample of 20 changed articles has no obvious false positives.

## Consent acceptance

Site-wide:

- footer does not show «Отзыв согласия»;
- no visible button «Отозвать согласие»;
- `/consent` title/content is about «Согласие на обработку персональных данных» or compatible legal copy;
- `/cookie-policy` and `/privacy-policy` do not point users to a visible revoke button.

Technical:

- no broken imports after removing `RevokeConsentButton` from render;
- route `/consent` still returns 200 unless a redirect decision is explicitly made.

## Hero contrast acceptance

Viewports:

- desktop 1440px light;
- desktop 1440px dark;
- mobile 390px light;
- mobile 390px dark.

Pass:

- hero supporting text is readable;
- no white-on-white or black-on-black;
- no text overlap;
- theme toggle still persists choice.

## Card consistency acceptance

Compare:

- `/`;
- `/categories/ai-industry`;
- `/russia`.

Pass:

- card layout system is visibly consistent;
- first featured/default pattern is intentional and shared;
- placeholders and real images use same dimensions;
- no nested cards;
- no text overflow in cards.

## Category freshness acceptance

Given fixture:

- Article A: older, score 9.
- Article B: newer, score 3.

In normal category list:

- B appears before A.

In «Самое интересное»:

- A may appear before B if formula ranks it higher.

Load-more:

- page 2 continues after page 1;
- no duplicates;
- order is stable after refresh.

## «Самое интересное» acceptance

Pass:

- block appears on category pages when at least 3 candidates exist;
- block hides when fewer than 3 candidates exist;
- max 4 cards;
- diversity prevents all cards from the same source when alternatives exist;
- ranking is deterministic in tests with fixed `now`;
- block does not require personal tracking.

## Live smoke checklist

After production deploy:

1. Open `https://news.malakhovai.ru/`.
2. Toggle light/dark; hero text remains readable.
3. Open `/categories/ai-industry`; fresh list starts with newest articles.
4. Open `/russia`; same checks.
5. Open problem article with former Habr banner; banner absent.
6. Open problem article with former Ars author photo; author photo absent.
7. Open `/cookie-policy`, `/privacy-policy`, `/consent`; no visible revoke button.
8. Check browser console for fatal errors.

## Final response requirements

When implementation is completed, final response must include:

- commit SHA;
- deploy URL or Vercel deployment id;
- backfill mode used and summary;
- tests run;
- docs updated;
- any residual risk or intentionally deferred item.
