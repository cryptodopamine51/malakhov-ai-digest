/**
 * bot/channel-post-core.ts
 *
 * Telegram channel delivery: five standalone photo posts per Moscow day.
 * The old daily digest remains as legacy code, but production delivery uses
 * telegram_channel_posts as the slot-level source of truth.
 */

import { createHash } from 'crypto'

import { getArticleUrl } from '../lib/article-slugs'
import { readSiteUrlFromEnv } from '../lib/site'
import { getServerClient } from '../lib/supabase'
import type { Article } from '../lib/supabase'
import { getMoscowDateKey } from '../lib/utils'
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
  | 'tg_teaser'
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

export function buildTelegramCaption(
  article: Pick<ChannelPostCandidate, 'ru_title' | 'original_title' | 'tg_teaser'>,
  maxLength = CAPTION_LIMIT,
): string {
  const title = truncatePlain(article.ru_title ?? article.original_title, 180)
  const teaserRaw = article.tg_teaser ?? ''

  for (let teaserLimit = 760; teaserLimit >= 80; teaserLimit -= 40) {
    const teaser = truncatePlain(teaserRaw, teaserLimit)
    const caption = `<b>${escapeHtml(title)}</b>${teaser ? `\n\n${escapeHtml(teaser)}` : ''}`
    if (caption.length <= maxLength) return caption
  }

  const compactTitle = truncatePlain(title, 160)
  const caption = `<b>${escapeHtml(compactTitle)}</b>`
  return caption.length <= maxLength ? caption : `<b>${escapeHtml(truncatePlain(compactTitle, 120))}</b>`
}

function captionHash(caption: string | null): string | null {
  return caption ? createHash('sha256').update(caption).digest('hex').slice(0, 32) : null
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
  if (existing.length > 0) return existing

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

  const rows = buildChannelPostPlan(candidates, recentSentArticles, {
    deliveryDate: opts.deliveryDate,
    contentDate: opts.contentDate,
    channelId: opts.channelId,
    siteUrl: opts.siteUrl,
  })

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
