import type { SupabaseClient } from '@supabase/supabase-js'
import type { ArticleAttemptStage } from '../lib/supabase'
import { WORKER_ID } from './claims'
import type { UsageTotals } from './llm-usage'
import { ZERO_USAGE_TOTALS } from './llm-usage'

export type EnrichRunKind = 'sync' | 'batch_submit' | 'batch_collect'

export interface EnrichRunMetrics {
  claimed: number
  enrichedOk: number
  rejected: number
  retryable: number
  failed: number
  oldestPendingAgeMinutes: number | null
  usage: UsageTotals
  errorSummary?: string | null
  // Migration 014: per-run agregator причин reject (pre-submit + post-collect).
  // Ключ — нормализованный quality_reason / reject code.
  rejectedBreakdown?: Record<string, number>
}

export interface WriteEnrichAttemptParams {
  articleId: string
  attemptNo: number
  startedAt: Date
  resultStatus: 'ok' | 'retryable' | 'rejected' | 'failed'
  claimToken?: string | null
  batchItemId?: string | null
  workerId?: string | null
  errorCode?: string | null
  errorMessage?: string | null
  payload?: Record<string, unknown>
}

export interface WriteArticleAttemptParams extends WriteEnrichAttemptParams {
  stage: ArticleAttemptStage
}

export interface WriteMediaSanitizeAttemptParams {
  articleId: string
  attemptNo: number
  startedAt: Date
  resultStatus: 'ok' | 'rejected'
  runId: string
  phase: 'submit' | 'collect'
  rejects: unknown[]
  remainingMedia: {
    coverImageUrl: boolean
    articleImages: number
  }
  claimToken?: string | null
  batchItemId?: string | null
  workerId?: string | null
  errorMessage?: string | null
}

export function log(msg: string): void {
  const ts = new Date().toTimeString().slice(0, 8)
  console.log(`[${ts}] ${msg}`)
}

export async function getOldestPendingAgeMinutes(supabase: SupabaseClient): Promise<number | null> {
  const { data: oldestPending } = await supabase
    .from('articles')
    .select('created_at')
    .eq('enrich_status', 'pending')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (!oldestPending?.created_at) return null
  return Math.round((Date.now() - new Date(oldestPending.created_at).getTime()) / 60_000)
}

export async function createEnrichRun(
  supabase: SupabaseClient,
  batchSize: number,
  runKind: EnrichRunKind,
): Promise<string> {
  const { data } = await supabase
    .from('enrich_runs')
    .insert({
      started_at: new Date().toISOString(),
      run_kind: runKind,
      status: 'running',
      batch_size: batchSize,
    })
    .select('id')
    .single()

  return data?.id ?? 'unknown'
}

export function resolveRunStatus(metrics: Pick<EnrichRunMetrics, 'enrichedOk' | 'retryable' | 'failed'>): 'ok' | 'partial' | 'failed' {
  if (metrics.failed > 0 && metrics.enrichedOk === 0) return 'failed'
  if (metrics.failed > 0 || metrics.retryable > 0) return 'partial'
  return 'ok'
}

export async function finishEnrichRun(
  supabase: SupabaseClient,
  runId: string,
  metrics: EnrichRunMetrics,
): Promise<void> {
  const usage = metrics.usage ?? ZERO_USAGE_TOTALS
  const baseUpdate = {
    finished_at: new Date().toISOString(),
    status: resolveRunStatus(metrics),
    articles_claimed: metrics.claimed,
    articles_enriched_ok: metrics.enrichedOk,
    articles_rejected: metrics.rejected,
    articles_retryable: metrics.retryable,
    articles_failed: metrics.failed,
    oldest_pending_age_minutes: metrics.oldestPendingAgeMinutes,
    error_summary: metrics.errorSummary ?? null,
  }

  const rejectedBreakdownPayload = metrics.rejectedBreakdown ?? {}

  const { error } = await supabase
    .from('enrich_runs')
    .update({
      ...baseUpdate,
      total_input_tokens: usage.inputTokens,
      total_output_tokens: usage.outputTokens,
      total_cache_read_tokens: usage.cacheReadTokens,
      total_cache_creation_tokens: usage.cacheCreateTokens,
      estimated_cost_usd: usage.estimatedCostUsd,
      rejected_breakdown: rejectedBreakdownPayload,
    })
    .eq('id', runId)

  if (!error) return

  const legacyColumnMismatch =
    error.message.includes('total_input_tokens') ||
    error.message.includes('total_output_tokens') ||
    error.message.includes('total_cache_read_tokens') ||
    error.message.includes('total_cache_creation_tokens') ||
    error.message.includes('estimated_cost_usd') ||
    error.message.includes('rejected_breakdown')

  if (!legacyColumnMismatch) {
    throw new Error(`enrich_runs update failed: ${error.message}`)
  }

  const { error: legacyError } = await supabase
    .from('enrich_runs')
    .update(baseUpdate)
    .eq('id', runId)

  if (legacyError) {
    throw new Error(`legacy enrich_runs update failed: ${legacyError.message}`)
  }
}

export async function writeArticleAttempt(
  supabase: SupabaseClient,
  params: WriteArticleAttemptParams,
): Promise<void> {
  const now = new Date()
  const { error } = await supabase.from('article_attempts').insert({
    article_id: params.articleId,
    batch_item_id: params.batchItemId ?? null,
    stage: params.stage,
    attempt_no: params.attemptNo,
    worker_id: params.workerId ?? WORKER_ID,
    claim_token: params.claimToken ?? null,
    started_at: params.startedAt.toISOString(),
    finished_at: now.toISOString(),
    duration_ms: now.getTime() - params.startedAt.getTime(),
    result_status: params.resultStatus,
    error_code: params.errorCode ?? null,
    error_message: params.errorMessage ?? null,
    payload: params.payload ?? {},
  })

  if (error && !(params.batchItemId && error.code === '23505')) {
    throw new Error(`article_attempts insert failed: ${error.message}`)
  }
}

export async function writeEnrichAttempt(
  supabase: SupabaseClient,
  params: WriteEnrichAttemptParams,
): Promise<void> {
  await writeArticleAttempt(supabase, { ...params, stage: 'enrich' })
}

export async function writeMediaSanitizeAttempt(
  supabase: SupabaseClient,
  params: WriteMediaSanitizeAttemptParams,
): Promise<void> {
  await writeArticleAttempt(supabase, {
    articleId: params.articleId,
    batchItemId: params.batchItemId ?? null,
    stage: 'media_sanitize',
    attemptNo: params.attemptNo,
    startedAt: params.startedAt,
    resultStatus: params.resultStatus,
    claimToken: params.claimToken ?? null,
    workerId: params.workerId ?? null,
    errorCode: params.resultStatus === 'rejected' ? 'media_sanitize_rejected' : null,
    errorMessage: params.errorMessage ?? null,
    payload: {
      run_id: params.runId,
      phase: params.phase,
      rejects: params.rejects,
      remaining_media: params.remainingMedia,
    },
  })
}
