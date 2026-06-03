/**
 * bot/channel-post-core.ts
 *
 * Telegram channel delivery: five standalone photo posts per Moscow day.
 * The old daily digest remains as legacy code, but production delivery uses
 * telegram_channel_posts as the slot-level source of truth.
 */

import { createHash } from 'crypto'
import OpenAI from 'openai'

import { getArticleUrl } from '../lib/article-slugs'
import { readSiteUrlFromEnv } from '../lib/site'
import { getServerClient } from '../lib/supabase'
import type { Article } from '../lib/supabase'
import { getMoscowDateKey } from '../lib/utils'
import { writeLlmUsageLog, ZERO_USAGE_TOTALS, type UsageTotals } from '../pipeline/llm-usage'
import { estimateTextCostUsd, type TextUsageForCost } from '../pipeline/model-pricing'
import { assertServiceRoleKey, markArticlesSent } from './daily-digest-core'
import {
  deriveDigestStory,
  selectDigestArticles,
  type DigestSelectionArticle,
} from './digest-selection'

const MSK_OFFSET_MS = 3 * 60 * 60 * 1000
const SLOT_COUNT = 5
const MIN_ARTICLES_TO_SEND = 3
const RECENT_STORY_MEMORY_HOURS = 72
const CAPTION_LIMIT = 1024
const DEEPSEEK_CAPTION_OPERATION = 'deepseek_tg_channel_caption'
const DEFAULT_DEEPSEEK_CAPTION_MODEL = 'deepseek-v4-flash'
const DEFAULT_DEEPSEEK_CAPTION_DAILY_BUDGET_USD = 0.05

export type ChannelPostStatus =
  | 'planned'
  | 'sending'
  | 'success'
  | 'failed_send'
  | 'skipped_low_articles'
  | 'skipped_no_article'

export interface TelegramChannelPostRow {
  id: string
  delivery_date: string
  content_date: string
  slot_no: number
  channel_id: string
  article_id: string | null
  status: ChannelPostStatus
  telegram_message_id: number | null
  caption: string | null
  caption_hash: string | null
  article_url: string | null
  cover_image_url: string | null
  story_key: string | null
  planned_at: string | null
  claimed_at: string | null
  sent_at: string | null
  failed_at: string | null
  error_message: string | null
  created_at: string
  updated_at: string
}

export type ChannelPostCandidate = Pick<
  Article,
  | 'id'
  | 'source_name'
  | 'original_title'
  | 'ru_title'
  | 'lead'
  | 'card_teaser'
  | 'tg_teaser'
  | 'source_lang'
  | 'primary_category'
  | 'secondary_categories'
  | 'topics'
  | 'score'
  | 'pub_date'
  | 'slug'
  | 'cover_image_url'
>

export interface ChannelPostPlanItem {
  delivery_date: string
  content_date: string
  slot_no: number
  channel_id: string
  article_id: string | null
  status: Exclude<ChannelPostStatus, 'sending' | 'success' | 'failed_send'>
  caption: string | null
  caption_hash: string | null
  article_url: string | null
  cover_image_url: string | null
  story_key: string | null
  planned_at: string
  error_message: string | null
}

interface TelegramPhotoResponse {
  ok: boolean
  description?: string
  result?: { message_id?: number }
}

type ChannelPostSupabase = ReturnType<typeof getServerClient>

export type ChannelPostResult =
  | { status: 'success'; slot: number; messageId: number; articleId: string }
  | { status: 'skipped_already_sent'; slot: number; messageId?: number | null }
  | { status: 'skipped_low_articles'; slot: number }
  | { status: 'skipped_no_article'; slot: number }
  | { status: 'skipped_no_plan'; slot: number }
  | { status: 'skipped_already_claimed'; slot: number }
  | { status: 'failed'; slot: number; error: string }
  | { status: 'preflight_failed'; reason: string }

function log(message: string): void {
  console.log(`[${new Date().toISOString().replace('T', ' ').slice(0, 19)}] ${message}`)
}

