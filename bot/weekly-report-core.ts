/**
 * Weekly Telegram report for the owner/admin bot.
 *
 * One report covers the previous complete Moscow week (Monday through Sunday),
 * always contains six deduplicated stories, and is safe to retry through a
 * database claim keyed by week + chat.
 */

import { createHash } from 'crypto'

import { getArticleUrl } from '../lib/article-slugs'
import { SITE_URL, readSiteUrlFromEnv } from '../lib/site'
import { getServerClient } from '../lib/supabase'
import type { Article } from '../lib/supabase'
import { getMoscowDateKey, shiftMoscowDateKey } from '../lib/utils'
import { WEEKLY_REPORT_SCHEMA, assertSchemaReady } from '../pipeline/schema-guard'
import {
  rankDigestCandidates,
  selectDigestArticles,
  type DigestSelectionDiagnostics,
} from './digest-selection'

const REPORT_SIZE = 6
const TELEGRAM_MESSAGE_LIMIT = 4_000
const DEFAULT_CHANNEL_URL = 'https://t.me/malakhovAIdigest'

export type WeeklyReportFormat = 'signal' | 'business' | 'channel'
export type WeeklyReportFormatArg = WeeklyReportFormat | 'all'
export type WeeklyReportDelivery = 'dry-run' | 'preview' | 'scheduled'

export interface WeeklyReportWindow {
  weekStart: string
  weekEnd: string
  from: string
  to: string
}

export interface WeeklyReportSelection {
  articles: Article[]
  diagnostics: DigestSelectionDiagnostics
}

type WeeklyReportSupabase = ReturnType<typeof getServerClient>

export interface RunWeeklyReportOptions {
  reportDate?: string
  weekStart?: string
  format?: WeeklyReportFormatArg
  delivery?: WeeklyReportDelivery
  pinnedArticle?: string
  marker?: boolean
  siteUrl?: string
  channelUrl?: string
  supabase?: WeeklyReportSupabase
  botToken?: string
  adminChatId?: string
  stdout?: (text: string) => void
  sendMessage?: typeof sendTelegramTextMessage
  fetchCandidates?: typeof fetchWeeklyReportCandidates
}

export type WeeklyReportResult =
  | {
      status: 'dry-run' | 'preview-sent' | 'success'
      weekStart: string
      weekEnd: string
      formats: WeeklyReportFormat[]
      articleIds: string[]
      messageIds: number[]
    }
  | {
      status: 'skipped-low-articles' | 'already-processed'
      weekStart: string
      weekEnd: string
      candidatesCount?: number
      existingStatus?: string
    }

const RU_MONTHS = [
  'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря',
]

function assertDateKey(value: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`Некорректная дата ${JSON.stringify(value)}: ожидается YYYY-MM-DD`)
  }
  const [year, month, day] = value.split('-').map(Number)
  const check = new Date(Date.UTC(year, month - 1, day))
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day
  ) {
    throw new Error(`Некорректная календарная дата: ${value}`)
  }
}

function moscowMidday(dateKey: string): Date {
  return new Date(`${dateKey}T12:00:00+03:00`)
}

function assertMonday(dateKey: string): void {
  if (moscowMidday(dateKey).getUTCDay() !== 1) {
    throw new Error(`weekStart должен быть понедельником: ${dateKey}`)
  }
}

