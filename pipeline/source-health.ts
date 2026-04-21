/**
 * pipeline/source-health.ts
 *
 * Checks source health by looking at recent source_runs.
 * Fires alerts for sources that have been consistently failing.
 */

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { getServerClient } from '../lib/supabase'
import { fireAlert, resolveAlert } from './alerts'

// Sources that are critical for content quality
const HIGH_PRIORITY_SOURCES = [
  'VentureBeat AI',
  'The Verge AI',
  'TechCrunch AI',
  'MIT Technology Review AI',
  'OpenAI News',
  'Habr AI',
]

const FAILURE_WINDOW_HOURS = 6
const MIN_FAILURES_TO_ALERT = 3

function log(msg: string): void {
  const ts = new Date().toTimeString().slice(0, 8)
  console.log(`[${ts}] ${msg}`)
}

async function checkSourceHealth(): Promise<void> {
  log('=== source-health check ===')

  const supabase = getServerClient()
  const botToken = process.env.TELEGRAM_BOT_TOKEN
  const adminChatId = process.env.TELEGRAM_ADMIN_CHAT_ID
  const since = new Date(Date.now() - FAILURE_WINDOW_HOURS * 60 * 60 * 1000).toISOString()

  // Get recent source runs grouped by source
  const { data: runs, error } = await supabase
    .from('source_runs')
    .select('source_name, status, error_message, started_at')
    .gte('started_at', since)
    .order('started_at', { ascending: false })

  if (error) {
    log(`Ошибка выборки source_runs: ${error.message}`)
    return
  }

  if (!runs?.length) {
    log('Нет данных source_runs за последние 6 часов')
    return
  }

  // Group by source name
  const bySource = new Map<string, { ok: number; failed: number; empty: number; lastError: string | null }>()
  for (const run of runs) {
    const name = run.source_name as string
    if (!bySource.has(name)) bySource.set(name, { ok: 0, failed: 0, empty: 0, lastError: null })
    const s = bySource.get(name)!
    if (run.status === 'ok') s.ok++
    else if (run.status === 'failed') { s.failed++; s.lastError = run.error_message as string | null }
    else if (run.status === 'empty') s.empty++
  }

  for (const [sourceName, stats] of Array.from(bySource.entries())) {
    const isHighPriority = HIGH_PRIORITY_SOURCES.includes(sourceName)
    const totalRuns = stats.ok + stats.failed + stats.empty
    const failureRate = totalRuns > 0 ? stats.failed / totalRuns : 0

    if (stats.failed >= MIN_FAILURES_TO_ALERT && (isHighPriority || failureRate > 0.5)) {
      const severity = isHighPriority ? 'critical' : 'warning'
      const sent = await fireAlert({
        supabase,
        alertType: 'source_down',
        severity,
        entityKey: sourceName,
        message: `Source "${sourceName}" failed ${stats.failed}/${totalRuns} times in last ${FAILURE_WINDOW_HOURS}h. Last error: ${stats.lastError ?? 'unknown'}`,
        payload: { stats, failureRate },
        botToken,
        adminChatId,
      })
      if (sent) log(`🔴 Alert fired for source: ${sourceName} (${stats.failed} failures)`)
    } else if (stats.ok > 0 && stats.failed === 0) {
      // Source recovered — resolve any open alert
      await resolveAlert(supabase, 'source_down', sourceName)
    }
  }

  log(`Проверено источников: ${bySource.size}`)
  log('=== source-health завершён ===')
}

checkSourceHealth().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err))
  process.exit(1)
})
