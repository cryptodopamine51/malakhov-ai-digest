import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import Anthropic from '@anthropic-ai/sdk'
import type { Message } from '@anthropic-ai/sdk/resources/messages/messages'
import OpenAI from 'openai'
import { config as loadDotenv, parse as parseDotenv } from 'dotenv'
import type { SupabaseClient } from '@supabase/supabase-js'

loadDotenv({ path: resolve(process.cwd(), '.env.local') })
loadDotenv({ path: resolve(process.cwd(), '.env') })
loadExtraEnv(resolve(process.cwd(), 'malakhov-ai-keys.env'))

import { getServerClient, type Article } from '../lib/supabase'
import { buildBatchCustomId, buildBatchRequestParams as buildParams } from '../pipeline/anthropic-batch'
import {
  allowsAnthropicFallback,
  buildClaudeReviewerPrompt,
  buildDeterministicEditorialBrief,
  detectEditorialRiskFlags,
  getEditorialRoutingConfig,
  isTruncatedCompletion,
  parseClaudeReviewerResult,
  shouldReviewWithClaude,
  type ArticleRoutingContext,
  type ClaudeReviewerResult,
  type EditorialRoutingMode,
} from '../pipeline/editorial-routing'
import {
  buildEditorialMessageParams,
  buildEditorialSystemPrompt,
  buildEditorialUserMessage,
  extractEditorialText,
  usageFromMessage,
  type EditorialRequest,
  type TokenUsage,
} from '../pipeline/claude'
import {
  applyEditorialDirect,
  parseRepairValidateEditorial,
  prepareEditorialApplication,
  type EditorialApplySourceContext,
} from '../pipeline/editorial-apply'
import { repairEditorialWithDeepSeek } from '../pipeline/editorial-repair'
import { claimBatch, releaseClaim } from '../pipeline/claims'
import {
  createEnrichRun,
  finishEnrichRun,
  getOldestPendingAgeMinutes,
  log,
  writeEnrichAttempt,
  writeMediaSanitizeAttempt,
  type EnrichRunMetrics,
} from '../pipeline/enrich-runtime'
import { fetchArticleContent } from '../pipeline/fetcher'
import { writeLlmUsageLog, addUsageTotals, ZERO_USAGE_TOTALS, type UsageTotals } from '../pipeline/llm-usage'
import { estimateTextCostUsd, type TextUsageForCost } from '../pipeline/model-pricing'
import { sanitizeArticleMedia } from '../pipeline/media-sanitizer'
import { scoreArticle } from '../pipeline/scorer'
import { articleHasCategory, getMinScoreForArticle } from '../pipeline/scorer.config'
import {
  getAnthropicDegradedState,
  parkArticleForAnthropicRecovery,
  type AnthropicDegradedState,
} from '../pipeline/provider-degraded'
import {
  bumpRejectedBreakdown,
  mapBatchCreateError,
  persistProviderBatch,
  writeFetchAttempt,
  type StagedBatchItem,
} from '../pipeline/enrich-submit-batch'
import { isExhausted, isRetryable, nextRetryAt, type ErrorCode } from '../pipeline/types'

type RoutingMode = Extract<EditorialRoutingMode, 'deepseek-only' | 'cheap' | 'balanced' | 'premium'>
type RoutingStatus = 'planned' | 'applied' | 'rejected' | 'fallback_queued' | 'failed' | 'skipped'

interface Args {
  apply: boolean
  limit: number
  mode: RoutingMode
  deepseekModel: string
  claudeModel: string
  deepseekDailyBudgetUsd: number
}

interface HydratedArticle {
  article: Article
  sourceContext: EditorialApplySourceContext
  mediaRejects: unknown[]
  score: number
}

interface RoutingResult {
  articleId: string
  title: string
  status: RoutingStatus
  reason: string | null
  costUsd: number
  validationErrors?: string[]
  validationWarnings?: string[]
  repairs?: string[]
  riskFlags?: string[]
}

const MOSCOW_OFFSET = '+03:00'
const LOW_RISK_FALLBACK_FLAGS = new Set(['research', 'legal_regulation', 'medical', 'geopolitics'])
const CHEAP_FALLBACK_FLAGS = new Set([...LOW_RISK_FALLBACK_FLAGS, 'high_score'])
const DEFAULT_DEEPSEEK_MAX_TOKENS = 6000

const args = parseArgs()

function parseArgs(): Args {
  const flags = new Map<string, string | boolean>()
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith('--') && arg.includes('=')) {
      const raw = arg.slice(2)
      const separator = raw.indexOf('=')
      flags.set(raw.slice(0, separator), raw.slice(separator + 1))
    } else if (arg.startsWith('--')) {
      flags.set(arg.slice(2), true)
    }
  }

  const modeRaw = String(flags.get('mode') ?? 'deepseek-only')
  const mode: RoutingMode =
    modeRaw === 'cheap' || modeRaw === 'balanced' || modeRaw === 'premium'
      ? modeRaw
      : 'deepseek-only'

  return {
    apply: flags.has('apply'),
    limit: numberFlag(flags, 'limit', 5),
    mode,
    deepseekModel: String(flags.get('deepseek-model') ?? process.env.DEEPSEEK_WRITER_MODEL ?? 'deepseek-v4-flash'),
    claudeModel: String(flags.get('claude-model') ?? process.env.CLAUDE_EDITORIAL_MODEL ?? 'claude-sonnet-4-6'),
    deepseekDailyBudgetUsd: numberFlag(flags, 'deepseek-daily-budget', Number(process.env.DEEPSEEK_DAILY_BUDGET_USD ?? 0.1)),
  }
}