function logError(message: string, error?: unknown): void {
  const detail =
    error instanceof Error ? error.message :
    error && typeof error === 'object' && 'message' in error ? String((error as Record<string, unknown>).message) :
    String(error ?? '')
  console.error(`[${new Date().toISOString().replace('T', ' ').slice(0, 19)}] ERROR: ${message}${detail ? ` — ${detail}` : ''}`)
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function truncatePlain(text: string, maxLength: number): string {
  const normalized = text.replace(/\s+/g, ' ').trim()
  if (normalized.length <= maxLength) return normalized
  if (maxLength <= 1) return '…'
  return `${normalized.slice(0, maxLength - 1).trimEnd()}…`
}

type CaptionArticle = Pick<ChannelPostCandidate, 'ru_title' | 'original_title' | 'tg_teaser'> &
  Partial<Pick<
    ChannelPostCandidate,
    | 'id'
    | 'source_name'
    | 'source_lang'
    | 'lead'
    | 'card_teaser'
    | 'primary_category'
    | 'secondary_categories'
    | 'topics'
    | 'score'
    | 'pub_date'
  >>

const TITLE_MAX_LENGTH = 140
const BODY_MAX_LENGTH = 520
const DANGLING_TITLE_WORDS = new Set([
  'в', 'во', 'на', 'для', 'по', 'из', 'с', 'со', 'к', 'ко', 'о', 'об', 'обо',
  'от', 'до', 'за', 'над', 'под', 'при', 'про', 'и', 'или',
])
const FORBIDDEN_CAPTION_PHRASES = [
  'не просто',
  'не только',
  'главное не',
  'смотрим не на хайп',
  'это не',
  'а значит',
  'важны не сами по себе',
  'не столько',
  'дело не',
  'не в факте новости',
  'какой сдвиг она показывает',
]

interface TelegramCaptionParts {
  title: string
  body: string
}

function trimDanglingTitleWords(value: string): string {
  const words = value.trim().split(/\s+/)
  while (words.length > 1) {
    const last = words[words.length - 1]!
      .replace(/[.,:;!?»)"'`]+$/g, '')
      .toLowerCase()
    if (!DANGLING_TITLE_WORDS.has(last)) break
    words.pop()
  }
  return words.join(' ').trim()
}

function truncateAtWordBoundary(text: string, maxLength: number): string {
  const normalized = text.replace(/\s+/g, ' ').trim()
  if (normalized.length <= maxLength) return trimDanglingTitleWords(normalized)

  const cut = normalized.slice(0, maxLength + 1)
  const lastSpace = cut.lastIndexOf(' ')
  const candidate = lastSpace > 40 ? cut.slice(0, lastSpace) : normalized.slice(0, maxLength)
  return `${trimDanglingTitleWords(candidate).replace(/[.,:;!?-]+$/g, '').trim()}…`
}

function cleanCaptionText(value: string): string {
  return value
    .replace(/\s+/g, ' ')
    .replace(/^[—–-]\s*/, '')
    .trim()
}

function hasForbiddenCaptionPhrase(value: string): boolean {
  const normalized = value.toLowerCase().replace(/\s+/g, ' ')
  return FORBIDDEN_CAPTION_PHRASES.some((phrase) => normalized.includes(phrase))
}

function validateCaptionParts(value: unknown): TelegramCaptionParts | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  const title = typeof record.title === 'string' ? cleanCaptionText(record.title) : ''
  const body = typeof record.body === 'string' ? cleanCaptionText(record.body) : ''
  if (!title || !body) return null
  if (hasForbiddenCaptionPhrase(`${title} ${body}`)) return null
  return {
    title: truncateAtWordBoundary(title, 120),
    body: truncatePlain(body, BODY_MAX_LENGTH),
  }
}

function parseJsonObject(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    const match = text.match(/\{[\s\S]*\}/)
    if (!match) return null
    try {
      return JSON.parse(match[0])
    } catch {
      return null
    }
  }
}

function fallbackCaptionParts(article: CaptionArticle): TelegramCaptionParts {
  const title = truncateAtWordBoundary(article.ru_title ?? article.original_title, TITLE_MAX_LENGTH)
  const bodySource = article.tg_teaser ?? article.lead ?? article.card_teaser ?? article.original_title
  return {
    title,
    body: truncatePlain(bodySource, BODY_MAX_LENGTH),
  }
}

function formatTelegramCaption(parts: TelegramCaptionParts, maxLength = CAPTION_LIMIT): string {
  for (let bodyLimit = BODY_MAX_LENGTH; bodyLimit >= 80; bodyLimit -= 40) {
    const body = truncatePlain(parts.body, bodyLimit)
    const caption = `<b>${escapeHtml(parts.title)}</b>${body ? `\n\n${escapeHtml(body)}` : ''}`
    if (caption.length <= maxLength) return caption
  }

  const title = truncateAtWordBoundary(parts.title, 120)
  return `<b>${escapeHtml(title)}</b>`
}

export function buildTelegramCaptionFromDeepSeekJson(
  article: CaptionArticle,
  value: unknown,
  maxLength = CAPTION_LIMIT,
): string | null {
  const parts = validateCaptionParts(value)
  if (!parts) return null
  const caption = formatTelegramCaption(parts, maxLength)
  return caption.length <= maxLength ? caption : formatTelegramCaption(fallbackCaptionParts(article), maxLength)
}

