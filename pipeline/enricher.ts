/**
 * pipeline/enricher.ts
 *
 * Этап 2 пайплайна: обогащение статей через Claude Sonnet.
 * Использует atomic claim/lease для защиты от race condition при параллельных запусках.
 *
 * Запуск: npm run enrich
 */

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { getServerClient, type Article } from '../lib/supabase'
import { scoreArticle } from './scorer'
import { fetchArticleContent } from './fetcher'
import { generateEditorial } from './claude'
import { generateSlug } from './slug'
import { claimBatch, releaseClaim, WORKER_ID } from './claims'
import {
  isRetryable,
  isExhausted,
  nextRetryAt,
  type ErrorCode,
} from './types'

const MIN_SCORE_FOR_CLAUDE = 2
const BATCH_SIZE = 25
const SLEEP_MS = 2_000

function log(msg: string): void {
  const ts = new Date().toTimeString().slice(0, 8)
  console.log(`[${ts}] ${msg}`)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

type EnrichResult = 'enriched_ok' | 'rejected' | 'retry_wait' | 'failed' | 'error'

async function enrichArticle(
  supabase: ReturnType<typeof getServerClient>,
  article: Article,
  runId: string,
): Promise<EnrichResult> {
  const startedAt = new Date()
  let errorCode: ErrorCode | undefined
  let errorMessage: string | undefined

  try {
    const { text: fullText, imageUrl, tables, inlineImages } = await fetchArticleContent(
      article.original_url,
    ).catch((err) => {
      errorCode = 'fetch_failed'
      errorMessage = err instanceof Error ? err.message : String(err)
      throw err
    })

    const articleForScoring: Article = {
      ...article,
      original_text: fullText || article.original_text,
      cover_image_url: imageUrl || article.cover_image_url,
    }
    const score = scoreArticle(articleForScoring)

    if (score < MIN_SCORE_FOR_CLAUDE) {
      await releaseClaim(supabase, article.id, {
        enrich_status: 'rejected',
        publish_status: 'draft',
        // Legacy dual-write
        enriched: true,
        published: false,
        quality_ok: false,
        quality_reason: 'low_score',
        score,
        original_text: fullText || article.original_text,
        cover_image_url: imageUrl || article.cover_image_url,
      })
      await writeAttempt(supabase, article, runId, startedAt, 'rejected', 'quality_reject', `low_score: ${score}`)
      log(`— low_score [${score}]: ${article.original_title.slice(0, 60)}`)
      return 'rejected'
    }

    const contentForClaude = fullText || article.original_text || ''

    let editorial: Awaited<ReturnType<typeof generateEditorial>>
    try {
      editorial = await generateEditorial(
        article.original_title,
        contentForClaude,
        article.source_name,
        article.source_lang,
        article.topics ?? [],
      )
    } catch (err) {
      errorCode = 'claude_api_error'
      errorMessage = err instanceof Error ? err.message : String(err)
      throw err
    }

    const slug = generateSlug(editorial?.ru_title || article.original_title, article.id)

    if (!editorial) {
      await releaseClaim(supabase, article.id, {
        enrich_status: 'rejected',
        publish_status: 'draft',
        last_error: 'editorial_parse_failed',
        last_error_code: 'editorial_parse_failed',
        // Legacy dual-write
        enriched: true,
        published: false,
        quality_ok: false,
        quality_reason: 'editorial_parse_failed',
        score,
        cover_image_url: imageUrl,
        slug,
      })
      await writeAttempt(supabase, article, runId, startedAt, 'rejected', 'editorial_parse_failed', 'editorial returned null')
      return 'rejected'
    }

    const enrichStatus = editorial.quality_ok ? 'enriched_ok' : 'rejected'
    const publishStatus = editorial.quality_ok ? 'publish_ready' : 'draft'

    await releaseClaim(supabase, article.id, {
      enrich_status: enrichStatus,
      publish_status: publishStatus,
      publish_ready_at: editorial.quality_ok ? new Date().toISOString() : null,
      last_error: null,
      last_error_code: null,
      score,
      cover_image_url: imageUrl,
      original_text: fullText || null,
      ru_title: editorial.ru_title,
      ru_text: editorial.editorial_body,
      lead: editorial.lead,
      summary: editorial.summary,
      card_teaser: editorial.card_teaser,
      tg_teaser: editorial.tg_teaser,
      editorial_body: editorial.editorial_body,
      editorial_model: 'claude-sonnet-4-6',
      glossary: editorial.glossary.length > 0 ? editorial.glossary : null,
      link_anchors: editorial.link_anchors.length > 0 ? editorial.link_anchors : null,
      article_tables: tables.length > 0 ? tables : null,
      article_images: inlineImages.length > 0 ? inlineImages : null,
      quality_ok: editorial.quality_ok,
      quality_reason: editorial.quality_reason || null,
      slug,
      // Legacy dual-write
      enriched: true,
      published: editorial.quality_ok,
    })

    await writeAttempt(supabase, article, runId, startedAt, editorial.quality_ok ? 'ok' : 'rejected', undefined, editorial.quality_reason || undefined)

    const statusIcon = editorial.quality_ok ? '✓ enriched_ok' : '✗ rejected'
    log(
      `${statusIcon} [score:${score}]` +
      (editorial.quality_reason ? ` reason="${editorial.quality_reason}"` : '') +
      ` — ${editorial.ru_title.slice(0, 60)}`,
    )

    return editorial.quality_ok ? 'enriched_ok' : 'rejected'
  } catch (err) {
    const code: ErrorCode = errorCode ?? 'unhandled_error'
    const msg = errorMessage ?? (err instanceof Error ? err.message : String(err))
    const attemptCount = (article.attempt_count ?? 0) + 1

    const exhausted = isExhausted(attemptCount)
    const retryable = isRetryable(code)

    if (!exhausted && retryable) {
      const retryAt = nextRetryAt(attemptCount).toISOString()
      await releaseClaim(supabase, article.id, {
        enrich_status: 'retry_wait',
        attempt_count: attemptCount,
        next_retry_at: retryAt,
        last_error: msg,
        last_error_code: code,
      })
      await writeAttempt(supabase, article, runId, startedAt, 'retryable', code, msg)
      log(`↻ retry_wait [attempt ${attemptCount}] ${code}: ${article.original_title.slice(0, 60)}`)
      return 'retry_wait'
    } else {
      await releaseClaim(supabase, article.id, {
        enrich_status: 'failed',
        attempt_count: attemptCount,
        last_error: msg,
        last_error_code: code,
        // Legacy dual-write
        enriched: true,
        quality_ok: false,
        quality_reason: code,
      })
      await writeAttempt(supabase, article, runId, startedAt, 'failed', code, msg)
      log(`✗ failed [attempt ${attemptCount}] ${code}: ${article.original_title.slice(0, 60)}`)
      return exhausted ? 'failed' : 'error'
    }
  }
}

async function writeAttempt(
  supabase: ReturnType<typeof getServerClient>,
  article: Article,
  runId: string,
  startedAt: Date,
  resultStatus: string,
  errorCode?: string,
  errorMessage?: string,
): Promise<void> {
  const now = new Date()
  await supabase.from('article_attempts').insert({
    article_id: article.id,
    stage: 'enrich',
    attempt_no: (article.attempt_count ?? 0) + 1,
    worker_id: WORKER_ID,
    claim_token: article.claim_token,
    started_at: startedAt.toISOString(),
    finished_at: now.toISOString(),
    duration_ms: now.getTime() - startedAt.getTime(),
    result_status: resultStatus,
    error_code: errorCode ?? null,
    error_message: errorMessage ?? null,
    payload: { run_id: runId },
  })
}

async function enrichBatch(): Promise<void> {
  log(`=== Запуск enricher.ts [worker: ${WORKER_ID}] ===`)

  let supabase: ReturnType<typeof getServerClient>
  try {
    supabase = getServerClient()
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    log(`Критическая ошибка: ${msg}`)
    process.exit(1)
  }

  // Create enrich_run record
  const runStarted = new Date().toISOString()
  const { data: runData } = await supabase
    .from('enrich_runs')
    .insert({
      started_at: runStarted,
      status: 'running',
      batch_size: BATCH_SIZE,
    })
    .select('id')
    .single()
  const runId: string = runData?.id ?? 'unknown'

  // Check oldest pending age for backlog signal
  const { data: oldestPending } = await supabase
    .from('articles')
    .select('created_at')
    .eq('enrich_status', 'pending')
    .order('created_at', { ascending: true })
    .limit(1)
    .single()

  const oldestAgeMinutes = oldestPending
    ? Math.round((Date.now() - new Date(oldestPending.created_at).getTime()) / 60_000)
    : null

  // Claim articles atomically
  const articles = await claimBatch(supabase, BATCH_SIZE)

  if (!articles.length) {
    log('Нет статей для обогащения — завершаем')
    await supabase.from('enrich_runs').update({
      finished_at: new Date().toISOString(),
      status: 'ok',
      articles_claimed: 0,
      oldest_pending_age_minutes: oldestAgeMinutes,
    }).eq('id', runId)
    return
  }

  log(`Claimed статей: ${articles.length}`)

  let enrichedOk = 0
  let rejected = 0
  let retryable = 0
  let failed = 0

  for (const article of articles) {
    try {
      const result = await enrichArticle(supabase, article, runId)
      switch (result) {
        case 'enriched_ok': enrichedOk++; break
        case 'rejected':    rejected++;   break
        case 'retry_wait':  retryable++;  break
        case 'failed':
        case 'error':       failed++;     break
      }
    } catch (err) {
      failed++
      const msg = err instanceof Error ? err.message : String(err)
      log(`✗ Необработанная ошибка для ${article.original_url}: ${msg}`)
      await releaseClaim(supabase, article.id, {
        enrich_status: 'failed',
        attempt_count: (article.attempt_count ?? 0) + 1,
        last_error: msg,
        last_error_code: 'unhandled_error',
        enriched: true,
        quality_ok: false,
        quality_reason: 'unhandled_error',
      })
    }

    await sleep(SLEEP_MS)
  }

  const runStatus = failed > 0 && enrichedOk === 0 ? 'failed'
    : failed > 0 || retryable > 0 ? 'partial'
    : 'ok'

  await supabase.from('enrich_runs').update({
    finished_at: new Date().toISOString(),
    status: runStatus,
    articles_claimed: articles.length,
    articles_enriched_ok: enrichedOk,
    articles_rejected: rejected,
    articles_retryable: retryable,
    articles_failed: failed,
    oldest_pending_age_minutes: oldestAgeMinutes,
  }).eq('id', runId)

  log('─────────────────────────────────────')
  log(`Claimed:      ${articles.length}`)
  log(`Enriched OK:  ${enrichedOk}`)
  log(`Отклонено:    ${rejected}`)
  log(`Retry wait:   ${retryable}`)
  log(`Failed:       ${failed}`)
  log(`Run status:   ${runStatus}`)
  log('=== enricher.ts завершён ===')
}

enrichBatch().catch((error: unknown) => {
  const msg = error instanceof Error ? error.message : String(error)
  console.error(`[${new Date().toTimeString().slice(0, 8)}] КРИТИЧЕСКАЯ ОШИБКА: ${msg}`)
  process.exit(1)
})