function numberFlag(flags: Map<string, string | boolean>, name: string, fallback: number): number {
  const raw = flags.get(name)
  const value = typeof raw === 'string' ? Number(raw) : fallback
  return Number.isFinite(value) && value > 0 ? value : fallback
}

function roundUsd(value: number): number {
  return Number(value.toFixed(6))
}

function approxTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

function loadExtraEnv(path: string): void {
  if (!existsSync(path)) return
  const raw = readFileSync(path, 'utf8')
  const parsed = safeParseEnv(raw)
  if (/^\\{\\rtf/.test(raw)) {
    try {
      const plain = execFileSync('textutil', ['-convert', 'txt', '-stdout', path], { encoding: 'utf8' })
      Object.assign(parsed, safeParseEnv(plain))
    } catch {
      // RTF files often still contain plain KEY=value runs; use those if textutil is unavailable.
    }
  }
  for (const [key, value] of Object.entries(parsed)) {
    if (!process.env[key]) process.env[key] = value
  }
}

function safeParseEnv(text: string): Record<string, string> {
  const parsed: Record<string, string> = {}
  Object.assign(parsed, parseDotenv(text))
  const keyValueRe = /([A-Z][A-Z0-9_]{2,})=([^\\\r\n{}]+)/g
  for (const match of text.matchAll(keyValueRe)) {
    const key = match[1]
    const value = match[2].trim().replace(/^["']|["']$/g, '')
    if (key && value) parsed[key] = value
  }
  return parsed
}

function validateApplyEnv(): void {
  if (!args.apply) return
  if (args.mode !== 'premium' && !process.env.DEEPSEEK_API_KEY) {
    throw new Error('DEEPSEEK_API_KEY is required for editorial routing --apply')
  }
  if (allowsAnthropicFallback(args.mode) && !process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY is required because premium fallback must be available')
  }
}

function deepSeekClient(): OpenAI {
  const apiKey = process.env.DEEPSEEK_API_KEY
  if (!apiKey) throw new Error('DEEPSEEK_API_KEY is missing')
  return new OpenAI({
    apiKey,
    baseURL: process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com',
    timeout: numberEnv('DEEPSEEK_TIMEOUT_MS', 180_000),
    maxRetries: numberEnv('DEEPSEEK_MAX_RETRIES', 2),
  })
}

function numberEnv(name: string, fallback: number): number {
  const value = Number(process.env[name])
  return Number.isFinite(value) && value > 0 ? value : fallback
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms))
}

function deepSeekUsage(value: unknown): TextUsageForCost {
  const raw = (value ?? {}) as Record<string, unknown>
  const promptTokens = Number(raw.prompt_tokens ?? 0)
  const completionTokens = Number(raw.completion_tokens ?? 0)
  const cacheHit = Number(raw.prompt_cache_hit_tokens ?? 0)
  const cacheMiss = Number(raw.prompt_cache_miss_tokens ?? Math.max(0, promptTokens - cacheHit))
  return {
    inputTokens: promptTokens,
    outputTokens: completionTokens,
    cacheHitInputTokens: cacheHit,
    cacheMissInputTokens: cacheMiss,
  }
}

function usageToTotals(provider: 'deepseek' | 'anthropic', model: string, usage: TextUsageForCost | TokenUsage): UsageTotals {
  return {
    inputTokens: usage.inputTokens ?? 0,
    outputTokens: usage.outputTokens ?? 0,
    cacheReadTokens: usage.cacheReadTokens ?? 0,
    cacheCreateTokens: usage.cacheCreateTokens ?? 0,
    estimatedCostUsd: 'estimatedCostUsd' in usage
      ? usage.estimatedCostUsd
      : estimateTextCostUsd({ provider, model, usage }),
  }
}

function buildRequest(article: Article, originalText: string): EditorialRequest {
  return {
    originalTitle: article.original_title,
    originalText,
    sourceName: article.source_name,
    sourceLang: article.source_lang,
    topics: article.topics ?? [],
    primaryCategory: article.primary_category,
    secondaryCategories: article.secondary_categories ?? [],
  }
}

function routingContext(article: Article, originalText: string, score: number): ArticleRoutingContext {
  return {
    sourceName: article.source_name,
    originalTitle: article.original_title,
    originalText,
    topics: article.topics ?? [],
    primaryCategory: article.primary_category,
    secondaryCategories: article.secondary_categories ?? [],
    score,
    hasCover: Boolean(article.cover_image_url),
  }
}

async function selectDryRunArticles(supabase: SupabaseClient, limit: number): Promise<Article[]> {
  const now = new Date().toISOString()
  const { data, error } = await supabase
    .from('articles')
    .select('*')
    .in('enrich_status', ['pending', 'retry_wait'])
    .or(`next_retry_at.is.null,next_retry_at.lte.${now}`)
    .is('claim_token', null)
    .is('current_batch_item_id', null)
    .order('created_at', { ascending: true })
    .limit(limit)

  if (error) throw new Error(`article query failed: ${error.message}`)
  return (data ?? []) as Article[]
}

async function getTodayDeepSeekSpend(supabase: SupabaseClient): Promise<number> {
  const today = toMoscowDate(new Date().toISOString())
  const { startIso, endIso } = getMoscowDayBounds(today)
  const { data, error } = await supabase
    .from('llm_usage_logs')
    .select('estimated_cost_usd')
    .eq('provider', 'deepseek')
    .eq('operation', 'deepseek_editorial_writer')
    .gte('created_at', startIso)
    .lt('created_at', endIso)
    .limit(10_000)

  if (error) {
    console.warn(`DeepSeek spend check failed: ${error.message}`)
    return 0
  }

  return Number(((data ?? []) as Array<{ estimated_cost_usd: number | string | null }>)
    .reduce((sum, row) => sum + Number(row.estimated_cost_usd ?? 0), 0)
    .toFixed(6))
}

function getMoscowDayBounds(targetDate: string): { startIso: string; endIso: string } {
  const start = new Date(`${targetDate}T00:00:00${MOSCOW_OFFSET}`)
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000)
  return { startIso: start.toISOString(), endIso: end.toISOString() }
}