export function buildTelegramCaption(
  article: CaptionArticle,
  maxLength = CAPTION_LIMIT,
): string {
  return formatTelegramCaption(fallbackCaptionParts(article), maxLength)
}

function captionHash(caption: string | null): string | null {
  return caption ? createHash('sha256').update(caption).digest('hex').slice(0, 32) : null
}

function numberEnv(name: string, fallback: number): number {
  const value = Number(process.env[name])
  return Number.isFinite(value) && value > 0 ? value : fallback
}

function deepSeekClient(): OpenAI | null {
  const apiKey = process.env.DEEPSEEK_API_KEY
  if (!apiKey) return null
  return new OpenAI({
    apiKey,
    baseURL: process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com',
    timeout: numberEnv('DEEPSEEK_TELEGRAM_CAPTION_TIMEOUT_MS', 45_000),
    maxRetries: numberEnv('DEEPSEEK_MAX_RETRIES', 1),
  })
}

function deepSeekCaptionModel(): string {
  return process.env.DEEPSEEK_TELEGRAM_CAPTION_MODEL
    ?? process.env.DEEPSEEK_WRITER_MODEL
    ?? DEFAULT_DEEPSEEK_CAPTION_MODEL
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

function usageToTotals(model: string, usage: TextUsageForCost): UsageTotals {
  return {
    inputTokens: usage.inputTokens ?? 0,
    outputTokens: usage.outputTokens ?? 0,
    cacheReadTokens: usage.cacheHitInputTokens ?? 0,
    cacheCreateTokens: 0,
    estimatedCostUsd: estimateTextCostUsd({ provider: 'deepseek', model, usage }),
  }
}

function moscowDayStartIso(dateKey = getMoscowDateKey()): string {
  const [year, month, day] = dateKey.split('-').map(Number)
  return new Date(Date.UTC(year, (month ?? 1) - 1, day ?? 1, 0, 0, 0) - MSK_OFFSET_MS).toISOString()
}

async function getTodayTelegramCaptionSpend(supabase: ChannelPostSupabase): Promise<number> {
  const { data, error } = await supabase
    .from('llm_usage_logs')
    .select('estimated_cost_usd')
    .eq('provider', 'deepseek')
    .eq('operation', DEEPSEEK_CAPTION_OPERATION)
    .gte('created_at', moscowDayStartIso())
    .limit(100)

  if (error) throw new Error(`DeepSeek Telegram caption spend query failed: ${error.message}`)
  return (data ?? []).reduce((sum, row) => sum + Number(row.estimated_cost_usd ?? 0), 0)
}

function buildDeepSeekCaptionPrompt(article: CaptionArticle): { system: string; user: string } {
  const system = [
    'Ты редактор русскоязычного AI-медиа Malakhov AI Digest.',
    'Напиши короткую подпись для Telegram-поста простым, живым и понятным языком.',
    'Структура ответа строго JSON: {"title":"...","body":"..."}.',
    'title: до 120 символов, нормальный русский заголовок, не обрывай его на предлоге или союзе.',
    'body: 180-360 символов, 2-3 предложения: что произошло, почему это важно, что читатель узнает.',
    'Не используй bullets, эмодзи, служебные ярлыки, обращение на "ты", канцелярит и маркетинговые фразы.',
    'Запрещены конструкции: "не просто", "не только", "главное не", "смотрим не на хайп", "это не", "а значит".',
    'Не добавляй фактов, которых нет во входных данных.',
    'Верни только JSON.',
  ].join('\n')

  const user = JSON.stringify({
    ru_title: article.ru_title,
    original_title: article.original_title,
    lead: article.lead,
    tg_teaser: article.tg_teaser,
    card_teaser: article.card_teaser,
    source_name: article.source_name,
    primary_category: article.primary_category,
  }, null, 2)

  return { system, user: `Входные данные статьи:\n${user}` }
}

function estimateCaptionRequestCost(model: string, system: string, user: string): number {
  const inputTokens = Math.ceil((system.length + user.length) / 4)
  return estimateTextCostUsd({
    provider: 'deepseek',
    model,
    usage: {
      inputTokens,
      outputTokens: 220,
      cacheMissInputTokens: inputTokens,
      cacheHitInputTokens: 0,
    },
  })
}

async function writeCaptionUsage(params: {
  supabase: ChannelPostSupabase
  model: string
  article: CaptionArticle
  slotNo: number
  deliveryDate: string
  attempt: number
  status: 'ok' | 'failed'
  usage: UsageTotals
  error?: string | null
}): Promise<void> {
  await writeLlmUsageLog({
    supabase: params.supabase,
    provider: 'deepseek',
    model: params.model,
    operation: DEEPSEEK_CAPTION_OPERATION,
    runKind: 'telegram_channel_post',
    articleId: params.article.id ?? null,
    sourceName: params.article.source_name ?? null,
    sourceLang: params.article.source_lang ?? null,
    originalTitle: params.article.original_title,
    resultStatus: params.status,
    metadata: {
      delivery_date: params.deliveryDate,
      slot_no: params.slotNo,
      attempt: params.attempt,
      error: params.error ?? null,
    },
    usage: params.usage,
  })
}

async function generateDeepSeekTelegramCaption(params: {
  supabase: ChannelPostSupabase
  client: OpenAI
  article: CaptionArticle
  model: string
  deliveryDate: string
  slotNo: number
}): Promise<{ caption: string | null; costUsd: number }> {
  let totalCostUsd = 0
  let lastError: string | null = null

  for (let attempt = 1; attempt <= 2; attempt++) {
    const prompt = buildDeepSeekCaptionPrompt(params.article)
    const retryNote = attempt === 1 ? '' : '\nПредыдущий ответ нарушил правила. Перепиши без запрещённых конструкций и верни только JSON.'

    try {
      const response = await params.client.chat.completions.create({
        model: params.model,
        temperature: 0.55,
        max_tokens: 320,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: prompt.system },
          { role: 'user', content: `${prompt.user}${retryNote}` },
        ],
      } as any)

      const usage = usageToTotals(params.model, deepSeekUsage(response.usage))
      totalCostUsd += usage.estimatedCostUsd
      const rawText = response.choices[0]?.message?.content ?? ''
      const caption = buildTelegramCaptionFromDeepSeekJson(params.article, parseJsonObject(rawText))
      await writeCaptionUsage({
        supabase: params.supabase,
        model: params.model,
        article: params.article,
        deliveryDate: params.deliveryDate,
        slotNo: params.slotNo,
        attempt,
        status: caption ? 'ok' : 'failed',
        usage,
        error: caption ? null : 'invalid_or_forbidden_caption',
      })

      if (caption) return { caption, costUsd: totalCostUsd }
      lastError = 'invalid_or_forbidden_caption'
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
      await writeCaptionUsage({
        supabase: params.supabase,
        model: params.model,
        article: params.article,
        deliveryDate: params.deliveryDate,
        slotNo: params.slotNo,
        attempt,
        status: 'failed',
        usage: ZERO_USAGE_TOTALS,
        error: lastError,
      })
    }
  }

  logError(`DeepSeek Telegram caption fallback for article ${params.article.id ?? params.article.original_title}`, lastError)
  return { caption: null, costUsd: totalCostUsd }
}

