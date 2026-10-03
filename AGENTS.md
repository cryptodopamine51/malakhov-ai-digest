# Runtime guard

Read `CLAUDE.md`, `docs/OPERATIONS.md` and `docs/ARCHITECTURE.md` before changing runtime.

Since 2026-10-03 the owner has explicitly frozen the digest. Public hosting is static GitHub Pages from `gh-pages:/`. All ten scheduled GitHub pipelines are disabled and schedule blocks removed. Do not re-enable ingestion, enrichment, covers, retries, monitoring schedules or Telegram jobs without a new explicit owner request. Old Vercel/VPS/Supabase deployment procedures are historical. The old VPS is inaccessible; do not claim its timers have been disabled.

Preserve other contributors' uncommitted changes. Update canonical operations/architecture/decision documents in the same change when runtime or topology changes.