function toMoscowDate(iso: string): string {
  const dateValue = new Date(iso)
  const moscow = new Date(dateValue.getTime() + 3 * 60 * 60 * 1000)
  return moscow.toISOString().slice(0, 10)
}

async function hydrateArticle(
  supabase: SupabaseClient,
  runId: string,
  article: Article,
): Promise<{ hydrated: HydratedArticle | null; result: RoutingResult | null }> {
  const startedAt = new Date()
  const fetched = await fetchArticleContent(article.original_url)
  const attemptNo = (article.attempt_count ?? 0) + 1

  if (fetched.errorCode) {
    if (args.apply) {
      await releaseRoutingFailure(
        supabase,
        article,
        runId,
        startedAt,
        fetched.errorCode,
        fetched.errorMessage ?? `fetch failed for ${article.original_url}`,
      )
      await writeFetchAttempt(
        supabase,
        article,
        runId,
        startedAt,
        fetched.errorCode,
        fetched.errorMessage ?? `fetch failed for ${article.original_url}`,
      )
    }
    return {
      hydrated: null,
      result: resultFor(article, 'failed', fetched.errorCode, 0),
    }
  }

  const originalText = fetched.text || article.original_text || ''
  const mediaStartedAt = new Date()
  const sanitized = sanitizeArticleMedia({
    coverImageUrl: fetched.imageUrl || article.cover_image_url,
    articleImages: fetched.inlineImages,
    context: {
      sourceName: article.source_name,
      originalUrl: article.original_url,
      originalTitle: article.original_title,
      originalText,
    },
  })

  const hydratedArticle = {
    ...article,
    original_text: originalText,
    cover_image_url: sanitized.coverImageUrl,
  }
  const score = scoreArticle(hydratedArticle)
  const minScore = getMinScoreForArticle(hydratedArticle)
  const rejectedByMediaGate = articleHasCategory(hydratedArticle, 'ai-research') &&
    !sanitized.coverImageUrl &&
    sanitized.articleImages.length === 0

  if (sanitized.rejects.length > 0 && args.apply) {
    await writeMediaSanitizeAttempt(supabase, {
      articleId: article.id,
      attemptNo,
      startedAt: mediaStartedAt,
      resultStatus: rejectedByMediaGate ? 'rejected' : 'ok',
      claimToken: article.claim_token,
      runId,
      phase: 'routing',
      rejects: sanitized.rejects,
      remainingMedia: {
        coverImageUrl: Boolean(sanitized.coverImageUrl),
        articleImages: sanitized.articleImages.length,
      },
      errorMessage: rejectedByMediaGate ? 'media_sanitize: all media rejected before routing' : null,
    })
  }

  if (rejectedByMediaGate) {
    if (args.apply) {
      await rejectBeforeRouting(
        supabase,
        article,
        runId,
        startedAt,
        score,
        originalText,
        sanitized.coverImageUrl,
        'rejected_low_visual',
        'rejected_low_visual: research article has no cover or inline images',
      )
    }
    return { hydrated: null, result: resultFor(article, 'rejected', 'rejected_low_visual', 0) }
  }

  if (score < minScore) {
    if (args.apply) {
      await rejectBeforeRouting(
        supabase,
        article,
        runId,
        startedAt,
        score,
        originalText,
        sanitized.coverImageUrl,
        'low_score',
        `low_score: ${score}; min_score: ${minScore}`,
      )
    }
    return { hydrated: null, result: resultFor(article, 'rejected', 'low_score', 0) }
  }

  return {
    hydrated: {
      article: hydratedArticle,
      score,
      mediaRejects: sanitized.rejects,
      sourceContext: {
        originalText,
        coverImageUrl: sanitized.coverImageUrl,
        articleTables: fetched.tables,
        articleImages: sanitized.articleImages,
        articleVideos: fetched.inlineVideos,
        score,
        mediaRejects: sanitized.rejects,
      },
    },
    result: null,
  }
}

async function rejectBeforeRouting(
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
  const attemptNo = (article.attempt_count ?? 0) + 1
  await releaseClaim(supabase, article.id, article.claim_token, {
    enrich_status: 'rejected',
    publish_status: 'draft',
    score,
    original_text: originalText,
    cover_image_url: coverImageUrl,
    current_batch_item_id: null,
    enriched: true,
    published: false,
    quality_ok: false,
    quality_reason: qualityReason,
    attempt_count: attemptNo,
    last_error: attemptMessage,
    last_error_code: 'quality_reject',
  })

  await writeEnrichAttempt(supabase, {
    articleId: article.id,
    attemptNo,
    startedAt,
    resultStatus: 'rejected',
    claimToken: article.claim_token,
    errorCode: 'quality_reject',
    errorMessage: attemptMessage,
    payload: { run_id: runId, phase: 'editorial_routing' },
  })
}