/** Previous complete Monday-Sunday Moscow week for a report run date. */
export function weeklyReportWindow(reportDate?: string, explicitWeekStart?: string): WeeklyReportWindow {
  const currentDate = reportDate ?? getMoscowDateKey()
  assertDateKey(currentDate)

  let weekStart: string
  if (explicitWeekStart) {
    assertDateKey(explicitWeekStart)
    assertMonday(explicitWeekStart)
    weekStart = explicitWeekStart
  } else {
    const weekday = moscowMidday(currentDate).getUTCDay()
    const daysSinceMonday = weekday === 0 ? 6 : weekday - 1
    weekStart = shiftMoscowDateKey(currentDate, -daysSinceMonday - 7)
  }

  const nextMonday = shiftMoscowDateKey(weekStart, 7)
  const weekEnd = shiftMoscowDateKey(nextMonday, -1)
  const [startYear, startMonth, startDay] = weekStart.split('-').map(Number)
  const [nextYear, nextMonth, nextDay] = nextMonday.split('-').map(Number)

  return {
    weekStart,
    weekEnd,
    from: new Date(Date.UTC(startYear, startMonth - 1, startDay, -3)).toISOString(),
    to: new Date(Date.UTC(nextYear, nextMonth - 1, nextDay, -3)).toISOString(),
  }
}

export async function fetchWeeklyReportCandidates(
  supabase: WeeklyReportSupabase,
  window: WeeklyReportWindow,
): Promise<Article[]> {
  const { data, error } = await supabase
    .from('articles')
    .select('*')
    .eq('published', true)
    .eq('quality_ok', true)
    .eq('verified_live', true)
    .eq('publish_status', 'live')
    .not('slug', 'is', null)
    .gte('published_at', window.from)
    .lt('published_at', window.to)
    .order('score', { ascending: false })
    .order('published_at', { ascending: false })
    .limit(250)

  if (error) throw new Error(`weekly report candidates query failed: ${error.message}`)
  return ((data ?? []) as Article[]).filter((article) => (
    Boolean(article.slug) && Boolean(article.ru_title?.trim() || article.original_title?.trim())
  ))
}

function isConsumerWeeklyStory(article: Article): boolean {
  const title = titleOf(article).toLowerCase()
  return /(?:android|pixel|wear os|смартфон|iphone|airpods|наушник|умн(?:ые|ых) час|фильм|кино|сериал|игров(?:ой|ая|ые))/iu.test(title)
}

export function selectWeeklyReportArticles(
  candidates: Article[],
  pinnedArticle?: string,
): WeeklyReportSelection {
  // Weekly windows contain much more semantic noise than daily windows. Keep
  // editorial score as the primary tier, then use story importance inside the
  // tier. This prevents a secondary money reference in a low-score story from
  // outranking an actual major model/product release.
  const importanceRanked = rankDigestCandidates(candidates)
  const importanceIndex = new Map(importanceRanked.map((article, index) => [article.id, index]))
  const sortWithinTier = (a: Article, b: Article) => (
    Number(b.score ?? 0) - Number(a.score ?? 0) ||
    (importanceIndex.get(a.id) ?? Number.MAX_SAFE_INTEGER) -
      (importanceIndex.get(b.id) ?? Number.MAX_SAFE_INTEGER)
  )
  // Entrepreneur-facing weekly reports prefer industry/business stories.
  // Consumer/gadget/entertainment items remain available only as a fallback
  // when the week has fewer than six stronger industry candidates.
  const ranked = [
    ...candidates.filter((article) => !isConsumerWeeklyStory(article)).sort(sortWithinTier),
    ...candidates.filter(isConsumerWeeklyStory).sort(sortWithinTier),
  ]
  const pinned = pinnedArticle
    ? ranked.find((article) => article.id === pinnedArticle || article.slug === pinnedArticle)
    : undefined

  if (pinnedArticle && !pinned) {
    throw new Error(`Закреплённая новость не найдена в выбранной неделе: ${pinnedArticle}`)
  }

  // Put the pin through the same story/entity/source caps, then move it to #6.
  const ordered = pinned
    ? [pinned, ...ranked.filter((article) => article.id !== pinned.id)]
    : ranked
  const selected = selectDigestArticles(ordered, [], {
    target: REPORT_SIZE,
    perSourceCap: 3,
    perPrimaryEntityCap: 2,
  })

  const articles = pinned
    ? [...selected.articles.filter((article) => article.id !== pinned.id), pinned]
    : selected.articles

  return { articles, diagnostics: selected.diagnostics }
}

