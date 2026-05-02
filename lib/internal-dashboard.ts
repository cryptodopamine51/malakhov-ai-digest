import type { SupabaseClient } from '@supabase/supabase-js'
import { getHealthSummary, type HealthSummary } from './health-summary'

export interface DashboardAuthInput {
  expectedToken?: string | null
  queryToken?: string | null
  headerToken?: string | null
}

export interface DashboardAlertRow {
  id: string
  alert_type: string
  severity: string
  status: string
  entity_key: string | null
  message: string
  occurrence_count: number
  first_seen_at: string
  last_seen_at: string
}

export interface DashboardStuckBatchItemRow {
  id: string
  batch_id: string | null
  article_id: string
  request_custom_id: string
  status: string
  error_code: string | null
  created_at: string
  updated_at: string
}

export interface DashboardRecentLiveRow {
  id: string
  slug: string | null
  ru_title: string | null
  publish_ready_at: string | null
  verified_live_at: string | null
  published_at: string | null
  last_publish_verifier: string | null
  publish_lag_minutes: number | null
}

export interface DashboardDigestRunRow {
  id: string
  digest_date: string | null
  channel_id: string | null
  status: string
  articles_count: number | null
  sent_at: string | null
  failed_at: string | null
  created_at: string
  error_message: string | null
}

export interface InternalDashboardData {
  health: HealthSummary
  alerts: DashboardAlertRow[]
  stuckBatchItems: DashboardStuckBatchItemRow[]
  recentLive: DashboardRecentLiveRow[]
  digestRuns: DashboardDigestRunRow[]
}

export function firstSearchParam(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null
  return value ?? null
}

export function isInternalDashboardAuthorized(input: DashboardAuthInput): boolean {
  const expected = input.expectedToken
  if (!expected) return false
  return input.queryToken === expected || input.headerToken === expected
}

function minutesBetween(startIso: string | null, endIso: string | null): number | null {
  if (!startIso || !endIso) return null
  const start = new Date(startIso).getTime()
  const end = new Date(endIso).getTime()
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null
  return Math.max(0, Math.round((end - start) / 60_000))
}

export async function getInternalDashboardData(supabase: SupabaseClient): Promise<InternalDashboardData> {
  const stuckCutoff = new Date(Date.now() - 30 * 60 * 1000).toISOString()

  const [health, alertsRes, stuckRes, recentLiveRes, digestRes] = await Promise.all([
    getHealthSummary(supabase),
    supabase
      .from('pipeline_alerts')
      .select('id, alert_type, severity, status, entity_key, message, occurrence_count, first_seen_at, last_seen_at')
      .in('status', ['open', 'resolved'])
      .order('status', { ascending: true })
      .order('last_seen_at', { ascending: false })
      .limit(10),
    supabase
      .from('anthropic_batch_items')
      .select('id, batch_id, article_id, request_custom_id, status, error_code, created_at, updated_at')
      .not('status', 'in', '(applied,batch_failed,apply_failed_terminal)')
      .lt('created_at', stuckCutoff)
      .order('created_at', { ascending: true })
      .limit(10),
    supabase
      .from('articles')
      .select('id, slug, ru_title, publish_ready_at, verified_live_at, published_at, last_publish_verifier')
      .eq('publish_status', 'live')
      .order('published_at', { ascending: false, nullsFirst: false })
      .limit(20),
    supabase
      .from('digest_runs')
      .select('id, digest_date, channel_id, status, articles_count, sent_at, failed_at, created_at, error_message')
      .order('created_at', { ascending: false })
      .limit(5),
  ])

  const recentLive = ((recentLiveRes.data ?? []) as Omit<DashboardRecentLiveRow, 'publish_lag_minutes'>[])
    .map((row) => ({
      ...row,
      publish_lag_minutes: minutesBetween(row.publish_ready_at, row.verified_live_at ?? row.published_at),
    }))

  return {
    health,
    alerts: (alertsRes.data ?? []) as DashboardAlertRow[],
    stuckBatchItems: (stuckRes.data ?? []) as DashboardStuckBatchItemRow[],
    recentLive,
    digestRuns: (digestRes.data ?? []) as DashboardDigestRunRow[],
  }
}

export const _internals = {
  minutesBetween,
}