async function releaseRoutingFailure(
  supabase: SupabaseClient,
  article: Article,
  runId: string,
  startedAt: Date,
  errorCode: ErrorCode,
  errorMessage: string,
): Promise<'retryable' | 'failed'> {
  const attemptNo = (article.attempt_count ?? 0) + 1
  const retryable = isRetryable(errorCode) && !isExhausted(attemptNo)

  await releaseClaim(supabase, article.id, article.claim_token, {
    enrich_status: retryable ? 'retry_wait' : 'failed',
    publish_status: 'draft',
    attempt_count: attemptNo,
    next_retry_at: retryable ? nextRetryAt(attemptNo).toISOString() : null,
    current_batch_item_id: null,
    last_error: errorMessage,
    last_error_code: errorCode,
    enriched: !retryable,
    published: false,
    quality_ok: false,
    quality_reason: null,
  })

  await writeEnrichAttempt(supabase, {
    articleId: article.id,
    attemptNo,
    startedAt,
    resultStatus: retryable ? 'retryable' : 'failed',
    claimToken: article.claim_token,
    errorCode,
    errorMessage,
    payload: { run_id: runId, phase: 'editorial_routing' },
  })

  return retryable ? 'retryable' : 'failed'
}

async function callDeepSeekWriter(params: {
  supabase: SupabaseClient
  article: Article
  runId: string
  system: string
  user: string
  degraded?: boolean
}): Promise<{ text: string; usage: UsageTotals; costUsd: number; error: string | null }> {
  const client = deepSeekClient()
  let totalUsage = ZERO_USAGE_TOTALS
  let lastError: string | null = null

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const response = await client.chat.completions.create({
        model: args.deepseekModel,
        temperature: 0.4,
        max_tokens: numberEnv('DEEPSEEK_EDITORIAL_MAX_TOKENS', DEFAULT_DEEPSEEK_MAX_TOKENS),
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: params.system },
          {
            role: 'user',
            content: attempt === 1
              ? params.user
              : `${params.user}\n\nThe previous response was truncated. Return compact valid JSON: keep editorial_body between 1200 and 1800 characters and avoid unnecessary detail.`,
          },
        ],
      } as any)

      const usage = usageToTotals('deepseek', args.deepseekModel, deepSeekUsage(response.usage))
      totalUsage = addUsageTotals(totalUsage, usage)
      const text = response.choices[0]?.message?.content ?? ''
      const finishReason = response.choices[0]?.finish_reason ?? null
      const truncated = isTruncatedCompletion(finishReason)
      await writeLlmUsageLog({
        supabase: params.supabase,
        provider: 'deepseek',
        model: args.deepseekModel,
        operation: 'deepseek_editorial_writer',
        runKind: 'editorial_routing',
        enrichRunId: params.runId.startsWith('dry-run') ? null : params.runId,
        articleId: params.article.id,
        sourceName: params.article.source_name,
        sourceLang: params.article.source_lang,
        originalTitle: params.article.original_title,
        resultStatus: text && !truncated ? 'ok' : 'failed',
        metadata: {
          mode: args.mode,
          degraded: params.degraded === true,
          attempt,
          finish_reason: finishReason,
          truncated,
          prompt_chars: params.system.length + params.user.length,
          error: truncated ? 'response_truncated' : text ? null : 'empty_response',
        },
        usage,
      })

      if (text && !truncated) return { text, usage: totalUsage, costUsd: totalUsage.estimatedCostUsd, error: null }
      if (truncated) {
        lastError = 'response truncated at max_tokens'
        continue
      }
      lastError = 'empty response'
      if (attempt < 2) continue
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
      await writeLlmUsageLog({
        supabase: params.supabase,
        provider: 'deepseek',
        model: args.deepseekModel,
        operation: 'deepseek_editorial_writer',
        runKind: 'editorial_routing',
        enrichRunId: params.runId.startsWith('dry-run') ? null : params.runId,
        articleId: params.article.id,
        sourceName: params.article.source_name,
        sourceLang: params.article.source_lang,
        originalTitle: params.article.original_title,
        resultStatus: 'failed',
        metadata: { mode: args.mode, degraded: params.degraded === true, attempt, error: lastError },
        usage: ZERO_USAGE_TOTALS,
      })
      if (attempt < 2) await sleep(1500 * attempt)
    }
  }

  return { text: '', usage: totalUsage, costUsd: totalUsage.estimatedCostUsd, error: lastError ?? 'deepseek request failed' }
}