function hasLegacyBadCaptionShape(caption: string | null): boolean {
  if (!caption) return false
  return caption.includes('<b>Зачем открыть:</b>') || hasForbiddenCaptionPhrase(caption)
}

type CaptionGenerator = (article: ChannelPostCandidate, slotNo: number) => Promise<string | null>

async function createCaptionGenerator(
  supabase: ChannelPostSupabase,
  deliveryDate: string,
): Promise<CaptionGenerator> {
  const client = deepSeekClient()
  if (!client) {
    log('DEEPSEEK_API_KEY missing; Telegram captions use local fallback')
    return async () => null
  }

  const model = deepSeekCaptionModel()
  const budget = numberEnv('DEEPSEEK_TELEGRAM_CAPTION_DAILY_BUDGET_USD', DEFAULT_DEEPSEEK_CAPTION_DAILY_BUDGET_USD)
  let spent = 0
  try {
    spent = await getTodayTelegramCaptionSpend(supabase)
  } catch (error) {
    logError('DeepSeek Telegram caption spend check failed; using local fallback', error)
    return async () => null
  }

  return async (article, slotNo) => {
    const prompt = buildDeepSeekCaptionPrompt(article)
    const estimatedCost = estimateCaptionRequestCost(model, prompt.system, prompt.user)
    if (budget > 0 && spent + estimatedCost > budget) {
      log(`DeepSeek Telegram caption budget cap reached: spent=$${spent.toFixed(6)} cap=$${budget.toFixed(2)}`)
      return null
    }

    const result = await generateDeepSeekTelegramCaption({
      supabase,
      client,
      article,
      model,
      deliveryDate,
      slotNo,
    })
    spent += result.costUsd
    return result.caption
  }
}

