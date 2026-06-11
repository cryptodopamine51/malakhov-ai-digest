import Anthropic from '@anthropic-ai/sdk'
import type { Message } from '@anthropic-ai/sdk/resources/messages/messages'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Article } from '../lib/supabase'
import { getArticleUrl } from '../lib/article-slugs'
import { readSiteUrlFromEnv, SITE_URL } from '../lib/site'
import { getMoscowDateKey, shiftMoscowDateKey, truncate } from '../lib/utils'
import { extractEditorialText } from './claude'
import { addUsageTotals, writeLlmUsageLog, ZERO_USAGE_TOTALS, type UsageTotals } from './llm-usage'
import { estimateTextCostUsd } from './model-pricing'

export const DEFAULT_QUALITY_JUDGE_MODEL = 'claude-haiku-4-5'
const CHANNEL_SAMPLE_SIZE = 5
const RANDOM_SAMPLE_SIZE = 5
const OWNER_FEEDBACK_MAX_MESSAGES = 8

export interface QualityJudgeArticle {
  id: string
  original_title: string
  original_text: string | null
  source_name: string
  source_lang: string
  ru_title: string | null
  lead: string | null
  summary: string[] | null
  card_teaser: string | null
  tg_teaser: string | null
  editorial_body: string | null
  editorial_model: string | null
  primary_category: string | null
  slug: string | null
  cover_image_url: string | null
  published_at: string | null
}

export interface QualityJudgeResult {
  score: number
  reasons: {
    source_grounding?: string
    lead_anchor?: string
    banned_phrases?: string
    usefulness?: string
    overall?: string
    [key: string]: unknown
  }
}

export interface QualityFeedbackItem {
  article: QualityJudgeArticle
  reason: string | null
  source: 'channel_post' | 'judge_worst'
  score?: number | null
}

export function inferWriterPath(article: Pick<QualityJudgeArticle, 'editorial_model'>): string {
  const model = (article.editorial_model ?? '').toLowerCase()
  if (model.includes('deepseek')) return 'deepseek'
  if (model.includes('haiku')) return 'haiku-fallback'
  if (model.includes('claude') || model.includes('sonnet')) return 'premium'
  return 'unknown'
}

export function parseQualityJudgeJson(raw: string): QualityJudgeResult | null {
  const text = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
  const candidate = text.match(/\{[\s\S]*\}/)?.[0] ?? text
  try {
    const parsed = JSON.parse(candidate) as QualityJudgeResult
    const score = Number(parsed.score)
    if (!Number.isFinite(score) || score < 1 || score > 5) return null
    if (!parsed.reasons || typeof parsed.reasons !== 'object' || Array.isArray(parsed.reasons)) return null
    return {
      score: Math.round(score),
      reasons: parsed.reasons,
    }
  } catch {
    return null
  }
}

export function buildQualityJudgePrompt(article: QualityJudgeArticle): { system: string; user: string } {
  return {
    system: [
      'You are a strict but fair Russian editorial quality judge for Malakhov AI Digest.',
      'Judge only the candidate article against the source text and rubric.',
      'Return only valid JSON.',
    ].join(' '),
    user: [
      'Rubric, score 1-5:',
      '1. Source grounding: no facts that are absent from or contradicted by the source.',
      '2. Lead anchor: first lead sentence has a concrete name, number, date, product, or company.',
      '3. Banned phrases/style: no hype, no bureaucratic filler, no generic AI cliches.',
      '4. Useful context: explains why the story matters without inventing data.',
      '5. Overall usefulness for a Russian AI-news reader.',
      '',
      `Source: ${article.source_name}`,
      `Original title: ${article.original_title}`,
      `Original text excerpt:\n${(article.original_text ?? '').replace(/\s+/g, ' ').slice(0, 9000)}`,
      '',
      'Candidate article:',
      JSON.stringify({
        ru_title: article.ru_title,
        lead: article.lead,
        summary: article.summary,
        card_teaser: article.card_teaser,
        tg_teaser: article.tg_teaser,
        editorial_body: article.editorial_body,
      }, null, 2),
      '',
      'Return JSON exactly:',
      '{"score":1-5,"reasons":{"source_grounding":"...","lead_anchor":"...","banned_phrases":"...","usefulness":"...","overall":"one sentence why"}}',
    ].join('\n'),
  }
}

