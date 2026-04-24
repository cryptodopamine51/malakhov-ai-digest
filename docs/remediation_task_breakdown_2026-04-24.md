# Task breakdown: runtime remediation, 2026-04-24

## Track A: Git/worktree safety

Status: planned

- [ ] Create a full patch backup of the current dirty worktree.
- [ ] Create a small incident branch from `origin/main`.
- [ ] Move only Telegram/runtime incident files into the incident branch.
- [ ] Keep the current `codex/pipeline-reliability-finish` branch untouched until the incident patch is merged.
- [ ] Decide what to do with generated artifacts under `tmp/` and untracked docs/images.

Acceptance criteria:

- Incident branch diff is small and reviewable.
- No unrelated UI/batch/design files in the incident PR.
- Existing uncommitted work remains recoverable.

## Track B: Stop duplicate Telegram sends

Status: planned

- [ ] Remove second cron slot from production `.github/workflows/tg-digest.yml`.
- [ ] Add GitHub Actions `concurrency` to `tg-digest.yml`.
- [ ] Add Supabase service-role preflight before Telegram API call.
- [ ] Make `tg_sent` update verify affected rows.
- [ ] Add tests around duplicate guard behavior.

Acceptance criteria:

- `gh run list --workflow tg-digest.yml` shows one scheduled digest run per day.
- A bad Supabase key fails before Telegram send.
- Second run for same digest date exits without sending.

## Track C: Supabase idempotency lock

Status: planned

- [ ] Create additive migration for `telegram_digest_runs`.
- [ ] Add unique key on `(digest_date, channel_id)`.
- [ ] Implement atomic claim in `bot/daily-digest.ts`.
- [ ] Store `message_hash`, `article_ids`, status and Telegram message metadata.
- [ ] Require explicit dated override for force sends.

Acceptance criteria:

- Parallel runs cannot both send.
- Manual non-force rerun skips.
- Failed send is visible in DB.
- Successful send is visible in DB and linked to article ids.

## Track D: Legacy VPS isolation

Status: planned

- [ ] Backup legacy Postgres data on `malakhov-ai-vps`.
- [ ] Stop `malakhov_ai_digest_scheduler`.
- [ ] Decide whether to stop `malakhov_ai_digest_bot` or keep only passive `/start` behavior.
- [ ] Document VPS as `archived legacy` or `infra-only`.
- [ ] Move old compose backup files into a backups folder.

Acceptance criteria:

- No daily/weekly delivery from VPS.
- Public site still resolves to Vercel.
- Rollback command is documented.

## Track E: Build/render isolation

Status: planned

- [ ] Remove `pipeline/fetcher` import from `app/articles/[slug]/page.tsx`.
- [ ] Use only persisted `article_videos` and `article_images`.
- [ ] Add fallback UI for missing media.
- [ ] Add guard/test preventing pipeline imports from `app/**`.

Acceptance criteria:

- `npm run build` does not call `fetchArticleContent`.
- Build succeeds without external article-source network access.
- Article pages keep working with and without persisted media.

## Track F: Runtime and dependency hygiene

Status: planned

- [ ] Add `.nvmrc` for Node 20.
- [ ] Update Next.js to patched `14.2.35`.
- [ ] Evaluate `@mozilla/readability@0.6.0` with extraction tests.
- [ ] Run audit again after updates.

Acceptance criteria:

- Local default setup uses Node 20.
- `npm audit --omit=dev` no longer reports high severity Next.js issue.
- Pipeline extraction tests still pass.

## Track G: Observability cleanup

Status: planned

- [ ] Add alert resolution when publish verification recovers.
- [ ] Add stale alert cleanup/report.
- [ ] Check why `llm_usage_logs` count is `null`.
- [ ] Add a concise health report command for production checks.

Acceptance criteria:

- Old recovered alerts do not remain `open`.
- Real active critical alerts remain visible.
- Health command gives a one-screen production status.

