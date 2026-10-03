# Runtime guard

Read `CLAUDE.md`, `docs/OPERATIONS.md` and `docs/ARCHITECTURE.md` before changing runtime.

Since 2026-10-03 the owner has explicitly frozen the digest. Public hosting is static GitHub Pages from `gh-pages:/`. All ten scheduled GitHub pipelines are disabled and schedule blocks removed. Do not re-enable ingestion, enrichment, covers, retries, monitoring schedules or Telegram jobs without a new explicit owner request. Old Vercel/VPS/Supabase deployment procedures are historical. The old VPS is inaccessible; do not claim its timers have been disabled.

Owner update (2026-10-03): one manual weekly issue and a list sent to the owner’s news bot are explicitly authorized. This does not authorize recurring jobs. Ten new articles bring the static total to 751; see the latest Operations section.

Preserve other contributors' uncommitted changes. Update canonical operations/architecture/decision documents in the same change when runtime or topology changes.

Freeze note (2026-10-03): `vercel.json` also has an empty `crons` list, removing the two historical Telegram fallback schedules on the next production deployment. Vercel remains linked to main but is not the active public archive hosting.

2026-10-04: original domain restoration remains incomplete; use the latest Operations section and release archive-2026-10-04 (751 articles). vercel.json disables automatic Git deployments in main and gh-pages to prevent obsolete Vercel preview failures. Do not report REG installation or domain HTTPS as complete before verification.
