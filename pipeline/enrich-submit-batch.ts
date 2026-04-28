import { config } from 'dotenv'
import { resolve } from 'path'
import { pathToFileURL } from 'url'
config({ path: resolve(process.cwd(), '.env.local') })

import { randomUUID } from 'crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getServerClient, type Article } from '../lib/supabase'
import { buildBatchCustomId, buildBatchRequestParams, chunkBatchRequests, createEditorialBatch } from './anthropic-batch'
import { buildEditorialMessageParams } from './claude'
import { claimBatch, handoffClaimToBatch } from './claims'
import { writeEnrichAttempt, createEnrichRun, finishEnrichRun, getOldestPendingAgeMinutes, log } from './enrich-runtime'
import { fetchArticleContent } from './fetcher'
import { fireAlert } from './alerts'
import { scoreArticle } from './scorer'
import { articleHasCategory, getMinScoreForArticle } from './scorer.config'
import { isExhausted, isRetryable, nextRetryAt, type ErrorCode } from './types'
import { ZERO_USAGE_TOTALS } from './llm-usage'

const SUBMIT_BATCH_SIZE = Number(process.env.ENRICH_SUBMIT_BATCH_SIZE ?? 15)
const MAX_REQUESTS_PER_BATCH = Number(process.env.ANTHROPIC_BATCH_MAX_REQUESTS ?? 15)

interface StagedBatchItem {
  id: string
  article: Article
  attemptNo: number
  requestCustomId: string
  requestPayload: Record<string, unknown>
  params: ReturnType<typeof buildEditorialMessageParams>
}

function extractErrorDetails(error: unknown): { status: number | null; text: string } {
  const status = typeof error === 'object' && error !== null && 'status' in error
    ? Number((error as { status?: unknown }).status)
    : null
  const parts: string[] = []

  if (error instanceof Error) parts.push(error.message)
  if (error && typeof error === 'object') {
    const record = error as Record<string, unknown>
    for (const key of ['message', 'type']) {
      if (typeof record[key] === 'string') parts.push(record[key])
    }
    const providerError = record.error
    if (providerError && typeof providerError === 'object') {
      const providerRecord = providerError as Record<string, unknown>
      for (const key of ['message', 'type']) {
        if (typeof providerRecord[key] === 'string') parts.push(providerRecord[key])
      }
      const nestedError = providerRecord.error
      if (nestedError && typeof nestedError === 'object') {
        const nestedRecord = nestedError as Record<string, unknown>
        for (const key of ['message', 'type']) {
          if (typeof nestedRecord[key] === 'string') parts.push(nestedRecord[key])
        }
      }
    }
  }

  return { status: Number.isFinite(status) ? status : null, text: parts.join(' ') }
}

export function mapBatchCreateError(error: unknown): ErrorCode {
  const { status, text } = extractErrorDetails(error)
  if (status === 429) return 'claude_rate_limit'
  if (status === 400 && /invalid_request_error|invalid request|custom_id/i.test(text)) {
    return 'provider_invalid_request'
  }
  return 'claude_api_error'
}

export function getBatchSubmitFatalError(params: {
  stagedItems: number
  submittedItems: number
  fatalConsistencyError: string | null
}): string | null {
  if (params.fatalConsistencyError) return params.fatalConsistencyError
  if (params.stagedItems > 0 && params.submittedItems === 0) {
    return `batch submit produced zero provider batches for ${params.stagedItems} staged items`
  }
  return null
}

