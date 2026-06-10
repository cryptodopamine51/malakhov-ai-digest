import { randomUUID } from 'crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Article } from '../lib/supabase'
import { leaseExpiresAt } from './types'

export const WORKER_ID = process.env.GITHUB_RUN_ID
  ? `gh-${process.env.GITHUB_RUN_ID}`
  : `local-${process.pid}`

/**
 * Дневной (MSK) кэп live-публикаций на один source_name.
 *
 * Зачем: без кэпа объёмный источник заливает ленту (2026-06-08/09: Habr AI = 51 из
 * 132 публикаций, 39%), что бьёт по читабельности и тематическому авторитету сайта.
 * Diversity-кэп Telegram-отбора сайт не защищает — этот защищает.
 *
 * Механика: кандидаты сверх квоты НЕ клеймятся и остаются pending — они будут
 * подобраны в день с меньшим потоком. 30-дневный средний темп Habr (~10/день)
 * примерно равен кэпу, поэтому бэклог не накапливается, а сглаживаются пики.
 */
export const SOURCE_DAILY_PUBLISH_CAP = Math.max(
  1,
  Number(process.env.SOURCE_DAILY_PUBLISH_CAP ?? '10') || 10,
)

const MSK_OFFSET_MS = 3 * 60 * 60 * 1000

function startOfMskDayUtcIso(now: Date = new Date()): string {
  const msk = new Date(now.getTime() + MSK_OFFSET_MS)
  msk.setUTCHours(0, 0, 0, 0)
  return new Date(msk.getTime() - MSK_OFFSET_MS).toISOString()
}

/**
 * Pure-фильтр: пропускает кандидатов, пока (уже опубликовано сегодня + уже
 * пропущено в этом батче) по их source_name не упирается в cap. Возвращает
 * кандидатов в исходном порядке.
 */
export function applySourceDailyCap<T extends { source_name: string | null }>(
  candidates: T[],
  publishedTodayBySource: Map<string, number>,
  cap: number = SOURCE_DAILY_PUBLISH_CAP,
): { allowed: T[]; skippedBySource: Map<string, number> } {
  const running = new Map<string, number>(publishedTodayBySource)
  const allowed: T[] = []
  const skippedBySource = new Map<string, number>()
  for (const candidate of candidates) {
    const source = candidate.source_name ?? ''
    if (!source) {
      allowed.push(candidate)
      continue
    }
    const used = running.get(source) ?? 0
    if (used >= cap) {
      skippedBySource.set(source, (skippedBySource.get(source) ?? 0) + 1)
      continue
    }
    running.set(source, used + 1)
    allowed.push(candidate)
  }
  return { allowed, skippedBySource }
}

async function loadPublishedTodayBySource(supabase: SupabaseClient): Promise<Map<string, number>> {
  const counts = new Map<string, number>()
  const { data, error } = await supabase
    .from('articles')
    .select('source_name')
    .eq('publish_status', 'live')
    .gte('published_at', startOfMskDayUtcIso())
    .limit(2000)
  if (error) {
    // Деградация мягкая: без счётчиков кэп не применяем (лучше перелив, чем простой).
    console.warn(`[claims] source cap counts query failed: ${error.message}`)
    return counts
  }
  for (const row of (data ?? []) as Array<{ source_name: string | null }>) {
    const source = row.source_name ?? ''
    if (!source) continue
    counts.set(source, (counts.get(source) ?? 0) + 1)
  }
  return counts
}

/**
 * Atomically claims up to `limit` articles ready for enrichment.
 *
 * Uses optimistic locking via UPDATE … WHERE claim_token IS NULL … RETURNING.
 * Two workers overfetching the same candidates will compete for each row —
 * only the first UPDATE wins; the other gets 0 rows and moves to the next candidate.
 * Safe for concurrent parallel runners.
 */
