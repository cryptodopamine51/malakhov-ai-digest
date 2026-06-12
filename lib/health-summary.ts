/**
 * lib/health-summary.ts
 *
 * Single source of truth for /api/health and /internal/dashboard data shape.
 * See docs/spec_observability_publication_2026-05-01.md § 7.
 *
 * All time-of-day boundaries use Europe/Moscow.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { getEnrichBacklogSnapshot } from './enrich-backlog'
import { getMoscowDateKey } from './utils'

const MSK_OFFSET_MS = 3 * 60 * 60 * 1000

export interface HealthSummary {
  server_time: string
  ingest: { finished_at: string | null; status: string } | null
  enrich: { finished_at: string | null; status: string; run_kind: string | null } | null
  telegram: TelegramDeliveryHealth | null
  // Legacy single-message digest signal; kept for backward-compatible health consumers.
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

type DigestHealthRow = { digest_date: string | null; status: string; sent_at: string | null }
type TelegramPostHealthRow = {
  delivery_date: string | null
  slot_no: number | null
  status: string
  sent_at: string | null
  created_at: string | null
}

export interface TelegramDeliveryHealth {
  delivery_date: string | null
  status: string
  slots_success: number
  slots_failed: number
  slots_planned: number
  slots_total: number
  sent_at: string | null
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
    const prefix = normalizeRejectReasonKey(rawKey)
    map[prefix] = (map[prefix] ?? 0) + rawValue
  }
}

function normalizeRejectReasonKey(rawKey: string): string {
  const prefix = rawKey.split(':', 1)[0] ?? rawKey
  if (prefix.length > 48 || /\s/.test(prefix)) return 'quality_reject'
  return prefix
}

export async function getHealthSummary(supabase: SupabaseClient): Promise<HealthSummary> {
  const now = new Date()
  const mskDayStart = startOfMskDayUtcIso(now)
  const sixHoursAgo = isoMinusHours(6, now)

  const [
    ingestRes,
    enrichRes,
    telegramRowsRes,
    digestRowsRes,
    alertsCountRes,
    batchesCountRes,
    enrichBacklog,
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
      .from('telegram_channel_posts')
      .select('delivery_date, slot_no, status, sent_at, created_at')
      .order('delivery_date', { ascending: false })
      .order('slot_no', { ascending: false })
      .limit(20),
    supabase
      .from('digest_runs')
      .select('digest_date, status, sent_at')
      .order('created_at', { ascending: false })
      .limit(10),
    supabase
      .from('pipeline_alerts')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'open'),
    supabase
      .from('anthropic_batches')
      .select('*', { count: 'exact', head: true })
      .eq('processing_status', 'in_progress'),
    getEnrichBacklogSnapshot(supabase, now),
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

  const rejectedBreakdownMerged: Record<string, number> = {}
  for (const row of rejectedRunsRes.data ?? []) {
    mergeBreakdownPrefix(rejectedBreakdownMerged, (row as { rejected_breakdown?: Record<string, unknown> | null }).rejected_breakdown ?? null)
  }

  const costToday = (costTodayRes.data ?? []).reduce<number>((sum, row) => {
    const value = Number((row as { estimated_cost_usd?: unknown }).estimated_cost_usd)
    return Number.isFinite(value) ? sum + value : sum
  }, 0)

  const telegramRows = rowsOrEmpty<TelegramPostHealthRow>(telegramRowsRes)
  const telegram = selectRepresentativeTelegramDelivery(telegramRows, getMoscowDateKey(now))
  const digestRows = (digestRowsRes.data ?? []) as DigestHealthRow[]
  const digest = selectRepresentativeDigestRun(digestRows)

  return {
    server_time: now.toISOString(),
    ingest: ingestRes.data ?? null,
    enrich: enrichRes.data ?? null,
    telegram,
    digest,
    alerts_open: alertsCountRes.count ?? 0,
    batches_open: batchesCountRes.count ?? 0,
    oldest_pending_age_minutes: enrichBacklog.oldestActionableAgeMinutes,
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
  normalizeRejectReasonKey,
  selectRepresentativeDigestRun,
  selectRepresentativeTelegramDelivery,
}

function selectRepresentativeDigestRun(rows: DigestHealthRow[]): DigestHealthRow | null {
  const latest = rows[0] ?? null
  if (!latest) return null

  if (latest.status === 'skipped_already_claimed' && latest.digest_date) {
    const sameDateMeaningful = rows.find((row) =>
      row.digest_date === latest.digest_date && row.status !== 'skipped_already_claimed'
    )
    if (sameDateMeaningful) return sameDateMeaningful
  }

  return latest
}

function rowsOrEmpty<T>(response: unknown): T[] {
  const typed = response as { data?: T[] | null; error?: { message?: string; code?: string } | null }
  if (typed.error) return []
  return typed.data ?? []
}

function selectRepresentativeTelegramDelivery(
  rows: TelegramPostHealthRow[],
  today: string,
): TelegramDeliveryHealth | null {
  const scoped = rows.filter((row) => row.delivery_date === today)
  const targetRows = scoped.length > 0 ? scoped : rows.filter((row) => row.delivery_date === rows[0]?.delivery_date)
  if (targetRows.length === 0) return null

  const success = targetRows.filter((row) => row.status === 'success')
  const failed = targetRows.filter((row) => row.status.startsWith('failed'))
  const planned = targetRows.filter((row) => row.status === 'planned' || row.status === 'sending')
  const skippedLow = targetRows.filter((row) => row.status === 'skipped_low_articles')
  const latest = [...targetRows].sort((a, b) =>
    String(b.sent_at ?? b.created_at ?? '').localeCompare(String(a.sent_at ?? a.created_at ?? '')),
  )[0]

  let status = latest?.status ?? 'unknown'
  if (failed.length > 0) status = 'failed'
  else if (success.length >= 5) status = 'success'
  else if (success.length > 0) status = 'partial_success'
  else if (skippedLow.length > 0) status = 'skipped_low_articles'
  else if (planned.length > 0) status = 'planned'

  return {
    delivery_date: targetRows[0]?.delivery_date ?? null,
    status,
    slots_success: success.length,
    slots_failed: failed.length,
    slots_planned: planned.length,
    slots_total: targetRows.length,
    sent_at: success
      .map((row) => row.sent_at)
      .filter((value): value is string => Boolean(value))
      .sort()
      .at(-1) ?? null,
  }
}