export async function runDailyQualityJudge(params: {
  supabase: SupabaseClient
  now?: Date
  model?: string
  limit?: number
  dryRun?: boolean
}): Promise<{ judged: number; skipped: number }> {
  const now = params.now ?? new Date()
  const sampleDate = shiftMoscowDateKey(getMoscowDateKey(now), -1)
  const model = params.model ?? process.env.QUALITY_JUDGE_MODEL ?? DEFAULT_QUALITY_JUDGE_MODEL
  const sample = await loadQualityJudgeSample(params.supabase, sampleDate, params.limit)
  let judged = 0
  let skipped = 0

  for (const article of sample) {
    if (!article.editorial_body || !article.slug) {
      skipped++
      continue
    }
    if (params.dryRun) {
      console.log(`[quality-judge] planned ${article.id}: ${article.ru_title ?? article.original_title}`)
      judged++
      continue
    }
    const result = await judgeArticle({ supabase: params.supabase, article, model })
    if (!result) {
      skipped++
      continue
    }
    judged++

    const { error } = await params.supabase
      .from('article_quality_scores')
      .upsert({
        article_id: article.id,
        judge_model: model,
        score: result.score,
        reasons: result.reasons,
        writer_path: inferWriterPath(article),
        sample_source: 'daily_quality_judge',
        sampled_for_date: sampleDate,
      }, { onConflict: 'article_id,judge_model,sampled_for_date,sample_source' })
    if (error) throw new Error(`article_quality_scores upsert failed: ${error.message}`)
  }

  return { judged, skipped }
}

export async function loadQualityJudgeSample(
  supabase: SupabaseClient,
  sampleDate: string,
  limit?: number,
): Promise<QualityJudgeArticle[]> {
  const channelIds = await loadYesterdayChannelArticleIds(supabase, sampleDate)
  const channelArticles = channelIds.length
    ? await loadArticlesByIds(supabase, channelIds.slice(0, CHANNEL_SAMPLE_SIZE))
    : []
  const randomArticles = await loadRandomPublishedArticles(supabase, sampleDate, RANDOM_SAMPLE_SIZE, new Set(channelArticles.map((article) => article.id)))
  return [...channelArticles, ...randomArticles].slice(0, limit ?? CHANNEL_SAMPLE_SIZE + RANDOM_SAMPLE_SIZE)
}

export async function loadOwnerFeedbackItems(
  supabase: SupabaseClient,
  now = new Date(),
): Promise<QualityFeedbackItem[]> {
  const sampleDate = shiftMoscowDateKey(getMoscowDateKey(now), -1)
  const channelIds = await loadYesterdayChannelArticleIds(supabase, sampleDate)
  const channelArticles = await loadArticlesByIds(supabase, channelIds.slice(0, CHANNEL_SAMPLE_SIZE))
  const items: QualityFeedbackItem[] = channelArticles.map((article) => ({
    article,
    reason: null,
    source: 'channel_post',
  }))
  const seen = new Set(items.map((item) => item.article.id))
  const worst = await loadWorstJudgeArticles(supabase, now, seen, OWNER_FEEDBACK_MAX_MESSAGES - items.length)
  items.push(...worst)
  return items.slice(0, OWNER_FEEDBACK_MAX_MESSAGES)
}

export function buildOwnerFeedbackCaption(item: QualityFeedbackItem): string {
  const title = item.article.ru_title ?? item.article.original_title
  const siteUrl = readSiteUrlFromEnv(process.env.NEXT_PUBLIC_SITE_URL) || SITE_URL
  const url = item.article.slug
    ? getArticleUrl(siteUrl, item.article.slug, item.article.primary_category)
    : null
  const lines = [
    `<b>${escapeHtml(title)}</b>`,
    item.source === 'judge_worst' && item.reason
      ? `judge считает слабой: ${escapeHtml(item.reason)}`
      : null,
    url ? `<a href="${escapeHtml(url)}">Открыть статью</a>` : null,
  ].filter(Boolean)
  return lines.join('\n\n')
}

export async function sendOwnerFeedbackBatch(params: {
  supabase: SupabaseClient
  botToken: string
  adminChatId: string
  now?: Date
  dryRun?: boolean
}): Promise<{ sent: number; skipped: number }> {
  const items = await loadOwnerFeedbackItems(params.supabase, params.now)
  let sent = 0
  let skipped = 0
  for (const item of items) {
    if (!item.article.id) {
      skipped++
      continue
    }
    if (params.dryRun) {
      console.log(buildOwnerFeedbackCaption(item))
      sent++
      continue
    }
    await sendOwnerFeedbackItem(params.botToken, params.adminChatId, item)
    sent++
  }
  return { sent, skipped }
}