export async function applyGeneratedCaptionsToPlan(
  rows: ChannelPostPlanItem[],
  candidates: ChannelPostCandidate[],
  generateCaption: CaptionGenerator,
): Promise<ChannelPostPlanItem[]> {
  const articleById = new Map(candidates.map((article) => [article.id, article]))
  const updated: ChannelPostPlanItem[] = []

  for (const row of rows) {
    if (row.status !== 'planned' || !row.article_id) {
      updated.push(row)
      continue
    }

    const article = articleById.get(row.article_id)
    const generated = article ? await generateCaption(article, row.slot_no) : null
    const caption = generated ?? row.caption ?? (article ? buildTelegramCaption(article) : null)
    updated.push({
      ...row,
      caption,
      caption_hash: captionHash(caption),
    })
  }

  return updated
}

function isPostableCandidate(article: ChannelPostCandidate): article is ChannelPostCandidate & {
  slug: string
  cover_image_url: string
  tg_teaser: string
} {
  return Boolean(article.slug && article.cover_image_url && article.tg_teaser)
}

export function moscowDayWindowForDelivery(now = new Date()): {
  deliveryDate: string
  contentDate: string
  from: string
  to: string
} {
  const moscowNow = new Date(now.getTime() + MSK_OFFSET_MS)
  const deliveryDate = moscowNow.toISOString().slice(0, 10)
  const content = new Date(moscowNow)
  content.setUTCDate(content.getUTCDate() - 1)
  const contentDate = content.toISOString().slice(0, 10)

  const from = new Date(
    Date.UTC(content.getUTCFullYear(), content.getUTCMonth(), content.getUTCDate(), 0, 0, 0) - MSK_OFFSET_MS,
  )
  const to = new Date(
    Date.UTC(content.getUTCFullYear(), content.getUTCMonth(), content.getUTCDate(), 23, 59, 59) - MSK_OFFSET_MS,
  )

  return { deliveryDate, contentDate, from: from.toISOString(), to: to.toISOString() }
}

export function parseSlot(raw: string | number | null | undefined): number | null {
  const slot = typeof raw === 'number' ? raw : Number(raw)
  return Number.isInteger(slot) && slot >= 1 && slot <= SLOT_COUNT ? slot : null
}

function articleUrl(siteUrl: string, article: Pick<ChannelPostCandidate, 'slug' | 'primary_category'>, slot: number, deliveryDate: string): string {
  const campaign = deliveryDate.replace(/-/g, '')
  return `${getArticleUrl(siteUrl, article.slug!, article.primary_category)}?utm_source=tg&utm_medium=channel&utm_campaign=dayfeed_${campaign}&utm_content=slot_${slot}`
}

export function buildChannelPostPlan(
  candidates: ChannelPostCandidate[],
  recentSentArticles: DigestSelectionArticle[],
  options: {
    deliveryDate: string
    contentDate: string
    channelId: string
    siteUrl: string
    plannedAt?: string
  },
): ChannelPostPlanItem[] {
  const plannedAt = options.plannedAt ?? new Date().toISOString()
  const postableCandidates = candidates.filter(isPostableCandidate)
  const selection = selectDigestArticles(postableCandidates, recentSentArticles, {
    perSourceCap: 2,
    perPrimaryEntityCap: 2,
    target: SLOT_COUNT,
  })

  if (selection.articles.length < MIN_ARTICLES_TO_SEND) {
    return Array.from({ length: SLOT_COUNT }, (_, index) => ({
      delivery_date: options.deliveryDate,
      content_date: options.contentDate,
      slot_no: index + 1,
      channel_id: options.channelId,
      article_id: null,
      status: 'skipped_low_articles' as const,
      caption: null,
      caption_hash: null,
      article_url: null,
      cover_image_url: null,
      story_key: null,
      planned_at: plannedAt,
      error_message: `eligible_articles=${selection.articles.length}, minimum=${MIN_ARTICLES_TO_SEND}`,
    }))
  }

  return Array.from({ length: SLOT_COUNT }, (_, index) => {
    const slotNo = index + 1
    const article = selection.articles[index]
    if (!article) {
      return {
        delivery_date: options.deliveryDate,
        content_date: options.contentDate,
        slot_no: slotNo,
        channel_id: options.channelId,
        article_id: null,
        status: 'skipped_no_article' as const,
        caption: null,
        caption_hash: null,
        article_url: null,
        cover_image_url: null,
        story_key: null,
        planned_at: plannedAt,
        error_message: 'not_enough_selected_articles_for_slot',
      }
    }

    const caption = buildTelegramCaption(article)
    const story = deriveDigestStory(article)
    return {
      delivery_date: options.deliveryDate,
      content_date: options.contentDate,
      slot_no: slotNo,
      channel_id: options.channelId,
      article_id: article.id,
      status: 'planned' as const,
      caption,
      caption_hash: captionHash(caption),
      article_url: articleUrl(options.siteUrl, article, slotNo, options.deliveryDate),
      cover_image_url: article.cover_image_url,
      story_key: story.storyKey,
      planned_at: plannedAt,
      error_message: null,
    }
  })
}