export function escapeTelegramHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function titleOf(article: Pick<Article, 'ru_title' | 'original_title'>): string {
  return (article.ru_title?.trim() || article.original_title.trim()).replace(/\s+/g, ' ')
}

function shortenAtWord(text: string, maxLength: number): string {
  const normalized = text.replace(/\s+/g, ' ').trim()
  if (normalized.length <= maxLength) return normalized
  const prefix = normalized.slice(0, maxLength - 1)
  const boundary = prefix.lastIndexOf(' ')
  const end = boundary >= Math.floor(maxLength * 0.65) ? boundary : prefix.length
  return `${prefix.slice(0, end).trimEnd()}…`
}

function shortDescription(article: Article, maxLength = 210): string {
  const source = article.tg_teaser?.trim() || article.lead?.trim() || article.card_teaser?.trim() || titleOf(article)
  return shortenAtWord(source.replace(/\s+/g, ' '), maxLength)
}

function formatRange(window: WeeklyReportWindow): string {
  const [, startMonth, startDay] = window.weekStart.split('-').map(Number)
  const [, endMonth, endDay] = window.weekEnd.split('-').map(Number)
  if (startMonth === endMonth) return `${startDay}–${endDay} ${RU_MONTHS[endMonth - 1]}`
  return `${startDay} ${RU_MONTHS[startMonth - 1]} — ${endDay} ${RU_MONTHS[endMonth - 1]}`
}

type WeekTheme = 'products' | 'money' | 'research' | 'regulation' | 'talent' | 'risk'

function themeOf(article: Article): WeekTheme {
  const text = [titleOf(article), article.lead, article.tg_teaser, article.card_teaser]
    .filter(Boolean).join(' ').toLowerCase()
  const categories = [article.primary_category, ...(article.secondary_categories ?? []), ...(article.topics ?? [])]

  if (/(?:закон|регулирован|экспортн|запрет|бел(?:ый|ого) дом|требует лицензи|government|regulat)/iu.test(text)) return 'regulation'
  if (/(?:уходит|переш[её]л|назначен|соосновател|исследовател.+переход|joins? openai|hires?)/iu.test(text)) return 'talent'
  if (/(?:уничтожил|сн[её]с|инцидент|утечк|уязвим|ошибк|провал|лишь \d+%|только \d+%)/iu.test(text)) return 'risk'
  if (
    categories.some((item) => item === 'ai-investments' || item === 'ai-startups') ||
    /(?:инвест|раунд|оценк|выручк|убыт|\$\d|funding|valuation)/iu.test(text)
  ) return 'money'
  if (
    categories.some((item) => item === 'ai-research' || item === 'ai-labs') ||
    /(?:бенчмарк|benchmark|исследован|точност|задач)/iu.test(text)
  ) return 'research'
  return 'products'
}

function joinRu(items: string[]): string {
  if (items.length <= 1) return items[0] ?? 'главными запусками и решениями индустрии'
  return `${items.slice(0, -1).join(', ')} и ${items.at(-1)}`
}

export function buildWeekSummary(articles: Article[]): string {
  const labels: Record<WeekTheme, string> = {
    products: 'новыми моделями и ИИ-сервисами',
    money: 'крупными ставками и жёсткой проверкой экономики ИИ-компаний',
    research: 'исследованиями, которые уточнили реальные возможности моделей',
    regulation: 'усилением контроля над доступом к передовым моделям',
    talent: 'новым раундом борьбы за ключевых исследователей',
    risk: 'отрезвляющими примерами ограничений и рисков ИИ',
  }
  const counts = new Map<WeekTheme, number>()
  for (const article of articles) counts.set(themeOf(article), (counts.get(themeOf(article)) ?? 0) + 1)
  const themes = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([theme]) => labels[theme])
  return `Неделя запомнилась ${joinRu(themes)}. Ниже — шесть событий без информационного шума.`
}

