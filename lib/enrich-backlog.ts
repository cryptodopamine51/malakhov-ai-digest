import type { SupabaseClient } from '@supabase/supabase-js'

import { applySourceDailyCap, SOURCE_DAILY_PUBLISH_CAP } from './source-cap'

const MSK_OFFSET_MS = 3 * 60 * 60 * 1000
const BACKLOG_SCAN_LIMIT = 5_000

export interface EnrichBacklogCandidate {
  id: string
  source_name: string | null
  created_at: string
}

export interface EnrichBacklogSnapshot {
  totalDueCount: number
  actionableCount: number
  parkedBySourceCapCount: number
  parkedBySource: Array<{ source: string; count: number }>
  oldestActionableAgeMinutes: number | null
  oldestActionableCreatedAt: string | null
  sourceCap: number
}

function startOfMskDayUtcIso(now: Date): string {
  const msk = new Date(now.getTime() + MSK_OFFSET_MS)
  msk.setUTCHours(0, 0, 0, 0)
  return new Date(msk.getTime() - MSK_OFFSET_MS).toISOString()
}

export function summarizeEnrichBacklogCandidates(
  candidates: EnrichBacklogCandidate[],
  publishedTodayBySource: Map<string, number>,
  now: Date = new Date(),
  sourceCap = SOURCE_DAILY_PUBLISH_CAP,
): EnrichBacklogSnapshot {
  const { allowed, skippedBySource } = applySourceDailyCap(candidates, publishedTodayBySource, sourceCap)
  const oldestActionable = allowed[0] ?? null
  const parkedBySource = [...skippedBySource.entries()]
    .map(([source, count]) => ({ source, count }))
    .sort((a, b) => b.count - a.count || a.source.localeCompare(b.source))

  return {
    totalDueCount: candidates.length,
    actionableCount: allowed.length,
    parkedBySourceCapCount: candidates.length - allowed.length,
    parkedBySource,
    oldestActionableAgeMinutes: oldestActionable
      ? Math.round((now.getTime() - new Date(oldestActionable.created_at).getTime()) / 60_000)
      : null,
    oldestActionableCreatedAt: oldestActionable?.created_at ?? null,
    sourceCap,
  }
}

async function loadPublishedTodayBySource(
  supabase: SupabaseClient,
  now: Date,
): Promise<Map<string, number>> {
  const counts = new Map<string, number>()
  const { data, error } = await supabase
    .from('articles')
    .select('source_name')
    .eq('publish_status', 'live')
    .gte('published_at', startOfMskDayUtcIso(now))
    .limit(BACKLOG_SCAN_LIMIT)

  if (error) {
    console.warn(`[enrich-backlog] source cap counts query failed: ${error.message}`)
    return counts
  }

  for (const row of (data ?? []) as Array<{ source_name: string | null }>) {
    const source = row.source_name ?? ''
    if (!source) continue
    counts.set(source, (counts.get(source) ?? 0) + 1)
  }
  return counts
}

export async function getEnrichBacklogSnapshot(
  supabase: SupabaseClient,
  now: Date = new Date(),
): Promise<EnrichBacklogSnapshot> {
  const nowIso = now.toISOString()
  const [candidateRes, publishedTodayBySource] = await Promise.all([
    supabase
      .from('articles')
      .select('id, source_name, created_at', { count: 'exact' })
      .in('enrich_status', ['pending', 'retry_wait'])
      .or(`next_retry_at.is.null,next_retry_at.lte.${nowIso}`)
      .is('claim_token', null)
      .order('created_at', { ascending: true })
      .limit(BACKLOG_SCAN_LIMIT),
    loadPublishedTodayBySource(supabase, now),
  ])

  if (candidateRes.error) {
    throw new Error(`enrich backlog query failed: ${candidateRes.error.message}`)
  }

  const candidates = (candidateRes.data ?? []) as EnrichBacklogCandidate[]
  const snapshot = summarizeEnrichBacklogCandidates(candidates, publishedTodayBySource, now)
  return {
    ...snapshot,
    totalDueCount: candidateRes.count ?? snapshot.totalDueCount,
  }
}