async function isArticleLive(siteUrl: string, article: ChannelPostCandidate): Promise<boolean> {
  if (!article.slug) return false
  try {
    const res = await fetch(getArticleUrl(siteUrl, article.slug, article.primary_category), {
      method: 'HEAD',
      signal: AbortSignal.timeout(5_000),
    })
    return res.ok
  } catch {
    return false
  }
}

async function filterLiveArticles(articles: ChannelPostCandidate[], siteUrl: string): Promise<ChannelPostCandidate[]> {
  const results = await Promise.all(
    articles.map(async (article) => {
      const live = await isArticleLive(siteUrl, article)
      if (!live) log(`Страница недоступна, пропускаем для Telegram channel post: ${article.slug ?? article.id}`)
      return live ? article : null
    }),
  )
  return results.filter((article): article is ChannelPostCandidate => article !== null)
}

async function fetchRecentSentArticles(
  supabase: ChannelPostSupabase,
  sinceIso: string,
): Promise<Article[]> {
  const ids = new Set<string>()

  const { data: digestRuns, error: digestError } = await supabase
    .from('digest_runs')
    .select('article_ids')
    .eq('status', 'success')
    .gte('sent_at', sinceIso)
    .order('sent_at', { ascending: false, nullsFirst: false })
    .limit(10)

  if (digestError) throw new Error(`recent digest query failed: ${digestError.message}`)
  for (const run of digestRuns ?? []) {
    for (const id of Array.isArray(run.article_ids) ? run.article_ids : []) {
      if (typeof id === 'string') ids.add(id)
    }
  }

  const { data: postRows, error: postError } = await supabase
    .from('telegram_channel_posts')
    .select('article_id')
    .eq('status', 'success')
    .gte('sent_at', sinceIso)
    .not('article_id', 'is', null)
    .order('sent_at', { ascending: false, nullsFirst: false })
    .limit(30)

  if (postError) throw new Error(`recent channel posts query failed: ${postError.message}`)
  for (const row of postRows ?? []) {
    if (typeof row.article_id === 'string') ids.add(row.article_id)
  }

  if (ids.size === 0) return []

  const { data: articles, error: articlesError } = await supabase
    .from('articles')
    .select('*')
    .in('id', [...ids])

  if (articlesError) throw new Error(`recent sent articles query failed: ${articlesError.message}`)
  return (articles ?? []) as Article[]
}

async function fetchExistingPlan(
  supabase: ChannelPostSupabase,
  deliveryDate: string,
  channelId: string,
): Promise<TelegramChannelPostRow[]> {
  const { data, error } = await supabase
    .from('telegram_channel_posts')
    .select('*')
    .eq('delivery_date', deliveryDate)
    .eq('channel_id', channelId)
    .order('slot_no', { ascending: true })
    .limit(SLOT_COUNT)

  if (error) throw new Error(`telegram_channel_posts plan query failed: ${error.message}`)
  return (data ?? []) as TelegramChannelPostRow[]
}

async function insertPlanRows(
  supabase: ChannelPostSupabase,
  rows: ChannelPostPlanItem[],
): Promise<TelegramChannelPostRow[]> {
  const { data, error } = await supabase
    .from('telegram_channel_posts')
    .insert(rows)
    .select('*')

  if (error) {
    if ('code' in error && error.code === '23505') {
      return []
    }
    throw new Error(`telegram_channel_posts plan insert failed: ${error.message}`)
  }
  return (data ?? []) as TelegramChannelPostRow[]
}