function trackedArticleUrl(
  article: Article,
  window: WeeklyReportWindow,
  format: WeeklyReportFormat,
  position: number,
  siteUrl: string,
): string {
  const url = new URL(getArticleUrl(siteUrl, article.slug!, article.primary_category))
  url.searchParams.set('utm_source', 'tg')
  url.searchParams.set('utm_medium', 'weekly_report')
  url.searchParams.set('utm_campaign', `weekly_${window.weekStart.replace(/-/g, '')}`)
  url.searchParams.set('utm_content', `${format}_${position}`)
  return url.toString()
}

function linkedTitle(
  article: Article,
  window: WeeklyReportWindow,
  format: WeeklyReportFormat,
  position: number,
  siteUrl: string,
): string {
  const title = escapeTelegramHtml(shortenAtWord(titleOf(article), 180))
  const url = escapeTelegramHtml(trackedArticleUrl(article, window, format, position, siteUrl))
  return `<a href="${url}">${title}</a>`
}

function reportFooter(channelUrl: string): string[] {
  return [
    '',
    `Подписывайтесь на <a href="${escapeTelegramHtml(channelUrl)}">Malakhov AI Digest</a> — основные новости ИИ без шума.`,
  ]
}

function withMarker(lines: string[], marker?: string): string[] {
  return marker ? [`<b>${escapeTelegramHtml(marker)}</b>`, '', ...lines] : lines
}

export function buildWeeklyReportMessage(
  format: WeeklyReportFormat,
  articles: Article[],
  window: WeeklyReportWindow,
  options: { siteUrl: string; channelUrl: string; marker?: string },
): string {
  if (articles.length !== REPORT_SIZE) {
    throw new Error(`Недельный отчёт требует ровно ${REPORT_SIZE} новостей, получено ${articles.length}`)
  }
  const range = escapeTelegramHtml(formatRange(window))
  const summary = escapeTelegramHtml(buildWeekSummary(articles))
  let lines: string[]

  if (format === 'signal') {
    lines = withMarker([
      '<b>⚡️ ИИ-неделя без шума: 6 событий, которые меняют рынок</b>',
      `<i>${range}</i>`,
      '',
      '<b>Чем запомнилась неделя</b>',
      summary,
      '',
      ...articles.flatMap((article, index) => [
        `<b>${index + 1}. ${linkedTitle(article, window, format, index + 1, options.siteUrl)}</b>`,
        escapeTelegramHtml(shortDescription(article)),
        '',
      ]),
      ...reportFooter(options.channelUrl),
    ], options.marker)
  } else if (format === 'business') {
    lines = withMarker([
      '<b>📊 Что изменилось в ИИ за неделю — и почему это важно бизнесу</b>',
      `<i>${range}</i>`,
      '',
      `<b>Итог недели:</b> ${summary}`,
      '',
      '<b>6 главных новостей</b>',
      '',
      ...articles.flatMap((article, index) => [
        `<b>${index + 1}. ${linkedTitle(article, window, format, index + 1, options.siteUrl)}</b>`,
        escapeTelegramHtml(shortDescription(article, 230)),
        '',
      ]),
      ...reportFooter(options.channelUrl),
    ], options.marker)
  } else {
    lines = withMarker([
      '<b>🔥 6 новостей об ИИ, которые будут обсуждать на этой неделе</b>',
      `<i>Главное за ${range}</i>`,
      '',
      summary,
      '',
      ...articles.flatMap((article, index) => [
        `${index + 1}️⃣ <b>${linkedTitle(article, window, format, index + 1, options.siteUrl)}</b>`,
        escapeTelegramHtml(shortDescription(article, 190)),
        '',
      ]),
      ...reportFooter(options.channelUrl),
    ], options.marker)
  }

  const message = lines.join('\n').replace(/\n{3,}/g, '\n\n').trim()
  if (message.length > TELEGRAM_MESSAGE_LIMIT) {
    throw new Error(`Недельный отчёт длиннее ${TELEGRAM_MESSAGE_LIMIT} символов: ${message.length}`)
  }
  return message
}