async function releasePreSubmitFailure(
  supabase: SupabaseClient,
  article: Article,
  runId: string,
  startedAt: Date,
  errorCode: ErrorCode,
  errorMessage: string,
  batchItemId?: string,
): Promise<'retryable' | 'failed'> {
  const attemptCount = (article.attempt_count ?? 0) + 1
  const exhausted = isExhausted(attemptCount)
  const retryable = isRetryable(errorCode) && !exhausted

  if (batchItemId) {
    await supabase
      .from('anthropic_batch_items')
      .update({
        status: 'batch_failed',
        error_code: errorCode,
        error_message: errorMessage,
        updated_at: new Date().toISOString(),
      })
      .eq('id', batchItemId)
  }

  await supabase
    .from('articles')
    .update({
      enrich_status: retryable ? 'retry_wait' : 'failed',
      publish_status: 'draft',
      attempt_count: attemptCount,
      next_retry_at: retryable ? nextRetryAt(attemptCount).toISOString() : null,
      current_batch_item_id: null,
      claim_token: null,
      processing_by: null,
      lease_expires_at: null,
      last_error: errorMessage,
      last_error_code: errorCode,
      processing_finished_at: new Date().toISOString(),
      enriched: !retryable,
      published: false,
      quality_ok: false,
      quality_reason: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', article.id)
    .eq('claim_token', article.claim_token ?? '')

  await writeEnrichAttempt(supabase, {
    articleId: article.id,
    attemptNo: attemptCount,
    startedAt,
    resultStatus: retryable ? 'retryable' : 'failed',
    claimToken: article.claim_token,
    batchItemId: batchItemId ?? null,
    errorCode,
    errorMessage,
    payload: { run_id: runId, phase: 'submit' },
  })

  return retryable ? 'retryable' : 'failed'
}

async function rejectBeforeSubmit(
  supabase: SupabaseClient,
  article: Article,
  runId: string,
  startedAt: Date,
  score: number,
  originalText: string,
  coverImageUrl: string | null,
  qualityReason: string,
  attemptMessage: string,
): Promise<void> {
  await supabase
    .from('articles')
    .update({
      enrich_status: 'rejected',
      publish_status: 'draft',
      score,
      original_text: originalText,
      cover_image_url: coverImageUrl,
      current_batch_item_id: null,
      claim_token: null,
      processing_by: null,
      lease_expires_at: null,
      processing_finished_at: new Date().toISOString(),
      enriched: true,
      published: false,
      quality_ok: false,
      quality_reason: qualityReason,
      updated_at: new Date().toISOString(),
    })
    .eq('id', article.id)
    .eq('claim_token', article.claim_token ?? '')

  await writeEnrichAttempt(supabase, {
    articleId: article.id,
    attemptNo: (article.attempt_count ?? 0) + 1,
    startedAt,
    resultStatus: 'rejected',
    claimToken: article.claim_token,
    errorCode: 'quality_reject',
    errorMessage: attemptMessage,
    payload: { run_id: runId, phase: 'submit' },
  })
}

async function stageBatchItem(
  supabase: SupabaseClient,
  article: Article,
  runId: string,
): Promise<{ item: StagedBatchItem | null; rejected: boolean; failure: 'retryable' | 'failed' | null }> {
  const startedAt = new Date()
  const { text, imageUrl, tables, inlineImages, inlineVideos, errorCode, errorMessage } = await fetchArticleContent(article.original_url)

  if (errorCode) {
    const failure = await releasePreSubmitFailure(
      supabase,
      article,
      runId,
      startedAt,
      errorCode,
      errorMessage ?? `fetch failed for ${article.original_url}`,
    )
    return { item: null, rejected: false, failure }
  }

  const hydratedArticle: Article = {
    ...article,
    original_text: text || article.original_text,
    cover_image_url: imageUrl || article.cover_image_url,
  }
  const score = scoreArticle(hydratedArticle)
  const minScore = getMinScoreForArticle(hydratedArticle)
  const coverImageUrl = imageUrl || article.cover_image_url

  if (articleHasCategory(hydratedArticle, 'ai-research') && !coverImageUrl && inlineImages.length === 0) {
    await rejectBeforeSubmit(
      supabase,
      article,
      runId,
      startedAt,
      score,
      text || article.original_text || '',
      coverImageUrl,
      'rejected_low_visual',
      'rejected_low_visual: research article has no cover or inline images',
    )
    log(`— rejected_low_visual [${score}]: ${article.original_title.slice(0, 60)}`)
    return { item: null, rejected: true, failure: null }
  }

  if (score < minScore) {
    await rejectBeforeSubmit(
      supabase,
      article,
      runId,
      startedAt,
      score,
      text || article.original_text || '',
      coverImageUrl,
      'low_score',
      `low_score: ${score}; min_score: ${minScore}`,
    )
    log(`— low_score [${score}/${minScore}]: ${article.original_title.slice(0, 60)}`)
    return { item: null, rejected: true, failure: null }
  }

  const attemptNo = (article.attempt_count ?? 0) + 1
  const batchItemId = randomUUID()
  const requestCustomId = buildBatchCustomId({
    articleId: article.id,
    attemptNo,
    batchItemId,
  })
  const params = buildBatchRequestParams(buildEditorialMessageParams({
    originalTitle: article.original_title,
    originalText: text || article.original_text || '',
    sourceName: article.source_name,
    sourceLang: article.source_lang,
    topics: article.topics ?? [],
    primaryCategory: article.primary_category,
    secondaryCategories: article.secondary_categories ?? [],
  }))

  const requestPayload = {
    params,
    article_context: {
      article_id: article.id,
      original_title: article.original_title,
      source_name: article.source_name,
      source_lang: article.source_lang,
      topics: article.topics ?? [],
      original_text: text || article.original_text || '',
      cover_image_url: imageUrl || article.cover_image_url,
      article_tables: tables,
      article_images: inlineImages,
      article_videos: inlineVideos,
      score,
      attempt_no: attemptNo,
    },
  }

  const { error: insertError } = await supabase
    .from('anthropic_batch_items')
    .insert({
      id: batchItemId,
      article_id: article.id,
      request_custom_id: requestCustomId,
      status: 'queued_for_batch',
      request_payload: requestPayload,
    })

  if (insertError) {
    const failure = await releasePreSubmitFailure(
      supabase,
      article,
      runId,
      startedAt,
      'unhandled_error',
      `batch item insert failed: ${insertError.message}`,
    )
    return { item: null, rejected: false, failure }
  }

  return {
    item: {
      id: batchItemId,
      article,
      attemptNo,
      requestCustomId,
      requestPayload,
      params,
    },
    rejected: false,
    failure: null,
  }
}

async function persistProviderBatch(
  supabase: SupabaseClient,
  runId: string,
  items: StagedBatchItem[],
): Promise<void> {
  const providerBatch = await createEditorialBatch(items.map((item) => ({
    articleId: item.article.id,
    attemptNo: item.attemptNo,
    batchItemId: item.id,
    params: item.params,
  })))

  const batchId = randomUUID()
  const insertedAt = new Date().toISOString()
  const { error: batchInsertError } = await supabase
    .from('anthropic_batches')
    .insert({
      id: batchId,
      run_id: runId,
      provider_batch_id: providerBatch.id,
      status: 'submitted',
      processing_status: providerBatch.processing_status,
      submitted_at: insertedAt,
      expires_at: providerBatch.expires_at,
      created_by: 'enrich-submit-batch',
      request_count: items.length,
      updated_at: insertedAt,
    })

  if (batchInsertError) {
    throw new Error(`provider batch created but anthropic_batches insert failed: ${batchInsertError.message}`)
  }

  const { error: itemUpdateError } = await supabase
    .from('anthropic_batch_items')
    .update({
      batch_id: batchId,
      status: 'batch_submitted',
      submitted_at: insertedAt,
      updated_at: insertedAt,
    })
    .in('id', items.map((item) => item.id))

  if (itemUpdateError) {
    throw new Error(`provider batch created but batch item mapping failed: ${itemUpdateError.message}`)
  }

  for (const item of items) {
    const context = item.requestPayload.article_context as Record<string, unknown>
    const handedOff = await handoffClaimToBatch(
      supabase,
      item.article.id,
      item.article.claim_token,
      {
        current_batch_item_id: item.id,
        score: context.score,
        original_text: context.original_text,
        cover_image_url: context.cover_image_url,
        last_error: null,
        last_error_code: null,
      },
    )

    if (!handedOff) {
      console.warn(`[submit-batch] batch handoff skipped for article ${item.article.id}`)
    }
  }
}

export async function runEnrichSubmitBatch(): Promise<void> {
  log('=== Запуск enrich-submit-batch.ts ===')

  const supabase = getServerClient()
  const runId = await createEnrichRun(supabase, SUBMIT_BATCH_SIZE, 'batch_submit')
  const oldestPendingAgeMinutes = await getOldestPendingAgeMinutes(supabase)
  const metrics = {
    claimed: 0,
    enrichedOk: 0,
    rejected: 0,
    retryable: 0,
    failed: 0,
    oldestPendingAgeMinutes,
    usage: ZERO_USAGE_TOTALS,
    errorSummary: null as string | null,
  }

  const claimedArticles = await claimBatch(supabase, SUBMIT_BATCH_SIZE)
  metrics.claimed = claimedArticles.length

  if (!claimedArticles.length) {
    log('Нет статей для batch submit')
    await finishEnrichRun(supabase, runId, metrics)
    return
  }

  const stagedItems: StagedBatchItem[] = []

  for (const article of claimedArticles) {
    const staged = await stageBatchItem(supabase, article, runId)
    if (staged.item) {
      stagedItems.push(staged.item)
    } else if (staged.rejected) {
      metrics.rejected++
    } else if (staged.failure === 'retryable') {
      metrics.retryable++
    } else if (staged.failure === 'failed') {
      metrics.failed++
    }
  }

  const chunks = chunkBatchRequests(stagedItems, MAX_REQUESTS_PER_BATCH)
  let submittedBatches = 0
  let submittedItems = 0
  let fatalConsistencyError: string | null = null

  for (const chunk of chunks) {
    try {
      await persistProviderBatch(supabase, runId, chunk)
      submittedBatches++
      submittedItems += chunk.length
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const errorCode = mapBatchCreateError(error)
      const providerInconsistency = message.includes('provider batch created but')

      await fireAlert({
        supabase,
        alertType: 'batch_submit_failed',
        severity: 'critical',
        entityKey: `run:${runId}`,
        message,
        payload: {
          runId,
          chunkSize: chunk.length,
        },
        botToken: process.env.TELEGRAM_BOT_TOKEN,
        adminChatId: process.env.TELEGRAM_ADMIN_CHAT_ID,
      })

      if (providerInconsistency) {
        fatalConsistencyError = message
        metrics.failed += chunk.length
        break
      }

      for (const item of chunk) {
        const failure = await releasePreSubmitFailure(
          supabase,
          item.article,
          runId,
          new Date(),
          errorCode,
          message,
          item.id,
        )
        if (failure === 'retryable') metrics.retryable++
        else metrics.failed++
      }
    }
  }

  const fatalSubmitError = getBatchSubmitFatalError({
    stagedItems: stagedItems.length,
    submittedItems,
    fatalConsistencyError,
  })

  metrics.errorSummary = fatalSubmitError ??
    `submitted_batches=${submittedBatches}; submitted_items=${submittedItems}; queued_items=${stagedItems.length}`
  await finishEnrichRun(supabase, runId, metrics)

  log(`Claimed: ${metrics.claimed}`)
  log(`Rejected before batch: ${metrics.rejected}`)
  log(`Submit retryable: ${metrics.retryable}`)
  log(`Submit failed: ${metrics.failed}`)
  log(`Submitted batches: ${submittedBatches}`)
  log(`Submitted items: ${submittedItems}`)
  if (fatalSubmitError) {
    throw new Error(fatalSubmitError)
  }
  log('=== enrich-submit-batch.ts завершён ===')
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runEnrichSubmitBatch().catch((error: unknown) => {
    const msg = error instanceof Error ? error.message : String(error)
    console.error(`[${new Date().toTimeString().slice(0, 8)}] КРИТИЧЕСКАЯ ОШИБКА: ${msg}`)
    process.exit(1)
  })
}