async function refreshExistingPlannedCaptions(
  supabase: ChannelPostSupabase,
  rows: TelegramChannelPostRow[],
  deliveryDate: string,
): Promise<TelegramChannelPostRow[]> {
  const refreshable = rows.filter((row) => (
    row.status === 'planned' &&
    typeof row.article_id === 'string' &&
    hasLegacyBadCaptionShape(row.caption)
  ))
  if (refreshable.length === 0) return rows

  const ids = [...new Set(refreshable.map((row) => row.article_id).filter((id): id is string => Boolean(id)))]
  const { data, error } = await supabase
    .from('articles')
    .select('*')
    .in('id', ids)

  if (error) {
    logError('Could not load articles for Telegram planned caption refresh', error)
    return rows
  }

  const articleById = new Map(((data ?? []) as Article[]).map((article) => [article.id, article as ChannelPostCandidate]))
  const generateCaption = await createCaptionGenerator(supabase, deliveryDate)
  const updatedById = new Map<string, TelegramChannelPostRow>()

  for (const row of refreshable) {
    const article = row.article_id ? articleById.get(row.article_id) : null
    if (!article) continue

    const generated = await generateCaption(article, row.slot_no)
    const caption = generated ?? buildTelegramCaption(article)
    const hash = captionHash(caption)
    if (!caption || caption === row.caption) continue

    const { data: updated, error: updateError } = await supabase
      .from('telegram_channel_posts')
      .update({ caption, caption_hash: hash })
      .eq('id', row.id)
      .eq('status', 'planned')
      .select('*')

    if (updateError) {
      logError(`Could not refresh Telegram planned caption row=${row.id}`, updateError)
      continue
    }

    const next = ((updated ?? []) as TelegramChannelPostRow[])[0]
    if (next) updatedById.set(next.id, next)
  }

  return rows.map((row) => updatedById.get(row.id) ?? row)
}

async function ensureDailyPlan(
  supabase: ChannelPostSupabase,
  opts: {
    deliveryDate: string
    contentDate: string
    from: string
    to: string
    channelId: string
    siteUrl: string
  },
): Promise<TelegramChannelPostRow[]> {
  const existing = await fetchExistingPlan(supabase, opts.deliveryDate, opts.channelId)
  if (existing.length > 0) return refreshExistingPlannedCaptions(supabase, existing, opts.deliveryDate)

  const { data, error } = await supabase
    .from('articles')
    .select('*')
    .eq('published', true)
    .eq('quality_ok', true)
    .eq('verified_live', true)
    .eq('publish_status', 'live')
    .eq('tg_sent', false)
    .not('tg_teaser', 'is', null)
    .not('slug', 'is', null)
    .not('cover_image_url', 'is', null)
    .gte('pub_date', opts.from)
    .lte('pub_date', opts.to)
    .order('score', { ascending: false })
    .order('pub_date', { ascending: false })
    .limit(50)

  if (error) throw new Error(`channel post candidate query failed: ${error.message}`)

  const candidates = await filterLiveArticles((data ?? []) as Article[], opts.siteUrl)
  const sinceIso = new Date(Date.now() - RECENT_STORY_MEMORY_HOURS * 60 * 60 * 1000).toISOString()
  let recentSentArticles: Article[] = []
  try {
    recentSentArticles = await fetchRecentSentArticles(supabase, sinceIso)
  } catch (err) {
    logError('Recent Telegram story memory failed; planning with same-day dedup only', err)
  }

  let rows = buildChannelPostPlan(candidates, recentSentArticles, {
    deliveryDate: opts.deliveryDate,
    contentDate: opts.contentDate,
    channelId: opts.channelId,
    siteUrl: opts.siteUrl,
  })
  rows = await applyGeneratedCaptionsToPlan(
    rows,
    candidates,
    await createCaptionGenerator(supabase, opts.deliveryDate),
  )

  const inserted = await insertPlanRows(supabase, rows)
  if (inserted.length > 0) {
    log(`Запланировано Telegram channel posts: ${inserted.length} слотов`)
    return inserted
  }

  return fetchExistingPlan(supabase, opts.deliveryDate, opts.channelId)
}

async function claimSlot(
  supabase: ChannelPostSupabase,
  row: TelegramChannelPostRow,
): Promise<TelegramChannelPostRow | null> {
  const { data, error } = await supabase
    .from('telegram_channel_posts')
    .update({
      status: 'sending',
      claimed_at: new Date().toISOString(),
      error_message: null,
    })
    .eq('id', row.id)
    .eq('status', 'planned')
    .select('*')

  if (error) throw new Error(`channel post claim failed: ${error.message}`)
  return ((data ?? []) as TelegramChannelPostRow[])[0] ?? null
}

async function finalizeSuccess(
  supabase: ChannelPostSupabase,
  rowId: string,
  messageId: number,
): Promise<void> {
  const { error } = await supabase
    .from('telegram_channel_posts')
    .update({
      status: 'success',
      telegram_message_id: messageId,
      sent_at: new Date().toISOString(),
      error_message: null,
    })
    .eq('id', rowId)

  if (error) throw new Error(`channel post success finalize failed: ${error.message}`)
}

async function finalizeFailure(
  supabase: ChannelPostSupabase,
  rowId: string,
  err: unknown,
): Promise<void> {
  const { error } = await supabase
    .from('telegram_channel_posts')
    .update({
      status: 'failed_send',
      failed_at: new Date().toISOString(),
      error_message: err instanceof Error ? err.message : String(err),
    })
    .eq('id', rowId)

  if (error) throw new Error(`channel post failure finalize failed: ${error.message}`)
}

