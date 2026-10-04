# Runtime guard

Read `CLAUDE.md`, `docs/OPERATIONS.md` and `docs/ARCHITECTURE.md` before changing runtime.

Since 2026-10-03 the owner has explicitly frozen the digest. Public hosting is static REG.RU shared hosting at `https://news.malakhovai.ru/`; GitHub Pages `gh-pages:/` is the fallback and package source. All ten scheduled GitHub pipelines are disabled and schedule blocks removed. Do not re-enable ingestion, enrichment, covers, retries, monitoring schedules or Telegram jobs without a new explicit owner request. Old Vercel/VPS/Supabase deployment procedures are historical. The old VPS is inaccessible; do not claim its timers have been disabled.

Owner update (2026-10-03): one manual weekly issue and a list sent to the owner’s news bot are explicitly authorized. This does not authorize recurring jobs. Ten new articles bring the static total to 751; see the latest Operations section.

Preserve other contributors' uncommitted changes. Update canonical operations/architecture/decision documents in the same change when runtime or topology changes.

Freeze note (2026-10-03): `vercel.json` also has an empty `crons` list, removing the two historical Telegram fallback schedules on the next production deployment. Vercel remains linked to main but is not the active public archive hosting.

2026-10-04: REG.RU installation and domain TLS are verified; use the first Operations section and release archive-2026-10-04-covers (751 articles). vercel.json disables automatic Git deployments in main and gh-pages to prevent obsolete Vercel preview failures. Verify REG publication and HTTPS after each manual update.

2026-10-04 final installation: release archive-2026-10-04-covers installed on REG.RU with checksum verified and old root backed up outside www. DNS A news is 31.31.196.75 (TTL 300), Let's Encrypt installed, HTTP redirects to HTTPS. See the first Operations section for current runtime, verification and rollback; earlier incomplete-restoration notes are historical. Do not publish by merely pushing gh-pages: REG must receive the updated static package too.
