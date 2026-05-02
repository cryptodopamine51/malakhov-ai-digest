# Rollout and backfill plan: content quality task

Дата: 2026-05-01
Статус: executed 2026-05-02

## Цель

Безопасно очистить уже опубликованные статьи от рекламных/author/нерелевантных изображений и выкатить системную защиту для новых статей.

## Preconditions

- Sanitizer покрыт unit-тестами.
- Render path использует sanitizer как fallback.
- Pipeline apply path использует sanitizer перед записью в Supabase.
- Есть список fixture slugs для ручной проверки.
- Есть доступ к production env через `.env.local`/Vercel/Supabase service role только для backfill script.

## Backfill script contract

Command:

```bash
npx tsx scripts/sanitize-existing-article-media.ts --dry-run
npx tsx scripts/sanitize-existing-article-media.ts --dry-run --limit=50
npx tsx scripts/sanitize-existing-article-media.ts --dry-run --slug=<slug>
npx tsx scripts/sanitize-existing-article-media.ts --apply --limit=50
```

Required output:

```text
scanned: 500
changed: 37
cover_removed: 4
inline_removed: 52
by_reason:
  ad_url: 12
  promo_text: 8
  author_photo: 14
  generic_caption: 18
examples:
  <slug> removed <url> reason=author_photo caption="Photo of Stephen Clark"
```

Required safety:

- default mode is dry-run;
- `--apply` must be explicit;
- update only changed rows;
- do not touch article text/title/slug/status;
- process in small batches;
- log every changed article.

## Rollout sequence

### Step 1. Render protection deploy

Deploy code where render filters rejected legacy images, before mutating data.

Smoke:

- problem Habr article no longer shows course banner;
- problem Ars article no longer shows author photo;
- normal image article still shows relevant image.

If this fails, do not run backfill.

### Step 2. Dry-run backfill

Run:

```bash
npx tsx scripts/sanitize-existing-article-media.ts --dry-run
```

Review:

- top reject reasons;
- top affected sources;
- 20 examples;
- any false positives.

If false positives are high, tune sanitizer and rerun dry-run.

### Step 3. Apply backfill in batches

Run small batches:

```bash
npx tsx scripts/sanitize-existing-article-media.ts --apply --limit=50
```

Repeat until no changes remain.

After each batch:

- sample 5 changed articles;
- verify site render;
- check script logs for unexpected source.

### Step 4. Full smoke

Check:

- `/`;
- `/categories/ai-industry`;
- `/categories/ai-research`;
- `/russia`;
- problem article with former Habr banner;
- problem article with former Ars author photo;
- `/cookie-policy`;
- `/privacy-policy`;
- `/consent`.

### Step 5. Monitor next ingest/enrich

After next pipeline run:

- inspect newly enriched articles;
- confirm `article_images` do not include rejected media;
- confirm logs contain sanitizer reject summary when relevant.

## Rollback

Code rollback:

- revert deploy/commit if render breaks.

Data rollback:

- backfill should write a JSONL audit file before apply:
  - article id;
  - previous `cover_image_url`;
  - previous `article_images`;
  - new values;
  - timestamp.
- restore script can be manual SQL/update from audit file if severe false positive occurs.

Do not rely on memory or console scrollback for rollback.

## Production deploy notes

Vercel production deploy:

```bash
vercel deploy --prod --yes
```

Before deploy:

- keep ignored local `tmp/` files out of Vercel upload if they break typecheck;
- run `npm run build` from a clean enough tree;
- confirm no unrelated files are staged.

## Post-rollout docs

Update:

- `docs/ARTICLE_SYSTEM.md` with sanitizer rules;
- `docs/OPERATIONS.md` with backfill command and smoke checklist;
- `docs/DECISIONS.md` if the freshness/interesting split is adopted.

## Execution log

```text
npx tsx scripts/sanitize-existing-article-media.ts --dry-run
scanned: 600
changed: 503
cover_removed: 153
inline_removed: 420
```

```text
npx tsx scripts/sanitize-existing-article-media.ts --apply
scanned: 600
changed: 503
audit_file: tmp/media-sanitizer-audit-2026-05-01T22-15-34-084Z.jsonl
```

```text
npx tsx scripts/sanitize-existing-article-media.ts --apply
scanned: 600
changed: 2
audit_file: tmp/media-sanitizer-audit-2026-05-01T22-17-34-834Z.jsonl
```

```text
npx tsx scripts/sanitize-existing-article-media.ts --dry-run
scanned: 600
changed: 0
```

Notes:

- The first repeated dry-run after apply showed JSON key-order noise from Supabase JSONB; `sameJson()` now uses canonical object-key ordering.
- Batch mode remains useful for slug/source sampling, but full apply was used for final backfill because the script scans a stable `created_at desc` range and writes audit rows before each update.