export async function sendTelegramPhoto(
  botToken: string,
  chatId: string,
  photoUrl: string,
  caption: string,
  articleUrlValue: string,
): Promise<{ result: { message_id: number } }> {
  const res = await fetch(`https://api.telegram.org/bot${botToken}/sendPhoto`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      photo: photoUrl,
      caption,
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [[{ text: 'Читать на сайте', url: articleUrlValue }]],
      },
    }),
  })

  const data = (await res.json()) as TelegramPhotoResponse
  if (!res.ok || !data.ok) {
    throw new Error(data.description ?? `Telegram sendPhoto failed: ${res.status}`)
  }
  if (typeof data.result?.message_id !== 'number') {
    throw new Error('Telegram sendPhoto не вернул result.message_id')
  }
  return { result: { message_id: data.result.message_id } }
}

export async function deliverPlannedChannelPost(
  supabase: ChannelPostSupabase,
  row: TelegramChannelPostRow,
  botToken: string,
  sendPhoto = sendTelegramPhoto,
): Promise<ChannelPostResult> {
  if (row.status === 'success') {
    return { status: 'skipped_already_sent', slot: row.slot_no, messageId: row.telegram_message_id }
  }
  if (row.status === 'skipped_low_articles') return { status: 'skipped_low_articles', slot: row.slot_no }
  if (row.status === 'skipped_no_article') return { status: 'skipped_no_article', slot: row.slot_no }
  if (row.status !== 'planned') return { status: 'skipped_already_claimed', slot: row.slot_no }
  if (!row.article_id || !row.caption || !row.cover_image_url || !row.article_url) {
    return { status: 'skipped_no_article', slot: row.slot_no }
  }

  const claimed = await claimSlot(supabase, row)
  if (!claimed) return { status: 'skipped_already_claimed', slot: row.slot_no }

  try {
    const tgRes = await sendPhoto(botToken, row.channel_id, row.cover_image_url, row.caption, row.article_url)
    await finalizeSuccess(supabase, row.id, tgRes.result.message_id)
    try {
      await markArticlesSent(supabase, [row.article_id])
    } catch (err) {
      logError(`Telegram post sent, but tg_sent update failed for article ${row.article_id}`, err)
    }
    return {
      status: 'success',
      slot: row.slot_no,
      messageId: tgRes.result.message_id,
      articleId: row.article_id,
    }
  } catch (err) {
    await finalizeFailure(supabase, row.id, err).catch((finalizeErr) => {
      logError('Не удалось записать failed_send для Telegram channel post', finalizeErr)
    })
    return { status: 'failed', slot: row.slot_no, error: err instanceof Error ? err.message : String(err) }
  }
}

export async function runChannelPost(slotNo: number): Promise<ChannelPostResult> {
  const slot = parseSlot(slotNo)
  if (!slot) return { status: 'preflight_failed', reason: 'slot must be 1..5' }

  const botToken = process.env.TELEGRAM_BOT_TOKEN
  const channelId = process.env.TELEGRAM_CHANNEL_ID
  let siteUrl: string
  try {
    siteUrl = readSiteUrlFromEnv(process.env.NEXT_PUBLIC_SITE_URL)
  } catch (err) {
    return { status: 'preflight_failed', reason: err instanceof Error ? err.message : String(err) }
  }

  if (!botToken) return { status: 'preflight_failed', reason: 'TELEGRAM_BOT_TOKEN missing' }
  if (!channelId) return { status: 'preflight_failed', reason: 'TELEGRAM_CHANNEL_ID missing' }

  try {
    assertServiceRoleKey()
  } catch (err) {
    return { status: 'preflight_failed', reason: err instanceof Error ? err.message : String(err) }
  }

  const supabase = getServerClient()
  const window = moscowDayWindowForDelivery()
  const deliveryDate = getMoscowDateKey()
  const planRows = await ensureDailyPlan(supabase, {
    ...window,
    deliveryDate,
    channelId,
    siteUrl,
  })
  const row = planRows.find((item) => item.slot_no === slot) ?? null
  if (!row) return { status: 'skipped_no_plan', slot }

  const result = await deliverPlannedChannelPost(supabase, row, botToken)
  log(`Telegram channel post slot=${slot} result=${result.status}`)
  return result
}

export const _internals = {
  SLOT_COUNT,
  MIN_ARTICLES_TO_SEND,
  escapeHtml,
  truncatePlain,
  captionHash,
  articleUrl,
}