async function judgeArticle(params: {
  supabase: SupabaseClient
  article: QualityJudgeArticle
  model: string
}): Promise<QualityJudgeResult | null> {
  const prompt = buildQualityJudgePrompt(params.article)
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  const startedAt = new Date().toISOString()
  let usage = ZERO_USAGE_TOTALS
  let resultStatus = 'failed'
  let parsed: QualityJudgeResult | null = null
  let rawText = ''
  let errorMessage: string | null = null

  try {
    const message = await anthropic.messages.create({
      model: params.model,
      max_tokens: 700,
      temperature: 0,
      system: prompt.system,
      messages: [{ role: 'user', content: prompt.user }],
    } as any) as Message
    rawText = extractEditorialText(message) ?? ''
    parsed = parseQualityJudgeJson(rawText)
    resultStatus = parsed ? 'ok' : 'parse_failed'
    usage = usageFromAnthropicMessage(message, params.model)
  } catch (error) {
    errorMessage = error instanceof Error ? error.message : String(error)
  }

  await writeLlmUsageLog({
    supabase: params.supabase,
    provider: 'anthropic',
    model: params.model,
    operation: 'article_quality_judge',
    runKind: 'quality_judge',
    articleId: params.article.id,
    sourceName: params.article.source_name,
    sourceLang: params.article.source_lang,
    originalTitle: params.article.original_title,
    resultStatus,
    metadata: {
      score: parsed?.score ?? null,
      reasons: parsed?.reasons ?? null,
      raw_excerpt: rawText.slice(0, 500),
      error: errorMessage,
      writer_path: inferWriterPath(params.article),
    },
    createdAt: startedAt,
    usage,
  })

  return parsed
}

function usageFromAnthropicMessage(message: Pick<Message, 'usage'>, model: string): UsageTotals {
  const rawUsage = message.usage as unknown as Record<string, number>
  const inputTokens = rawUsage.input_tokens ?? 0
  const outputTokens = rawUsage.output_tokens ?? 0
  const cacheReadTokens = rawUsage.cache_read_input_tokens ?? 0
  const cacheCreateTokens = rawUsage.cache_creation_input_tokens ?? 0
  return addUsageTotals(ZERO_USAGE_TOTALS, {
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheCreateTokens,
    estimatedCostUsd: estimateTextCostUsd({
      provider: 'anthropic',
      model,
      usage: { inputTokens, outputTokens, cacheReadTokens, cacheCreateTokens },
    }),
  })
}

async function loadYesterdayChannelArticleIds(supabase: SupabaseClient, sampleDate: string): Promise<string[]> {
  const { data, error } = await supabase
    .from('telegram_channel_posts')
    .select('article_id, slot_no')
    .eq('delivery_date', sampleDate)
    .eq('status', 'success')
    .not('article_id', 'is', null)
    .order('slot_no', { ascending: true })
    .limit(CHANNEL_SAMPLE_SIZE)

  if (error) return []
  return (data ?? [])
    .map((row) => String(row.article_id ?? ''))
    .filter(Boolean)
}

async function loadArticlesByIds(supabase: SupabaseClient, ids: string[]): Promise<QualityJudgeArticle[]> {
  if (!ids.length) return []
  const { data, error } = await supabase
    .from('articles')
    .select('id, original_title, original_text, source_name, source_lang, ru_title, lead, summary, card_teaser, tg_teaser, editorial_body, editorial_model, primary_category, slug, cover_image_url, published_at')
    .in('id', ids)
  if (error) throw new Error(`articles by ids query failed: ${error.message}`)
  const byId = new Map((data ?? []).map((article) => [String(article.id), article as QualityJudgeArticle]))
  return ids.map((id) => byId.get(id)).filter((article): article is QualityJudgeArticle => Boolean(article))
}