interface TelegramResponse {
  ok: boolean
  description?: string
  result?: { message_id?: number }
}

export async function sendTelegramTextMessage(
  botToken: string,
  chatId: string,
  text: string,
): Promise<{ result: { message_id: number } }> {
  const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    }),
  })
  const data = (await response.json()) as TelegramResponse
  if (!response.ok || !data.ok) throw new Error(data.description ?? `Telegram sendMessage failed: ${response.status}`)
  if (typeof data.result?.message_id !== 'number') throw new Error('Telegram API не вернул result.message_id')
  return { result: { message_id: data.result.message_id } }
}

function requestedFormats(format: WeeklyReportFormatArg): WeeklyReportFormat[] {
  return format === 'all' ? ['signal', 'business', 'channel'] : [format]
}

function configuredScheduledFormat(value?: string): WeeklyReportFormat {
  const format = value || 'business'
  if (format === 'signal' || format === 'business' || format === 'channel') return format
  throw new Error(`TELEGRAM_WEEKLY_REPORT_FORMAT должен быть signal|business|channel, получено ${format}`)
}

interface WeeklyClaimRow {
  run_id: string
  claimed: boolean
  existing_status: string
}

async function claimWeeklyReport(
  supabase: WeeklyReportSupabase,
  params: {
    weekStart: string
    chatId: string
    format: WeeklyReportFormat
    articleIds: string[]
    messageHash: string
  },
): Promise<WeeklyClaimRow> {
  const { data, error } = await supabase.rpc('claim_weekly_report_run', {
    p_week_start: params.weekStart,
    p_chat_id: params.chatId,
    p_format: params.format,
    p_article_ids: params.articleIds,
    p_message_hash: params.messageHash,
  })
  if (error) throw new Error(`weekly report claim failed: ${error.message}`)
  const row = (data as WeeklyClaimRow[] | null)?.[0]
  if (!row) throw new Error('weekly report claim returned no row')
  return row
}