export async function claimBatch(
  supabase: SupabaseClient,
  limit: number,
): Promise<Article[]> {
  const claimToken = randomUUID()
  const expiresAt = leaseExpiresAt().toISOString()
  const now = new Date().toISOString()

  // Overfetch so that concurrent workers each find enough unclaimed candidates
  const overfetch = limit * 3
  const { data: candidates, error: selectError } = await supabase
    .from('articles')
    .select('id, source_name')
    .in('enrich_status', ['pending', 'retry_wait'])
    .or(`next_retry_at.is.null,next_retry_at.lte.${now}`)
    .is('claim_token', null)
    .order('created_at', { ascending: true })
    .limit(overfetch)

  if (selectError || !candidates?.length) return []

  // Дневной per-source кэп: кандидаты сверх квоты остаются pending до спокойного дня.
  const publishedToday = await loadPublishedTodayBySource(supabase)
  const { allowed, skippedBySource } = applySourceDailyCap(
    candidates as Array<{ id: string; source_name: string | null }>,
    publishedToday,
  )
  for (const [source, skipped] of skippedBySource) {
    console.log(
      `[claims] source daily cap (${SOURCE_DAILY_PUBLISH_CAP}): skipped ${skipped} candidate(s) from "${source}"`,
    )
  }

  const claimed: Article[] = []

  for (const candidate of allowed) {
    if (claimed.length >= limit) break

    // Atomic update: WHERE clause guarantees only one worker wins per article.
    // If another worker already claimed this id, enrich_status or claim_token
    // won't match and Supabase returns 0 rows (PGRST116 / null data).
    const { data: updated, error: updateError } = await supabase
      .from('articles')
      .update({
        enrich_status: 'processing',
        processing_by: WORKER_ID,
        claim_token: claimToken,
        lease_expires_at: expiresAt,
        processing_started_at: now,
        updated_at: now,
      })
      .eq('id', candidate.id)
      .in('enrich_status', ['pending', 'retry_wait'])
      .is('claim_token', null)
      .select('*')
      .maybeSingle() // maybeSingle avoids throwing on 0 rows

    if (!updateError && updated) {
      claimed.push(updated as Article)
    }
  }

  if (claimed.length > 0 && claimed.length < limit / 2) {
    console.warn(
      `[claims] Low yield: claimed ${claimed.length}/${limit} requested. ` +
      `High contention or small queue.`
    )
  }

  return claimed
}

/**
 * Writes status updates back to an article and clears the claim lease.
 * All enrichment outcomes (ok, retry, fail, reject) go through here.
 */
export async function releaseClaim(
  supabase: SupabaseClient,
  articleId: string,
  expectedClaimToken: string | null,
  updates: Record<string, unknown>,
): Promise<boolean> {
  if (!expectedClaimToken) {
    console.error(`[claims] releaseClaim skipped for ${articleId}: missing claim token`)
    return false
  }

  const { data: released, error } = await supabase
    .from('articles')
    .update({
      ...updates,
      claim_token: null,
      processing_by: null,
      lease_expires_at: null,
      processing_finished_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', articleId)
    .eq('claim_token', expectedClaimToken)
    .select('id')
    .maybeSingle()

  if (error) {
    console.error(`[claims] releaseClaim failed for ${articleId}: ${error.message}`)
    return false
  }

  if (!released) {
    console.warn(`[claims] stale claim detected for ${articleId}; release skipped`)
    return false
  }

  return true
}

/**
 * Transfers article ownership from the short-lived article lease to a persisted
 * batch item linkage. The article stays in `processing`, but the lease is cleared.
 */
export async function handoffClaimToBatch(
  supabase: SupabaseClient,
  articleId: string,
  expectedClaimToken: string | null,
  updates: Record<string, unknown>,
): Promise<boolean> {
  if (!expectedClaimToken) {
    console.error(`[claims] handoffClaimToBatch skipped for ${articleId}: missing claim token`)
    return false
  }

  const { data: handedOff, error } = await supabase
    .from('articles')
    .update({
      ...updates,
      enrich_status: 'processing',
      claim_token: null,
      processing_by: null,
      lease_expires_at: null,
      processing_finished_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', articleId)
    .eq('claim_token', expectedClaimToken)
    .select('id')
    .maybeSingle()

  if (error) {
    console.error(`[claims] handoffClaimToBatch failed for ${articleId}: ${error.message}`)
    return false
  }

  if (!handedOff) {
    console.warn(`[claims] stale claim detected for ${articleId}; batch handoff skipped`)
    return false
  }

  return true
}
