/**
 * pipeline/backlog-monitor.ts
 *
 * Monitors the enrichment backlog. Fires an alert if too many articles
 * are stuck in pending/retry_wait beyond expected processing time.
 */

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { getServerClient } from '../lib/supabase'
import { fireAlert, resolveAlert } from './alerts'

const BACKLOG_ALERT_THRESHOLD = 50  // articles
const BACKLOG_AGE_ALERT_HOURS = 4   // oldest pending older than this triggers alert

function log(msg: string): void {
  const ts = new Date().toTimeString().slice(0, 8)
  console.log(`[${ts}] ${msg}`)
}

async function checkBacklog(): Promise<void> {
  log('=== backlog-monitor check ===')

  const supabase = getServerClient()
  const botToken = process.env.TELEGRAM_BOT_TOKEN
  const adminChatId = process.env.TELEGRAM_ADMIN_CHAT_ID

  // Count pending articles
  const { count: pendingCount } = await supabase
    .from('articles')
    .select('*', { count: 'exact', head: true })
    .in('enrich_status', ['pending', 'retry_wait'])

  // Oldest pending article
  const { data: oldest } = await supabase
    .from('articles')
    .select('created_at, original_title')
    .eq('enrich_status', 'pending')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  const count = pendingCount ?? 0
  const oldestAgeHours = oldest
    ? (Date.now() - new Date(oldest.created_at as string).getTime()) / 3_600_000
    : 0

  log(`Pending/retry_wait: ${count} статей`)
  if (oldest) log(`Самая старая pending: ${Math.round(oldestAgeHours)}h — "${String(oldest.original_title).slice(0, 60)}"`)

  const shouldAlert = count >= BACKLOG_ALERT_THRESHOLD || oldestAgeHours > BACKLOG_AGE_ALERT_HOURS

  if (shouldAlert) {
    await fireAlert({
      supabase,
      alertType: 'backlog_high',
      severity: oldestAgeHours > BACKLOG_AGE_ALERT_HOURS * 2 ? 'critical' : 'warning',
      message: `Enrich backlog: ${count} статей ожидают. Самая старая: ${Math.round(oldestAgeHours)}h назад.`,
      payload: { pendingCount: count, oldestAgeHours: Math.round(oldestAgeHours) },
      botToken,
      adminChatId,
    })
    log(`⚠️ Backlog alert fired (${count} pending, oldest ${Math.round(oldestAgeHours)}h)`)
  } else if (count < BACKLOG_ALERT_THRESHOLD / 2) {
    await resolveAlert(supabase, 'backlog_high')
  }

  log('=== backlog-monitor завершён ===')
}

checkBacklog().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err))
  process.exit(1)
})
