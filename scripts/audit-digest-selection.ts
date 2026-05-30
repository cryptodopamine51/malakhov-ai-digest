/**
 * scripts/audit-digest-selection.ts
 *
 * Reconstructs Telegram digest candidate pools and compares the current source-only
 * selector with the story-aware selector. Read-only.
 *
 * Usage:
 *   npx tsx scripts/audit-digest-selection.ts --date=2026-05-30
 *   npx tsx scripts/audit-digest-selection.ts --days=14
 */

import { config } from 'dotenv'
import { resolve } from 'path'
import { pathToFileURL } from 'url'
config({ path: resolve(process.cwd(), '.env.local') })

import { getServerClient, type Article } from '../lib/supabase'
import { applyDiversityCap } from '../bot/daily-digest-core'
import { deriveDigestStory, selectDigestArticles } from '../bot/digest-selection'

const MSK_OFFSET_MS = 3 * 60 * 60 * 1000

interface Args {
  date: string | null
  days: number
}

function parseArgs(argv: string[]): Args {
  let date: string | null = null
  let days = 7

  for (const arg of argv) {
    if (arg.startsWith('--date=')) date = arg.slice('--date='.length)
    else if (arg.startsWith('--days=')) days = Number(arg.slice('--days='.length))
  }

  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error('--date must be YYYY-MM-DD')
  }
  if (!Number.isFinite(days) || days < 1 || days > 31) {
    throw new Error('--days must be a number from 1 to 31')
  }

  return { date, days }
}

function digestDates(args: Args): string[] {
  if (args.date) return [args.date]

  const todayMsk = new Date(Date.now() + MSK_OFFSET_MS)
  const dates: string[] = []
  for (let i = 0; i < args.days; i++) {
    const date = new Date(todayMsk)
    date.setUTCDate(date.getUTCDate() - i)
    dates.push(date.toISOString().slice(0, 10))
  }
  return dates
}

function digestWindowUtc(digestDate: string): { from: string; to: string; visibleDate: string } {
  const [year, month, day] = digestDate.split('-').map(Number)
  const yesterdayUtc = new Date(Date.UTC(year, month - 1, day, 0, 0, 0))
  yesterdayUtc.setUTCDate(yesterdayUtc.getUTCDate() - 1)

  const from = new Date(
    Date.UTC(yesterdayUtc.getUTCFullYear(), yesterdayUtc.getUTCMonth(), yesterdayUtc.getUTCDate(), 0, 0, 0) - MSK_OFFSET_MS,
  )
  const to = new Date(
    Date.UTC(yesterdayUtc.getUTCFullYear(), yesterdayUtc.getUTCMonth(), yesterdayUtc.getUTCDate(), 23, 59, 59) - MSK_OFFSET_MS,
  )

  return {
    from: from.toISOString(),
    to: to.toISOString(),
    visibleDate: yesterdayUtc.toISOString().slice(0, 10),
  }
}

function previousDate(date: string, daysBack: number): string {
  const [year, month, day] = date.split('-').map(Number)
  const d = new Date(Date.UTC(year, month - 1, day, 0, 0, 0))
  d.setUTCDate(d.getUTCDate() - daysBack)
  return d.toISOString().slice(0, 10)
}

async function loadCandidates(
  supabase: ReturnType<typeof getServerClient>,
  from: string,
  to: string,
): Promise<Article[]> {
  const { data, error } = await supabase
    .from('articles')
    .select('*')
    .eq('published', true)
    .eq('quality_ok', true)
    .eq('verified_live', true)
    .eq('publish_status', 'live')
    .not('tg_teaser', 'is', null)
    .not('slug', 'is', null)
    .gte('pub_date', from)
    .lte('pub_date', to)
    .order('score', { ascending: false })
    .order('pub_date', { ascending: false })
    .limit(50)

  if (error) throw new Error(`candidate query failed: ${error.message}`)
  return (data ?? []) as Article[]
}

async function loadRecentArticles(
  supabase: ReturnType<typeof getServerClient>,
  digestDate: string,
): Promise<Article[]> {
  const sinceDate = previousDate(digestDate, 3)
  const { data: runs, error: runsError } = await supabase
    .from('digest_runs')
    .select('article_ids')
    .eq('status', 'success')
    .gte('digest_date', sinceDate)
    .lt('digest_date', digestDate)
    .order('digest_date', { ascending: false })
    .limit(5)

  if (runsError) throw new Error(`recent digest query failed: ${runsError.message}`)

  const ids = [
    ...new Set(
      (runs ?? [])
        .flatMap((run) => Array.isArray(run.article_ids) ? run.article_ids : [])
        .filter((id): id is string => typeof id === 'string' && id.length > 0),
    ),
  ]
  if (ids.length === 0) return []

  const { data, error } = await supabase.from('articles').select('*').in('id', ids)
  if (error) throw new Error(`recent articles query failed: ${error.message}`)
  return (data ?? []) as Article[]
}

function row(article: Article): Record<string, string | number | null> {
  const story = deriveDigestStory(article)
  return {
    score: article.score,
    source: article.source_name,
    entity: story.primaryEntity,
    event: story.eventType,
    storyKey: story.storyKey,
    title: (article.ru_title ?? article.original_title).slice(0, 100),
  }
}

async function auditDate(supabase: ReturnType<typeof getServerClient>, digestDate: string): Promise<void> {
  const { from, to, visibleDate } = digestWindowUtc(digestDate)
  const candidates = await loadCandidates(supabase, from, to)
  const recent = await loadRecentArticles(supabase, digestDate)

  const current = applyDiversityCap(candidates, { perSourceCap: 2, target: 5 })
  const proposed = selectDigestArticles(candidates, recent, {
    target: 5,
    perSourceCap: 2,
    perPrimaryEntityCap: 2,
  })

  console.log(`\n=== digest_date=${digestDate} visible=${visibleDate} candidates=${candidates.length} recent=${recent.length} ===`)
  console.log('\nCurrent selector:')
  console.table(current.map(row))
  console.log('\nStory-aware selector:')
  console.table(proposed.articles.map(row))

  const meaningfulSkips = proposed.diagnostics.skipped.filter((item) =>
    item.reason === 'duplicate_story' || item.reason === 'recent_story_duplicate' || item.reason === 'primary_entity_cap'
  )
  if (meaningfulSkips.length > 0) {
    console.log('\nSkipped by story-aware selector:')
    console.table(meaningfulSkips.map((item) => ({
      reason: item.reason,
      source: item.sourceName,
      entity: item.primaryEntity,
      storyKey: item.storyKey,
      title: item.title.slice(0, 100),
    })))
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  const supabase = getServerClient()
  for (const date of digestDates(args)) {
    await auditDate(supabase, date)
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