async function finalizeWeeklyReport(
  supabase: WeeklyReportSupabase,
  runId: string,
  values: { status: 'success' | 'failed'; messageId?: number; error?: string },
): Promise<void> {
  const { error } = await supabase
    .from('weekly_report_runs')
    .update({
      status: values.status,
      telegram_message_id: values.messageId ?? null,
      error: values.error ?? null,
      finished_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', runId)
    .eq('status', 'running')
  if (error) throw new Error(`weekly report finalize failed: ${error.message}`)
}

export async function runWeeklyReport(options: RunWeeklyReportOptions = {}): Promise<WeeklyReportResult> {
  const delivery = options.delivery ?? 'scheduled'
  const window = weeklyReportWindow(options.reportDate, options.weekStart)
  const formatArg = delivery === 'scheduled'
    ? configuredScheduledFormat(options.format === 'all' ? undefined : options.format ?? process.env.TELEGRAM_WEEKLY_REPORT_FORMAT)
    : options.format ?? 'all'
  const formats = requestedFormats(formatArg)
  if (delivery === 'scheduled' && formats.length !== 1) {
    throw new Error('Scheduled weekly report должен использовать один формат')
  }

  const supabase = options.supabase ?? getServerClient()
  // Fail fast с внятной ошибкой, если миграция weekly report не накатана на прод
  // (иначе claim падает криптовым "Could not find the function …"). Только scheduled
  // пишет в weekly_report_runs; dry-run и preview таблицу не трогают.
  if (delivery === 'scheduled') {
    await assertSchemaReady(supabase, WEEKLY_REPORT_SCHEMA)
  }
  const candidates = await (options.fetchCandidates ?? fetchWeeklyReportCandidates)(supabase, window)
  if (candidates.length < REPORT_SIZE) {
    return {
      status: 'skipped-low-articles',
      weekStart: window.weekStart,
      weekEnd: window.weekEnd,
      candidatesCount: candidates.length,
    }
  }

  const selection = selectWeeklyReportArticles(candidates, options.pinnedArticle)
  if (selection.articles.length !== REPORT_SIZE) {
    return {
      status: 'skipped-low-articles',
      weekStart: window.weekStart,
      weekEnd: window.weekEnd,
      candidatesCount: candidates.length,
    }
  }

  const siteUrl = options.siteUrl ?? (readSiteUrlFromEnv(process.env.NEXT_PUBLIC_SITE_URL) || SITE_URL)
  const channelUrl = options.channelUrl ?? process.env.NEXT_PUBLIC_TELEGRAM_CHANNEL_URL ?? DEFAULT_CHANNEL_URL
  const messages = new Map(formats.map((format, index) => [
    format,
    buildWeeklyReportMessage(format, selection.articles, window, {
      siteUrl,
      channelUrl,
      marker: options.marker && formats.length > 1 ? `Тест ${index + 1}/${formats.length}` : undefined,
    }),
  ]))
  const articleIds = selection.articles.map((article) => article.id)

  console.log(`[weekly-report] week=${window.weekStart}..${window.weekEnd} candidates=${candidates.length} selected=${articleIds.join(',')}`)
  console.log(`[weekly-report] diagnostics=${JSON.stringify({
    sources: selection.diagnostics.sourceDistribution,
    stories: selection.diagnostics.storyKeys,
    skipped: selection.diagnostics.skipped.slice(0, 20).map((item) => ({ id: item.articleId, reason: item.reason })),
  })}`)

  if (delivery === 'dry-run') {
    const stdout = options.stdout ?? console.log
    for (const format of formats) stdout(`\n===== ${format} =====\n${messages.get(format)}\n`)
    return { status: 'dry-run', weekStart: window.weekStart, weekEnd: window.weekEnd, formats, articleIds, messageIds: [] }
  }

  const botToken = options.botToken ?? process.env.TELEGRAM_BOT_TOKEN
  const adminChatId = options.adminChatId ?? process.env.TELEGRAM_ADMIN_CHAT_ID
  if (!botToken) throw new Error('TELEGRAM_BOT_TOKEN не задан')
  if (!adminChatId) throw new Error('TELEGRAM_ADMIN_CHAT_ID не задан')
  const sendMessage = options.sendMessage ?? sendTelegramTextMessage

  if (delivery === 'preview') {
    const messageIds: number[] = []
    for (const format of formats) {
      const response = await sendMessage(botToken, adminChatId, messages.get(format)!)
      messageIds.push(response.result.message_id)
    }
    return { status: 'preview-sent', weekStart: window.weekStart, weekEnd: window.weekEnd, formats, articleIds, messageIds }
  }

  const format = formats[0]
  const message = messages.get(format)!
  const messageHash = createHash('sha256').update(message).digest('hex').slice(0, 32)
  const claim = await claimWeeklyReport(supabase, {
    weekStart: window.weekStart,
    chatId: adminChatId,
    format,
    articleIds,
    messageHash,
  })
  if (!claim.claimed) {
    return {
      status: 'already-processed',
      weekStart: window.weekStart,
      weekEnd: window.weekEnd,
      existingStatus: claim.existing_status,
    }
  }

  try {
    const response = await sendMessage(botToken, adminChatId, message)
    await finalizeWeeklyReport(supabase, claim.run_id, {
      status: 'success',
      messageId: response.result.message_id,
    })
    return {
      status: 'success',
      weekStart: window.weekStart,
      weekEnd: window.weekEnd,
      formats,
      articleIds,
      messageIds: [response.result.message_id],
    }
  } catch (error) {
    const messageText = error instanceof Error ? error.message : String(error)
    try {
      await finalizeWeeklyReport(supabase, claim.run_id, { status: 'failed', error: messageText })
    } catch (finalizeError) {
      console.error('[weekly-report] failed to finalize error state:', finalizeError)
    }
    throw error
  }
}
