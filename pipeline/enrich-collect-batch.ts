import { config } from 'dotenv'
import { resolve } from 'path'
import { pathToFileURL } from 'url'
config({ path: resolve(process.cwd(), '.env.local') })

import type { SupabaseClient } from '@supabase/supabase-js'
import { getServerClient, type AnthropicBatchItem, type Article } from '../lib/supabase'
import { listBatchResults, parseBatchCustomId, retrieveBatch, type NormalizedBatchResult } from './anthropic-batch'
import { ensureUniqueSlug } from './slug'
import { parseEditorialJson, validateEditorial } from './claude'
import { articleHasCategory } from './scorer.config'
import { createEnrichRun, finishEnrichRun, getOldestPendingAgeMinutes, log, writeEnrichAttempt } from './enrich-runtime'
import { fireAlert } from './alerts'
import { isExhausted, isRetryable, nextRetryAt, type ErrorCode } from './types'
import { addUsageTotals, formatUsageSummary, refreshAnthropicBatchUsageTotals, writeLlmUsageLog, ZERO_USAGE_TOTALS, type UsageTotals } from './llm-usage'

const BATCH_POLL_LIMIT = Number(process.env.ANTHROPIC_BATCH_POLL_LIMIT ?? 10)
const APPLY_READY_LIMIT = Number(process.env.ANTHROPIC_BATCH_APPLY_LIMIT ?? 50)

function mapBatchItemErrorCode(result: NormalizedBatchResult): ErrorCode {
  if (result.resultType === 'expired') return 'batch_expired'
  if (result.resultType === 'canceled') return 'batch_canceled'
  if (result.errorCode?.includes('rate_limit')) return 'claude_rate_limit'
  return 'claude_api_error'
}

async function getArticle(supabase: SupabaseClient, articleId: string): Promise<Article | null> {
  const { data, error } = await supabase
    .from('articles')
    .select('*')
    .eq('id', articleId)
    .maybeSingle()

  if (error) throw new Error(`article fetch failed: ${error.message}`)
  return (data ?? null) as Article | null
}

async function markApplyFailure(
  supabase: SupabaseClient,
  itemId: string,
  code: string,
  message: string,
  status: 'apply_failed_retriable' | 'apply_failed_terminal',
): Promise<void> {
  await supabase
    .from('anthropic_batch_items')
    .update({
      status,
      last_apply_error_code: code,
      last_apply_error: message,
      updated_at: new Date().toISOString(),
    })
    .eq('id', itemId)
}

