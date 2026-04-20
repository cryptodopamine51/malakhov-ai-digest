import { randomUUID } from 'crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Article } from '../lib/supabase'
import { leaseExpiresAt } from './types'

export const WORKER_ID = process.env.GITHUB_RUN_ID
  ? `gh-${process.env.GITHUB_RUN_ID}`
  : `local-${process.pid}`

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
    .select('id')
    .in('enrich_status', ['pending', 'retry_wait'])
    .or(`next_retry_at.is.null,next_retry_at.lte.${now}`)
    .is('claim_token', null)
    .order('created_at', { ascending: true })
    .limit(overfetch)

  if (selectError || !candidates?.length) return []

  const claimed: Article[] = []

  for (const candidate of candidates) {
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
  updates: Record<string, unknown>,
): Promise<void> {
  const { error } = await supabase
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

  if (error) {
    console.error(`[claims] releaseClaim failed for ${articleId}: ${error.message}`)
  }
}