async function reviewWithClaude(params: {
  supabase: SupabaseClient
  article: Article
  runId: string
  context: ArticleRoutingContext
  output: any
  validation: any
  reasons: string[]
}): Promise<{ result: ClaudeReviewerResult | null; usage: UsageTotals; costUsd: number; error: string | null }> {
  const prompt = buildClaudeReviewerPrompt({
    context: params.context,
    output: params.output,
    validation: params.validation,
    reasons: params.reasons,
  })
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

  try {
    const message = await anthropic.messages.create({
      model: args.claudeModel,
      max_tokens: 900,
      temperature: 0.1,
      system: prompt.system,
      messages: [{ role: 'user', content: prompt.user }],
    } as any) as Message
    const usage = usageToTotals('anthropic', args.claudeModel, usageFromMessage(message))
    const text = extractEditorialText(message) ?? ''
    const result = parseClaudeReviewerResult(text)
    await writeLlmUsageLog({
      supabase: params.supabase,
      provider: 'anthropic',
      model: args.claudeModel,
      operation: 'claude_selective_reviewer',
      runKind: 'editorial_routing',
      enrichRunId: params.runId.startsWith('dry-run') ? null : params.runId,
      articleId: params.article.id,
      sourceName: params.article.source_name,
      sourceLang: params.article.source_lang,
      originalTitle: params.article.original_title,
      resultStatus: result?.pass && result.publish_recommendation === 'publish' ? 'ok' : result ? 'rejected' : 'failed',
      metadata: {
        mode: args.mode,
        reasons: params.reasons,
        review: result,
      },
      usage,
    })
    return {
      result,
      usage,
      costUsd: usage.estimatedCostUsd,
      error: result ? null : 'review parse failed',
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await writeLlmUsageLog({
      supabase: params.supabase,
      provider: 'anthropic',
      model: args.claudeModel,
      operation: 'claude_selective_reviewer',
      runKind: 'editorial_routing',
      enrichRunId: params.runId.startsWith('dry-run') ? null : params.runId,
      articleId: params.article.id,
      sourceName: params.article.source_name,
      sourceLang: params.article.source_lang,
      originalTitle: params.article.original_title,
      resultStatus: 'failed',
      metadata: { mode: args.mode, reasons: params.reasons, error: message },
      usage: ZERO_USAGE_TOTALS,
    })
    return { result: null, usage: ZERO_USAGE_TOTALS, costUsd: 0, error: message }
  }
}

function plannedDeepSeekCost(system: string, user: string): number {
  return estimateTextCostUsd({
    provider: 'deepseek',
    model: args.deepseekModel,
    usage: {
      inputTokens: approxTokens(`${system}\n${user}`),
      outputTokens: 4000,
    },
  })
}

function shouldFallbackBeforeDeepSeek(mode: RoutingMode, riskFlags: string[]): string | null {
  if (mode === 'deepseek-only') return null
  if (mode === 'premium') return 'mode_premium'
  const flags = mode === 'cheap' ? CHEAP_FALLBACK_FLAGS : LOW_RISK_FALLBACK_FLAGS
  const matched = riskFlags.filter((flag) => flags.has(flag))
  return matched.length ? `risk:${matched.join(',')}` : null
}

async function queuePremiumFallback(params: {
  supabase: SupabaseClient
  runId: string
  article: Article
  sourceContext: EditorialApplySourceContext
  reason: string
  startedAt: Date
}): Promise<RoutingResult> {
  if (!args.apply) {
    return resultFor(params.article, 'planned', `premium_fallback:${params.reason}`, 0)
  }

  const attemptNo = (params.article.attempt_count ?? 0) + 1
  const batchItemId = randomUUID()
  const request = buildRequest(params.article, params.sourceContext.originalText)
  const messageParams = buildParams(buildEditorialMessageParams(request))
  const requestCustomId = buildBatchCustomId({
    articleId: params.article.id,
    attemptNo,
    batchItemId,
  })
  const requestPayload = {
    operation: 'editorial_premium_fallback',
    params: messageParams,
    article_context: {
      article_id: params.article.id,
      original_title: params.article.original_title,
      source_name: params.article.source_name,
      source_lang: params.article.source_lang,
      topics: params.article.topics ?? [],
      original_text: params.sourceContext.originalText,
      cover_image_url: params.sourceContext.coverImageUrl,
      article_tables: params.sourceContext.articleTables ?? null,
      article_images: params.sourceContext.articleImages ?? null,
      article_videos: params.sourceContext.articleVideos ?? null,
      score: params.sourceContext.score,
      attempt_no: attemptNo,
      media_rejects: params.sourceContext.mediaRejects ?? [],
      fallback_reason: params.reason,
      routed_from: args.mode,
    },
  }

  const { error: insertError } = await params.supabase
    .from('anthropic_batch_items')
    .insert({
      id: batchItemId,
      article_id: params.article.id,
      request_custom_id: requestCustomId,
      status: 'queued_for_batch',
      request_payload: requestPayload,
    })

  if (insertError) {
    const failure = await releaseRoutingFailure(
      params.supabase,
      params.article,
      params.runId,
      params.startedAt,
      'unhandled_error',
      `premium fallback batch item insert failed: ${insertError.message}`,
    )
    return resultFor(params.article, failure === 'retryable' ? 'skipped' : 'failed', insertError.message, 0)
  }

  const staged: StagedBatchItem = {
    id: batchItemId,
    article: params.article,
    attemptNo,
    requestCustomId,
    requestPayload,
    params: messageParams,
  }

  try {
    await persistProviderBatch(params.supabase, params.runId, [staged], 'editorial-routing')
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const errorCode = mapBatchCreateError(error)
    await releaseRoutingFailure(params.supabase, params.article, params.runId, params.startedAt, errorCode, message)
    return resultFor(params.article, 'failed', message, 0)
  }

  await writeLlmUsageLog({
    supabase: params.supabase,
    provider: 'anthropic',
    model: args.claudeModel,
    operation: 'editorial_premium_fallback',
    runKind: 'editorial_routing',
    enrichRunId: params.runId,
    articleId: params.article.id,
    sourceName: params.article.source_name,
    sourceLang: params.article.source_lang,
    originalTitle: params.article.original_title,
    resultStatus: 'queued',
    metadata: {
      mode: args.mode,
      fallback_reason: params.reason,
      batch_item_id: batchItemId,
    },
    usage: ZERO_USAGE_TOTALS,
  })

  await writeEnrichAttempt(params.supabase, {
    articleId: params.article.id,
    attemptNo,
    startedAt: params.startedAt,
    resultStatus: 'ok',
    claimToken: params.article.claim_token,
    errorCode: null,
    errorMessage: null,
    payload: {
      run_id: params.runId,
      phase: 'editorial_routing',
      routed_to: 'premium_fallback',
      fallback_reason: params.reason,
      fallback_batch_item_id: batchItemId,
    },
  })

  return resultFor(params.article, 'fallback_queued', params.reason, 0)
}

async function routeArticle(params: {
  supabase: SupabaseClient
  runId: string
  hydrated: HydratedArticle
  spentTodayUsd: number
  anthropicDegraded: AnthropicDegradedState
}): Promise<RoutingResult> {
  const { article, sourceContext, score } = params.hydrated
  const startedAt = new Date()
  const context = routingContext(article, sourceContext.originalText, score)
  const riskFlags = detectEditorialRiskFlags(context)
  const preFallbackReason = shouldFallbackBeforeDeepSeek(args.mode, riskFlags)

  if (preFallbackReason) {
    if (params.anthropicDegraded.active) {
      const reason = `${preFallbackReason}; degraded=${params.anthropicDegraded.reason ?? 'active'}`
      const parked = await parkArticleForAnthropicRecovery({
        supabase: params.supabase,
        articleId: article.id,
        claimToken: article.claim_token,
        reason,
      })
      await writeEnrichAttempt(params.supabase, {
        articleId: article.id,
        attemptNo: (article.attempt_count ?? 0) + 1,
        startedAt,
        resultStatus: parked ? 'retryable' : 'failed',
        claimToken: article.claim_token,
        errorCode: 'claude_api_error',
        errorMessage: `anthropic_degraded: ${reason}`,
        payload: {
          run_id: params.runId,
          phase: 'editorial_routing',
          degraded: true,
          risk_flags: riskFlags,
          fallback_reason: preFallbackReason,
        },
      })
      return { ...resultFor(article, parked ? 'skipped' : 'failed', `anthropic_degraded:${preFallbackReason}`, 0), riskFlags }
    }
    const result = await queuePremiumFallback({
      supabase: params.supabase,
      runId: params.runId,
      article,
      sourceContext,
      reason: preFallbackReason,
      startedAt,
    })
    return { ...result, riskFlags }
  }

  const config = getEditorialRoutingConfig({
    EDITORIAL_ROUTING_MODE: args.mode,
    EDITORIAL_WRITER_PROVIDER: args.mode === 'premium' ? 'anthropic' : 'deepseek',
    EDITORIAL_REVIEW_POLICY: args.mode === 'balanced' ? 'selective' : 'none',
  })
  const system = buildEditorialSystemPrompt()
  const user =
    'Use this deterministic editorial brief as planning context, but preserve the required final JSON schema.\n\n' +
    buildDeterministicEditorialBrief(context)
  const estimatedCost = plannedDeepSeekCost(system, user)

  if (!args.apply) {
    return {
      ...resultFor(article, 'planned', 'deepseek_editorial_writer', estimatedCost),
      riskFlags,
    }
  }

  if (args.deepseekDailyBudgetUsd > 0 && params.spentTodayUsd + estimatedCost > args.deepseekDailyBudgetUsd) {
    if (!allowsAnthropicFallback(args.mode)) {
      const failure = await releaseRoutingFailure(
        params.supabase,
        article,
        params.runId,
        startedAt,
        'provider_api_error',
        `deepseek_budget_cap:${args.deepseekDailyBudgetUsd}`,
      )
      return resultFor(article, failure === 'retryable' ? 'skipped' : 'failed', `deepseek_budget_cap:${args.deepseekDailyBudgetUsd}`, 0)
    }
    if (params.anthropicDegraded.active) {
      const failure = await releaseRoutingFailure(
        params.supabase,
        article,
        params.runId,
        startedAt,
        'claude_api_error',
        `deepseek_budget_cap_degraded:${args.deepseekDailyBudgetUsd}`,
      )
      return resultFor(article, failure === 'retryable' ? 'skipped' : 'failed', `deepseek_budget_cap_degraded:${args.deepseekDailyBudgetUsd}`, 0)
    }
    return queuePremiumFallback({
      supabase: params.supabase,
      runId: params.runId,
      article,
      sourceContext,
      reason: `deepseek_budget_cap:${args.deepseekDailyBudgetUsd}`,
      startedAt,
    })
  }

  const writer = await callDeepSeekWriter({
    supabase: params.supabase,
    article,
    runId: params.runId,
    system,
    user,
    degraded: params.anthropicDegraded.active,
  })

  if (!writer.text) {
    if (!allowsAnthropicFallback(args.mode) || params.anthropicDegraded.active) {
      const failure = await releaseRoutingFailure(
        params.supabase,
        article,
        params.runId,
        startedAt,
        'provider_api_error',
        `deepseek_failed:${writer.error ?? 'missing_output'}`,
      )
      return resultFor(article, failure === 'retryable' ? 'skipped' : 'failed', `deepseek_failed:${writer.error ?? 'missing_output'}`, writer.costUsd)
    }
    return queuePremiumFallback({
      supabase: params.supabase,
      runId: params.runId,
      article,
      sourceContext,
      reason: `deepseek_failed:${writer.error ?? 'missing_output'}`,
      startedAt,
    })
  }

  const validationContext = {
    originalTitle: article.original_title,
    originalText: sourceContext.originalText,
  }
  let parsed = parseRepairValidateEditorial(writer.text, validationContext)
  let repairCost = 0
  if (!parsed.validation.ok && parsed.output && parsed.output.quality_ok !== false) {
    const repair = await repairEditorialWithDeepSeek({
      supabase: params.supabase,
      articleId: article.id,
      runId: params.runId,
      sourceName: article.source_name,
      sourceLang: article.source_lang,
      originalTitle: article.original_title,
      originalText: sourceContext.originalText,
      output: parsed.output,
      validation: parsed.validation,
      validationContext,
      runKind: 'editorial_routing',
    })
    repairCost = repair.costUsd
    if (repair.rawText) {
      const repaired = parseRepairValidateEditorial(repair.rawText, validationContext)
      if (repaired.output && repaired.validation.ok) {
        parsed = {
          ...repaired,
          repairs: [...parsed.repairs, 'deepseek_editorial_repair', ...repaired.repairs],
        }
      }
    }
  }
  if (!parsed.output || !parsed.validation.ok) {
    if (!allowsAnthropicFallback(args.mode) || params.anthropicDegraded.active) {
      const failure = await releaseRoutingFailure(
        params.supabase,
        article,
        params.runId,
        startedAt,
        'editorial_validation_failed',
        `validator_failed:${parsed.error ?? 'validation'}`,
      )
      return {
        ...resultFor(article, failure === 'retryable' ? 'skipped' : 'failed', `validator_failed:${parsed.error ?? 'validation'}`, writer.costUsd + repairCost),
        validationErrors: parsed.validation.errors,
        validationWarnings: parsed.validation.warnings,
        repairs: parsed.repairs,
        riskFlags,
      }
    }
    return {
      ...(await queuePremiumFallback({
        supabase: params.supabase,
        runId: params.runId,
        article,
        sourceContext,
        reason: `validator_failed:${parsed.error ?? 'validation'}`,
        startedAt,
      })),
      costUsd: writer.costUsd + repairCost,
      validationErrors: parsed.validation.errors,
      validationWarnings: parsed.validation.warnings,
      repairs: parsed.repairs,
      riskFlags,
    }
  }

  if (parsed.output.quality_ok === false) {
    if (!allowsAnthropicFallback(args.mode) || params.anthropicDegraded.active) {
      await rejectBeforeRouting(
        params.supabase,
        article,
        params.runId,
        startedAt,
        score,
        sourceContext.originalText,
        sourceContext.coverImageUrl,
        parsed.output.quality_reason || 'quality_not_ok',
        `quality_not_ok:${parsed.output.quality_reason || 'unspecified'}`,
      )
      return {
        ...resultFor(article, 'rejected', `quality_not_ok:${parsed.output.quality_reason || 'unspecified'}`, writer.costUsd + repairCost),
        validationWarnings: parsed.validation.warnings,
        repairs: parsed.repairs,
        riskFlags,
      }
    }
    return {
      ...(await queuePremiumFallback({
        supabase: params.supabase,
        runId: params.runId,
        article,
        sourceContext,
        reason: `quality_not_ok:${parsed.output.quality_reason || 'unspecified'}`,
        startedAt,
      })),
      costUsd: writer.costUsd + repairCost,
      validationWarnings: parsed.validation.warnings,
      repairs: parsed.repairs,
      riskFlags,
    }
  }

  let reviewResult: ClaudeReviewerResult | null = null
  let reviewCost = 0
  const reviewDecision = shouldReviewWithClaude({
    config,
    context,
    validation: parsed.validation,
    output: parsed.output,
  })
  if (!params.anthropicDegraded.active && args.mode === 'balanced' && reviewDecision.shouldReview) {
    const review = await reviewWithClaude({
      supabase: params.supabase,
      article,
      runId: params.runId,
      context,
      output: parsed.output,
      validation: parsed.validation,
      reasons: reviewDecision.reasons,
    })
    reviewResult = review.result
    reviewCost = review.costUsd
    if (!reviewResult || !reviewResult.pass || reviewResult.publish_recommendation !== 'publish') {
      return {
        ...(await queuePremiumFallback({
          supabase: params.supabase,
          runId: params.runId,
          article,
          sourceContext,
          reason: `review_rejected:${reviewResult?.publish_recommendation ?? review.error ?? 'failed'}`,
          startedAt,
        })),
        costUsd: writer.costUsd + repairCost + reviewCost,
        validationWarnings: parsed.validation.warnings,
        repairs: parsed.repairs,
        riskFlags,
      }
    }
  }

  const prepared = await prepareEditorialApplication({
    supabase: params.supabase,
    article,
    output: parsed.output,
    validation: parsed.validation,
    repairs: parsed.repairs,
    sourceContext,
    runId: params.runId,
    phase: 'routing',
    attemptNo: (article.attempt_count ?? 0) + 1,
    startedAt,
  })
  const applied = await applyEditorialDirect({
    supabase: params.supabase,
    article,
    claimToken: article.claim_token,
    attemptNo: (article.attempt_count ?? 0) + 1,
    startedAt,
    runId: params.runId,
    model: args.deepseekModel,
    sourceContext,
    prepared,
    payload: {
      provider: 'deepseek',
      mode: args.mode,
      degraded: params.anthropicDegraded.active,
      risk_flags: riskFlags,
      review_required: !params.anthropicDegraded.active && reviewDecision.shouldReview,
      review_reasons: reviewDecision.reasons,
      review_result: reviewResult,
    },
  })

  return {
    ...resultFor(article, applied ? 'applied' : 'failed', applied ? null : 'claim_release_failed', writer.costUsd + repairCost + reviewCost),
    validationWarnings: parsed.validation.warnings,
    repairs: parsed.repairs,
    riskFlags,
  }
}

function resultFor(article: Article, status: RoutingStatus, reason: string | null, costUsd: number): RoutingResult {
  return {
    articleId: article.id,
    title: article.original_title,
    status,
    reason,
    costUsd: roundUsd(costUsd),
  }
}

async function main(): Promise<void> {
  validateApplyEnv()
  const supabase = getServerClient()
  const runId = args.apply
    ? await createEnrichRun(supabase, args.limit, 'sync')
    : `dry-run-${Date.now()}`
  const oldestPendingAgeMinutes = args.apply ? await getOldestPendingAgeMinutes(supabase) : null
  const rejectedBreakdown: Record<string, number> = {}
  const metrics: EnrichRunMetrics = {
    claimed: 0,
    enrichedOk: 0,
    rejected: 0,
    retryable: 0,
    failed: 0,
    oldestPendingAgeMinutes,
    usage: ZERO_USAGE_TOTALS,
    errorSummary: null,
    rejectedBreakdown,
  }
  const spentTodayUsd = args.apply ? await getTodayDeepSeekSpend(supabase) : 0
  const anthropicDegraded = args.apply && allowsAnthropicFallback(args.mode)
    ? await getAnthropicDegradedState(supabase)
    : { active: false, reason: null, firstSeenAt: null, lastSeenAt: null }
  const articles = args.apply
    ? await claimBatch(supabase, args.limit)
    : await selectDryRunArticles(supabase, args.limit)
  metrics.claimed = articles.length

  log(`editorial-routing mode=${args.mode} apply=${args.apply} limit=${args.limit} selected=${articles.length}`)
  log(`deepseek budget today: spent=$${spentTodayUsd.toFixed(4)} cap=$${args.deepseekDailyBudgetUsd.toFixed(2)}`)
  if (anthropicDegraded.active) log(`anthropic degraded active: ${anthropicDegraded.reason ?? 'no reason'}`)

  const results: RoutingResult[] = []
  let rollingDeepSeekSpend = spentTodayUsd
  for (const article of articles) {
    const hydrated = await hydrateArticle(supabase, runId, article)
    if (!hydrated.hydrated) {
      if (hydrated.result) results.push(hydrated.result)
      continue
    }

    const result = await routeArticle({
      supabase,
      runId,
      hydrated: hydrated.hydrated,
      spentTodayUsd: rollingDeepSeekSpend,
      anthropicDegraded,
    })
    results.push(result)
    rollingDeepSeekSpend = roundUsd(rollingDeepSeekSpend + result.costUsd)
  }

  for (const result of results) {
    if (result.status === 'applied') metrics.enrichedOk++
    else if (result.status === 'rejected') {
      metrics.rejected++
      bumpRejectedBreakdown(rejectedBreakdown, result.reason ?? 'unspecified')
    } else if (result.status === 'fallback_queued' || result.status === 'skipped') {
      metrics.retryable++
    } else if (result.status === 'failed') {
      metrics.failed++
    }
    metrics.usage = addUsageTotals(metrics.usage, { estimatedCostUsd: result.costUsd })
  }

  metrics.errorSummary =
    `editorial_routing mode=${args.mode}; apply=${args.apply}; ` +
    `applied=${metrics.enrichedOk}; rejected=${metrics.rejected}; ` +
    `fallback_or_skipped=${metrics.retryable}; failed=${metrics.failed}`

  if (args.apply) {
    await finishEnrichRun(supabase, runId, metrics)
  }

  const report = {
    generated_at: new Date().toISOString(),
    mode: args.mode,
    apply: args.apply,
    limit: args.limit,
    run_id: args.apply ? runId : null,
    selected_count: articles.length,
    deepseek_daily_budget_usd: args.deepseekDailyBudgetUsd,
    deepseek_spent_before_usd: spentTodayUsd,
    metrics: {
      applied: metrics.enrichedOk,
      rejected: metrics.rejected,
      fallback_or_skipped: metrics.retryable,
      failed: metrics.failed,
      estimated_text_cost_usd: roundUsd(results.reduce((sum, result) => sum + result.costUsd, 0)),
    },
    results,
  }
  console.log(JSON.stringify(report, null, 2))
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(async (error) => {
    const message = error instanceof Error ? error.message : String(error)
    console.error(message)
    process.exit(1)
  })
}