async function finalizeBatchFailure(
  supabase: SupabaseClient,
  item: Pick<AnthropicBatchItem, 'id' | 'article_id' | 'submitted_at' | 'created_at'>,
  article: Article | null,
  runId: string,
  result: { errorCode: ErrorCode; errorMessage: string; itemStatus?: string },
): Promise<'retryable' | 'failed'> {
  if (!article) {
    await markApplyFailure(supabase, item.id, 'missing_article', 'article not found for batch item', 'apply_failed_terminal')
    return 'failed'
  }

  if (article.current_batch_item_id !== item.id && article.enrich_status !== 'processing') {
    return article.enrich_status === 'retry_wait' ? 'retryable' : 'failed'
  }

  const attemptCount = (article.attempt_count ?? 0) + 1
  const retryable = isRetryable(result.errorCode) && !isExhausted(attemptCount)
  const targetStatus = retryable ? 'retry_wait' : 'failed'
  const startedAt = new Date(item.submitted_at ?? item.created_at ?? new Date().toISOString())

  await supabase
    .from('anthropic_batch_items')
    .update({
      status: result.itemStatus ?? 'batch_failed',
      error_code: result.errorCode,
      error_message: result.errorMessage,
      updated_at: new Date().toISOString(),
    })
    .eq('id', item.id)

  await supabase
    .from('articles')
    .update({
      enrich_status: targetStatus,
      publish_status: 'draft',
      attempt_count: attemptCount,
      next_retry_at: retryable ? nextRetryAt(attemptCount).toISOString() : null,
      current_batch_item_id: null,
      claim_token: null,
      processing_by: null,
      lease_expires_at: null,
      processing_finished_at: new Date().toISOString(),
      last_error: result.errorMessage,
      last_error_code: result.errorCode,
      enriched: !retryable,
      published: false,
      quality_ok: false,
      quality_reason: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', article.id)

  await writeEnrichAttempt(supabase, {
    articleId: article.id,
    batchItemId: item.id,
    attemptNo: attemptCount,
    startedAt,
    resultStatus: retryable ? 'retryable' : 'failed',
    errorCode: result.errorCode,
    errorMessage: result.errorMessage,
    payload: { run_id: runId, phase: 'collect' },
  })

  return retryable ? 'retryable' : 'failed'
}

async function importBatchResults(
  supabase: SupabaseClient,
  runId: string,
  batchRow: { id: string; provider_batch_id: string },
): Promise<{ retryable: number; failed: number; usage: UsageTotals }> {
  const imported = await listBatchResults(batchRow.provider_batch_id)
  let retryable = 0
  let failed = 0
  let usage = ZERO_USAGE_TOTALS

  for (const result of imported) {
    const responsePayload = {
      output_text: result.outputText,
      raw_result: result.raw,
    }

    const updatePayload = {
      result_type: result.resultType,
      response_payload: responsePayload,
      result_imported_at: new Date().toISOString(),
      input_tokens: result.inputTokens,
      output_tokens: result.outputTokens,
      cache_read_tokens: result.cacheReadTokens,
      cache_creation_tokens: result.cacheCreateTokens,
      estimated_cost_usd: result.estimatedCostUsd,
      error_code: result.errorCode,
      error_message: result.errorMessage,
      status: result.resultType === 'succeeded' ? 'batch_result_ready' : 'batch_failed',
      updated_at: new Date().toISOString(),
    }

    let { data: itemRow, error: itemError } = await supabase
      .from('anthropic_batch_items')
      .update(updatePayload)
      .eq('request_custom_id', result.customId)
      .is('result_imported_at', null)
      .neq('status', 'applied')
      .select('*')
      .maybeSingle()

    if (!itemError && !itemRow) {
      const parsedCustomId = parseBatchCustomId(result.customId)
      if (parsedCustomId?.batchItemId) {
        const fallback = await supabase
          .from('anthropic_batch_items')
          .update(updatePayload)
          .eq('id', parsedCustomId.batchItemId)
          .is('result_imported_at', null)
          .neq('status', 'applied')
          .select('*')
          .maybeSingle()
        itemRow = fallback.data
        itemError = fallback.error
      }
    }

    if (itemError || !itemRow) continue

    const requestPayload = (itemRow.request_payload ?? {}) as Record<string, unknown>
    const articleContext = ((requestPayload.article_context ?? {}) as Record<string, unknown>)
    const importedAt = itemRow.result_imported_at ?? new Date().toISOString()

    await writeLlmUsageLog({
      supabase,
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
      operation: 'editorial_batch_result',
      runKind: 'batch_collect',
      enrichRunId: runId,
      articleId: itemRow.article_id,
      batchItemId: itemRow.id,
      sourceName: articleContext.source_name ? String(articleContext.source_name) : null,
      sourceLang: articleContext.source_lang ? String(articleContext.source_lang) : null,
      originalTitle: articleContext.original_title ? String(articleContext.original_title) : null,
      resultStatus: result.resultType === 'succeeded' ? 'ok' : mapBatchItemErrorCode(result),
      metadata: {
        provider_batch_id: batchRow.provider_batch_id,
        result_type: result.resultType,
      },
      createdAt: importedAt,
      usage: {
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        cacheReadTokens: result.cacheReadTokens,
        cacheCreateTokens: result.cacheCreateTokens,
        estimatedCostUsd: result.estimatedCostUsd,
      },
    })

    usage = addUsageTotals(usage, {
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      cacheReadTokens: result.cacheReadTokens,
      cacheCreateTokens: result.cacheCreateTokens,
      estimatedCostUsd: result.estimatedCostUsd,
    })

    if (result.resultType !== 'succeeded') {
      const article = await getArticle(supabase, itemRow.article_id)
      const outcome = await finalizeBatchFailure(
        supabase,
        itemRow as AnthropicBatchItem,
        article,
        runId,
        {
          errorCode: mapBatchItemErrorCode(result),
          errorMessage: result.errorMessage ?? `${result.resultType} batch item`,
        },
      )
      if (outcome === 'retryable') retryable++
      else failed++
    }
  }

  await refreshAnthropicBatchUsageTotals(supabase, batchRow.id)

  return { retryable, failed, usage }
}

async function applyReadyResults(
  supabase: SupabaseClient,
  runId: string,
): Promise<{ enrichedOk: number; rejected: number; retryable: number; failed: number }> {
  const metrics = { enrichedOk: 0, rejected: 0, retryable: 0, failed: 0 }
  const { data: items, error } = await supabase
    .from('anthropic_batch_items')
    .select('*')
    .in('status', ['batch_result_ready', 'apply_failed_retriable', 'applying'])
    .order('updated_at', { ascending: true })
    .limit(APPLY_READY_LIMIT)

  if (error || !items?.length) return metrics

  for (const item of items as AnthropicBatchItem[]) {
    const article = await getArticle(supabase, item.article_id)
    if (!article) {
      await markApplyFailure(supabase, item.id, 'missing_article', 'article not found for apply', 'apply_failed_terminal')
      metrics.failed++
      continue
    }

    const responsePayload = (item.response_payload ?? {}) as Record<string, unknown>
    const outputText = typeof responsePayload.output_text === 'string' ? responsePayload.output_text : null
    if (!outputText) {
      const outcome = await finalizeBatchFailure(
        supabase,
        item,
        article,
        runId,
        {
          errorCode: 'claude_parse_failed',
          errorMessage: 'missing output_text in batch response_payload',
          itemStatus: 'apply_failed_terminal',
        },
      )
      if (outcome === 'retryable') metrics.retryable++
      else metrics.failed++
      continue
    }

    const editorial = parseEditorialJson(outputText)
    if (!editorial) {
      const outcome = await finalizeBatchFailure(
        supabase,
        item,
        article,
        runId,
        {
          errorCode: 'claude_parse_failed',
          errorMessage: 'failed to parse editorial json from batch item',
          itemStatus: 'apply_failed_terminal',
        },
      )
      if (outcome === 'retryable') metrics.retryable++
      else metrics.failed++
      continue
    }

    if (!editorial.glossary) editorial.glossary = []
    if (!editorial.link_anchors) editorial.link_anchors = []

    const validationError = validateEditorial(editorial)
    if (validationError) {
      const outcome = await finalizeBatchFailure(
        supabase,
        item,
        article,
        runId,
        {
          errorCode: 'claude_parse_failed',
          errorMessage: `editorial validation failed: ${validationError}`,
          itemStatus: 'apply_failed_terminal',
        },
      )
      if (outcome === 'retryable') metrics.retryable++
      else metrics.failed++
      continue
    }

    const requestPayload = item.request_payload as Record<string, unknown>
    const articleContext = ((requestPayload.article_context ?? {}) as Record<string, unknown>)
    const generatedTables = Array.isArray(editorial.article_tables) && editorial.article_tables.length > 0
      ? editorial.article_tables
      : null
    if (articleHasCategory(article, 'ai-research') && editorial.editorial_body.length < 1500) {
      editorial.quality_ok = false
      editorial.quality_reason = `research_too_short: ${editorial.editorial_body.length}`
    }
    const slug = await ensureUniqueSlug(
      supabase,
      editorial.ru_title || article.original_title,
      article.id,
    )

    const rpcParams = {
      p_batch_item_id: item.id,
      p_enrich_status: editorial.quality_ok ? 'enriched_ok' : 'rejected',
      p_publish_status: editorial.quality_ok ? 'publish_ready' : 'draft',
      p_score: Number(articleContext.score ?? article.score ?? 0),
      p_cover_image_url: articleContext.cover_image_url ?? article.cover_image_url,
      p_original_text: articleContext.original_text ?? article.original_text,
      p_ru_title: editorial.ru_title,
      p_lead: editorial.lead,
      p_summary: editorial.summary,
      p_card_teaser: editorial.card_teaser,
      p_tg_teaser: editorial.tg_teaser,
      p_editorial_body: editorial.editorial_body,
      p_editorial_model: 'claude-sonnet-4-6',
      p_glossary: editorial.glossary,
      p_link_anchors: editorial.link_anchors,
      p_article_tables: generatedTables ?? articleContext.article_tables ?? null,
      p_article_images: articleContext.article_images ?? null,
      p_article_videos: articleContext.article_videos ?? null,
      p_quality_ok: editorial.quality_ok,
      p_quality_reason: editorial.quality_reason || '',
      p_slug: slug,
      p_publish_ready_at: editorial.quality_ok ? new Date().toISOString() : null,
      p_result_status: editorial.quality_ok ? 'ok' : 'rejected',
      p_error_code: null,
      p_error_message: null,
    }

    const { data, error: rpcError } = await supabase.rpc('apply_anthropic_batch_item_result', rpcParams)

    if (rpcError) {
      await markApplyFailure(supabase, item.id, 'batch_apply_failed', rpcError.message, 'apply_failed_retriable')
      metrics.retryable++
      continue
    }

    const rpcRow = Array.isArray(data) ? data[0] : data
    if (!rpcRow) {
      await markApplyFailure(supabase, item.id, 'batch_apply_failed', 'rpc returned empty payload', 'apply_failed_retriable')
      metrics.retryable++
      continue
    }

    if (rpcRow.state === 'applied' || rpcRow.applied === true) {
      if (editorial.quality_ok) metrics.enrichedOk++
      else metrics.rejected++
      continue
    }

    if (rpcRow.state === 'already_applied' || rpcRow.noop === true) {
      continue
    }

    await markApplyFailure(supabase, item.id, 'batch_apply_failed', `unexpected rpc state: ${rpcRow.state}`, 'apply_failed_retriable')
    metrics.retryable++
  }

  return metrics
}

async function pollBatches(
  supabase: SupabaseClient,
  runId: string,
): Promise<{ retryable: number; failed: number; usage: UsageTotals }> {
  const { data: batches, error } = await supabase
    .from('anthropic_batches')
    .select('id, provider_batch_id, processing_status, poll_attempts')
    .in('status', ['submitted', 'partial', 'completed', 'failed'])
    .order('last_polled_at', { ascending: true })
    .limit(BATCH_POLL_LIMIT)

  if (error || !batches?.length) return { retryable: 0, failed: 0, usage: ZERO_USAGE_TOTALS }

  let retryable = 0
  let failed = 0
  let usage = ZERO_USAGE_TOTALS

  for (const batchRow of batches as Array<{ id: string; provider_batch_id: string; processing_status: string; poll_attempts: number }>) {
    const remote = await retrieveBatch(batchRow.provider_batch_id)
    const counts = remote.request_counts
    const failedCount = (counts.errored ?? 0) + (counts.expired ?? 0) + (counts.canceled ?? 0)
    const status = remote.processing_status === 'ended'
      ? (failedCount === 0 ? 'completed' : counts.succeeded > 0 ? 'partial' : 'failed')
      : 'submitted'

    await supabase
      .from('anthropic_batches')
      .update({
        status,
        processing_status: remote.processing_status,
        finished_at: remote.ended_at,
        expires_at: remote.expires_at,
        archived_at: remote.archived_at,
        cancel_initiated_at: remote.cancel_initiated_at,
        results_url: remote.results_url,
        last_polled_at: new Date().toISOString(),
        poll_attempts: (batchRow.poll_attempts ?? 0) + 1,
        request_count: counts.processing + counts.succeeded + counts.errored + counts.expired + counts.canceled,
        success_count: counts.succeeded,
        failed_count: failedCount,
        errored_count: counts.errored,
        expired_count: counts.expired,
        canceled_count: counts.canceled,
        updated_at: new Date().toISOString(),
      })
      .eq('id', batchRow.id)

    if (remote.processing_status !== 'ended') {
      await supabase
        .from('anthropic_batch_items')
        .update({ status: 'batch_processing', updated_at: new Date().toISOString() })
        .eq('batch_id', batchRow.id)
        .eq('status', 'batch_submitted')
      continue
    }

    const imported = await importBatchResults(supabase, runId, batchRow)
    retryable += imported.retryable
    failed += imported.failed
    usage = addUsageTotals(usage, imported.usage)
  }

  return { retryable, failed, usage }
}

export async function runEnrichCollectBatch(): Promise<void> {
  log('=== Запуск enrich-collect-batch.ts ===')
  const supabase = getServerClient()
  const runId = await createEnrichRun(supabase, APPLY_READY_LIMIT, 'batch_collect')
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

  try {
    const imported = await pollBatches(supabase, runId)
    metrics.retryable += imported.retryable
    metrics.failed += imported.failed
    metrics.usage = addUsageTotals(metrics.usage, imported.usage)

    const applied = await applyReadyResults(supabase, runId)
    metrics.enrichedOk += applied.enrichedOk
    metrics.rejected += applied.rejected
    metrics.retryable += applied.retryable
    metrics.failed += applied.failed
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    metrics.failed++
    metrics.errorSummary = message
    await fireAlert({
      supabase,
      alertType: 'batch_collect_failed',
      severity: 'critical',
      entityKey: `run:${runId}`,
      message,
      payload: { runId },
      botToken: process.env.TELEGRAM_BOT_TOKEN,
      adminChatId: process.env.TELEGRAM_ADMIN_CHAT_ID,
    })
  }

  metrics.errorSummary = metrics.errorSummary ??
    `applied_ok=${metrics.enrichedOk}; rejected=${metrics.rejected}; retryable=${metrics.retryable}; failed=${metrics.failed}; ${formatUsageSummary(metrics.usage)}`
  await finishEnrichRun(supabase, runId, metrics)
  log(`Applied OK: ${metrics.enrichedOk}`)
  log(`Applied rejected: ${metrics.rejected}`)
  log(`Retryable: ${metrics.retryable}`)
  log(`Failed: ${metrics.failed}`)
  log('=== enrich-collect-batch.ts завершён ===')
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runEnrichCollectBatch().catch((error: unknown) => {
    const msg = error instanceof Error ? error.message : String(error)
    console.error(`[${new Date().toTimeString().slice(0, 8)}] КРИТИЧЕСКАЯ ОШИБКА: ${msg}`)
    process.exit(1)
  })
}