async function loadRandomPublishedArticles(
  supabase: SupabaseClient,
  sampleDate: string,
  limit: number,
  excludeIds: Set<string>,
): Promise<QualityJudgeArticle[]> {
  const { startIso, endIso } = moscowDayBounds(sampleDate)
  let { data, error } = await supabase
    .from('articles')
    .select('id, original_title, original_text, source_name, source_lang, ru_title, lead, summary, card_teaser, tg_teaser, editorial_body, editorial_model, primary_category, slug, cover_image_url, published_at')
    .eq('publish_status', 'live')
    .gte('published_at', startIso)
    .lt('published_at', endIso)
    .not('editorial_body', 'is', null)
    .order('published_at', { ascending: false })
    .limit(80)

  if (error) throw new Error(`published articles query failed: ${error.message}`)
  if (!data?.length) {
    const fallback = await supabase
      .from('articles')
      .select('id, original_title, original_text, source_name, source_lang, ru_title, lead, summary, card_teaser, tg_teaser, editorial_body, editorial_model, primary_category, slug, cover_image_url, published_at')
      .eq('publish_status', 'live')
      .not('editorial_body', 'is', null)
      .order('published_at', { ascending: false })
      .limit(80)
    if (fallback.error) throw new Error(`published fallback query failed: ${fallback.error.message}`)
    data = fallback.data
  }

  const candidates = ((data ?? []) as QualityJudgeArticle[])
    .filter((article) => !excludeIds.has(article.id))
  return shuffleStable(candidates, sampleDate).slice(0, limit)
}

async function loadWorstJudgeArticles(
  supabase: SupabaseClient,
  now: Date,
  excludeIds: Set<string>,
  limit: number,
): Promise<QualityFeedbackItem[]> {
  if (limit <= 0) return []
  const since = new Date(now.getTime() - 36 * 60 * 60 * 1000).toISOString()
  const { data, error } = await supabase
    .from('article_quality_scores')
    .select('article_id, score, reasons, created_at')
    .gte('created_at', since)
    .order('score', { ascending: true })
    .order('created_at', { ascending: false })
    .limit(20)
  if (error || !data?.length) return []

  const rows = (data ?? [])
    .filter((row) => !excludeIds.has(String(row.article_id)))
    .slice(0, limit)
  const articles = await loadArticlesByIds(supabase, rows.map((row) => String(row.article_id)))
  const byId = new Map(articles.map((article) => [article.id, article]))
  const items: QualityFeedbackItem[] = []
  for (const row of rows) {
    const article = byId.get(String(row.article_id))
    if (!article) continue
    const reasons = (row.reasons ?? {}) as Record<string, unknown>
    items.push({
      article,
      source: 'judge_worst',
      score: Number(row.score ?? 0),
      reason: typeof reasons.overall === 'string' ? reasons.overall : null,
    })
  }
  return items
}

async function sendOwnerFeedbackItem(botToken: string, chatId: string, item: QualityFeedbackItem): Promise<void> {
  const caption = buildOwnerFeedbackCaption(item)
  const replyMarkup = {
    inline_keyboard: [[
      { text: '🔥 сильная', callback_data: `af:${item.article.id}:2` },
      { text: '👌 норм', callback_data: `af:${item.article.id}:1` },
      { text: '👎 слабая', callback_data: `af:${item.article.id}:0` },
    ]],
  }

  if (item.article.cover_image_url) {
    const photoRes = await fetch(`https://api.telegram.org/bot${botToken}/sendPhoto`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        photo: item.article.cover_image_url,
        caption,
        parse_mode: 'HTML',
        reply_markup: replyMarkup,
      }),
    })
    if (photoRes.ok) return
  }

  const messageRes = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text: caption,
      parse_mode: 'HTML',
      disable_web_page_preview: false,
      reply_markup: replyMarkup,
    }),
  })
  if (!messageRes.ok) {
    const body = await messageRes.text().catch(() => '')
    throw new Error(`Telegram feedback send failed: ${messageRes.status} ${body.slice(0, 300)}`)
  }
}

function moscowDayBounds(dateKey: string): { startIso: string; endIso: string } {
  const start = new Date(`${dateKey}T00:00:00+03:00`)
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000)
  return { startIso: start.toISOString(), endIso: end.toISOString() }
}

function shuffleStable<T>(items: T[], seed: string): T[] {
  return [...items]
    .map((item, index) => ({ item, key: hashString(`${seed}:${index}`) }))
    .sort((a, b) => a.key - b.key)
    .map(({ item }) => item)
}

function hashString(value: string): number {
  let hash = 2166136261
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

function escapeHtml(value: string): string {
  return truncate(value, 900).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[char] ?? char))
}
