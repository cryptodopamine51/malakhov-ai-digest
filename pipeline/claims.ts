import { randomUUID } from 'crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Article } from '../lib/supabase'
import { leaseExpiresAt } from './types'

export const WORKER_ID = process.env.GITHUB_RUN_ID
  ? `gh-${process.env.GITHUB_RUN_ID}`
  : `local-${process.pid}`

/**
 * Atomically claims up to `limit` articles ready for enrichment.
 * Uses UPDATE … WHERE … RETURNING to prevent race conditions between parallel workers.
 */
export async function claimBatch(
  supabase: SupabaseClient,
  limit: number,
): Promise<Article[]> {
  const claimToken = randomUUID()
  const expiresAt = leaseExpiresAt().toISOString()
  const now = new Date().toISOString()

  // PostgreSQL: UPDATE with subquery selects only unclaimed rows, sets lease atomically
  const { data, error } = await supabase.rpc('claim_enrich_batch', {
    p_worker_id: WORKER_ID,
    p_claim_token: claimToken,
    p_lease_expires_at: expiresAt,
    p_processing_started_at: now,
    p_limit: limit,
  })

  if (error) {
    // RPC not yet deployed — fall back to sequential claim
    return claimSequential(supabase, limit, claimToken, expiresAt, now)
  }

  return (data as Article[]) ?? []
}

/**
 * Fallback: claim articles one by one with optimistic locking.
 * Less efficient but safe without the RPC function.
 */
async function claimSequential(
  supabase: SupabaseClient,
  limit: number,
  claimToken: string,
  expiresAt: string,
  now: string,
): Promise<Article[]> {
  // Select candidates (not yet claimed)
  const { data: candidates, error: selectError } = await supabase
    .from('articles')
    .select('id')
    .in('enrich_status', ['pending', 'retry_wait'])
    .or(`next_retry_at.is.null,next_retry_at.lte.${now}`)
    .is('claim_token', null)
    .order('created_at', { ascending: true })
    .limit(limit * 2) // overfetch to handle races

  if (selectError || !candidates?.length) return []

  const claimed: Article[] = []

  for (const candidate of candidates) {
    if (claimed.length >= limit) break

    // Atomic update: only succeeds if still unclaimed
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
      .single()

    if (!updateError && updated) {
      claimed.push(updated as Article)
    }
  }

  return claimed
}

/**
 * Releases the claim on an article (sets claim_token to null).
 * Used when returning an article to retry_wait or failed state.
 */
export async function releaseClaim(
  supabase: SupabaseClient,
  articleId: string,
  updates: Record<string, unknown>,
): Promise<void> {
  await supabase
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
}
