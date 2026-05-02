/**
 * pipeline/published-window-monitor.ts
 *
 * Wave 2.1 алёрт `published_low_window`:
 * раз в 2 часа (см. .github/workflows/pipeline-health.yml) проверяет, что за
 * последние N часов МСК была хотя бы одна публикация (`publish_status='live'`).
 *
 * Контракт — `docs/spec_observability_publication_2026-05-01.md` § 2:
 *  - 0 live в окне + активные feeds → fire warning;
 *  - 0 live + все ingest_runs за окно — не активны → silent (root cause виден через source_down);
 *  - ночное «тихое окно» МСК — не fire-ится;
 *  - есть live за окно → resolveAlert.
 */

import { config as loadEnv } from 'dotenv'
import { resolve } from 'path'

import type { SupabaseClient } from '@supabase/supabase-js'

import { fireAlert, resolveAlert } from './alerts'

const MSK_OFFSET_MS = 3 * 60 * 60 * 1000

const DEFAULT_WINDOW_HOURS = 6
const DEFAULT_QUIET_START_MSK = 0
const DEFAULT_QUIET_END_MSK = 6

export interface LiveWindowSnapshot {
  liveCount: number
  ingestActive: boolean
  ingestRowsTotal: number
}

export type MonitorDecision =
  | { kind: 'fire'; reason: 'no_live_active_feeds' }
  | { kind: 'resolve'; reason: 'live_present' }
  | { kind: 'noop'; reason: 'quiet_window' | 'ingest_inactive' }

export interface PublishedWindowConfig {
  windowHours?: number
  quietStartMsk?: number
  quietEndMsk?: number
  now?: Date
  botToken?: string
  adminChatId?: string
}

export function isQuietWindow(now: Date, quietStartMsk: number, quietEndMsk: number): boolean {
  if (quietStartMsk === quietEndMsk) return false
  const mskHour = new Date(now.getTime() + MSK_OFFSET_MS).getUTCHours()
  if (quietStartMsk < quietEndMsk) {
    return mskHour >= quietStartMsk && mskHour < quietEndMsk
  }
  // wraparound, например 22→4
  return mskHour >= quietStartMsk || mskHour < quietEndMsk
}

export async function checkLiveWindow(
  supabase: SupabaseClient,
  hours: number,
  now: Date = new Date(),
): Promise<LiveWindowSnapshot> {
  const sinceIso = new Date(now.getTime() - hours * 60 * 60 * 1000).toISOString()

  const [liveRes, ingestRes] = await Promise.all([
    supabase
      .from('articles')
      .select('*', { count: 'exact', head: true })
      .eq('publish_status', 'live')
      .gte('published_at', sinceIso),
    supabase
      .from('ingest_runs')
      .select('status')
      .gte('started_at', sinceIso),
  ])

  const ingestRows = (ingestRes.data ?? []) as Array<{ status: string }>
  const ingestActive = ingestRows.some((row) => row.status === 'ok' || row.status === 'partial')

  return {
    liveCount: liveRes.count ?? 0,
    ingestActive,
    ingestRowsTotal: ingestRows.length,
  }
}

export function decideWindow(
  snapshot: LiveWindowSnapshot,
  quiet: boolean,
): MonitorDecision {
  if (snapshot.liveCount > 0) return { kind: 'resolve', reason: 'live_present' }
  if (quiet) return { kind: 'noop', reason: 'quiet_window' }
  if (!snapshot.ingestActive) return { kind: 'noop', reason: 'ingest_inactive' }
  return { kind: 'fire', reason: 'no_live_active_feeds' }
}

export async function runPublishedWindowMonitor(
  supabase: SupabaseClient,
  config: PublishedWindowConfig = {},
): Promise<{ decision: MonitorDecision; snapshot: LiveWindowSnapshot }> {
  const now = config.now ?? new Date()
  const windowHours = config.windowHours ?? DEFAULT_WINDOW_HOURS
  const quietStart = config.quietStartMsk ?? DEFAULT_QUIET_START_MSK
  const quietEnd = config.quietEndMsk ?? DEFAULT_QUIET_END_MSK

  const snapshot = await checkLiveWindow(supabase, windowHours, now)
  const quiet = isQuietWindow(now, quietStart, quietEnd)
  const decision = decideWindow(snapshot, quiet)

  if (decision.kind === 'fire') {
    await fireAlert({
      supabase,
      alertType: 'published_low_window',
      severity: 'warning',
      message: `Нет публикаций за последние ${windowHours}ч (МСК), но источники активны.`,
      payload: {
        window_hours: windowHours,
        live_count: snapshot.liveCount,
        ingest_rows: snapshot.ingestRowsTotal,
      },
      botToken: config.botToken,
      adminChatId: config.adminChatId,
    })
  } else if (decision.kind === 'resolve') {
    await resolveAlert(supabase, 'published_low_window')
  }

  return { decision, snapshot }
}

function parseHoursEnv(name: string, fallback: number): number {
  const raw = process.env[name]
  if (raw === undefined) return fallback
  const parsed = Number(raw)
  if (!Number.isFinite(parsed)) return fallback
  return parsed
}

async function main(): Promise<void> {
  loadEnv({ path: resolve(process.cwd(), '.env.local') })

  const { getServerClient } = await import('../lib/supabase')
  const supabase = getServerClient()

  const result = await runPublishedWindowMonitor(supabase, {
    windowHours: parseHoursEnv('PUBLISHED_LOW_WINDOW_HOURS', DEFAULT_WINDOW_HOURS),
    quietStartMsk: parseHoursEnv('PUBLISHED_LOW_WINDOW_QUIET_START_MSK', DEFAULT_QUIET_START_MSK),
    quietEndMsk: parseHoursEnv('PUBLISHED_LOW_WINDOW_QUIET_END_MSK', DEFAULT_QUIET_END_MSK),
    botToken: process.env.TELEGRAM_BOT_TOKEN,
    adminChatId: process.env.TELEGRAM_ADMIN_CHAT_ID,
  })

  const ts = new Date().toTimeString().slice(0, 8)
  console.log(
    `[${ts}] published-window-monitor: decision=${result.decision.kind}/${result.decision.reason} ` +
      `live=${result.snapshot.liveCount} ingestActive=${result.snapshot.ingestActive}`,
  )
}

const isDirect = (() => {
  if (typeof require !== 'undefined' && typeof module !== 'undefined') {
    return require.main === module
  }
  return false
})()

if (isDirect) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : String(err))
    process.exit(1)
  })
}
