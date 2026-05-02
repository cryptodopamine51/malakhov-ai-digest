/**
 * lib/health-summary.ts
 *
 * Single source of truth for /api/health and /internal/dashboard data shape.
 * See docs/spec_observability_publication_2026-05-01.md § 7.
 *
 * All time-of-day boundaries use Europe/Moscow.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

const MSK_OFFSET_MS = 3 * 60 * 60 * 1000

export interface HealthSummary {
  server_time: string
  ingest: { finished_at: string | null; status: string } | null
  enrich: { finished_at: string | null; status: string; run_kind: string | null } | null
  digest: { digest_date: string | null; status: string; sent_at: string | null } | null
  alerts_open: number
  batches_open: number
  oldest_pending_age_minutes: number | null
  articles_published_today: number
  articles_rejected_today_by_reason: Record<string, number>
  cost_today_usd: number
  live_window_6h_count: number
  top_open_alerts: Array<{
    alert_type: string
    severity: string
    first_seen_at: string
    last_seen_at: string
    occurrence_count: number
    message: string
  }>
}

function startOfMskDayUtcIso(now: Date = new Date()): string {
  const msk = new Date(now.getTime() + MSK_OFFSET_MS)
  msk.setUTCHours(0, 0, 0, 0)
  return new Date(msk.getTime() - MSK_OFFSET_MS).toISOString()
}

function isoMinusHours(hours: number, now: Date = new Date()): string {
  return new Date(now.getTime() - hours * 60 * 60 * 1000).toISOString()
}

function mergeBreakdownPrefix(map: Record<string, number>, breakdown: Record<string, unknown> | null): void {
  if (!breakdown) return
  for (const [rawKey, rawValue] of Object.entries(breakdown)) {
    if (typeof rawValue !== 'number' || !Number.isFinite(rawValue)) continue
    const prefix = rawKey.split(':', 1)[0] ?? rawKey
    map[prefix] = (map[prefix] ?? 0) + rawValue
  }
}

export async function getHealthSummary(supabase: SupabaseClient): Promise<HealthSummary> {
  const now = new Date()
  const mskDayStart = startOfMskDayUtcIso(now)
  const sixHoursAgo = isoMinusHours(6, now)

  const [
    ingestRes,
    enrichRes,
    digestRes,
    alertsCountRes,
    batchesCountRes,
    oldestPendingRes,
    publishedTodayRes,
    rejectedRunsRes,
    costTodayRes,
    liveWindowRes,
    topAlertsRes,
  ] = await Promise.all([
    supabase
      .from('ingest_runs')
      .select('finished_at, status')
      .order('finished_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from('enrich_runs')
      .select('finished_at, status, run_kind')
      .order('finished_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from('digest_runs')
      .select('digest_date, status, sent_at')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from('pipeline_alerts')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'open'),
    supabase
      .from('anthropic_batches')
      .select('*', { count: 'exact', head: true })
      .eq('processing_status', 'in_progress'),
    supabase
      .from('articles')
      .select('created_at')
      .in('enrich_status', ['pending', 'retry_wait', 'processing'])
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle(),
    supabase
      .from('articles')
      .select('*', { count: 'exact', head: true })
      .eq('publish_status', 'live')
      .gte('published_at', mskDayStart),
    supabase
      .from('enrich_runs')
      .select('rejected_breakdown')
      .gte('finished_at', mskDayStart),
    supabase
      .from('llm_usage_logs')
      .select('estimated_cost_usd')
      .gte('created_at', mskDayStart),
    supabase
      .from('articles')
      .select('*', { count: 'exact', head: true })
      .eq('publish_status', 'live')
      .gte('published_at', sixHoursAgo),
    supabase
      .from('pipeline_alerts')
      .select('alert_type, severity, first_seen_at, last_seen_at, occurrence_count, message')
      .eq('status', 'open')
      .order('last_seen_at', { ascending: false })
      .limit(5),
  ])

  const oldestPendingAgeMinutes = oldestPendingRes.data?.created_at
    ? Math.round((now.getTime() - new Date(oldestPendingRes.data.created_at as string).getTime()) / 60_000)
    : null

  const rejectedBreakdownMerged: Record<string, number> = {}
  for (const row of rejectedRunsRes.data ?? []) {
    mergeBreakdownPrefix(rejectedBreakdownMerged, (row as { rejected_breakdown?: Record<string, unknown> | null }).rejected_breakdown ?? null)
  }

  const costToday = (costTodayRes.data ?? []).reduce<number>((sum, row) => {
    const value = Number((row as { estimated_cost_usd?: unknown }).estimated_cost_usd)
    return Number.isFinite(value) ? sum + value : sum
  }, 0)

  return {
    server_time: now.toISOString(),
    ingest: ingestRes.data ?? null,
    enrich: enrichRes.data ?? null,
    digest: digestRes.data ?? null,
    alerts_open: alertsCountRes.count ?? 0,
    batches_open: batchesCountRes.count ?? 0,
    oldest_pending_age_minutes: oldestPendingAgeMinutes,
    articles_published_today: publishedTodayRes.count ?? 0,
    articles_rejected_today_by_reason: rejectedBreakdownMerged,
    cost_today_usd: Math.round(costToday * 1_000_000) / 1_000_000,
    live_window_6h_count: liveWindowRes.count ?? 0,
    top_open_alerts: (topAlertsRes.data ?? []) as HealthSummary['top_open_alerts'],
  }
}

// Exposed for unit tests; keep stable to avoid silent contract drift.
export const _internals = {
  startOfMskDayUtcIso,
  isoMinusHours,
  mergeBreakdownPrefix,
}
