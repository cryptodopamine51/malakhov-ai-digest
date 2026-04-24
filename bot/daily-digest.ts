/**
 * bot/daily-digest.ts
 *
 * Ежедневный Telegram-дайджест. Отбирает топ-5 статей с quality_ok=true,
 * формирует пост и отправляет в канал.
 *
 * Запуск: npm run tg-digest
 * Принудительный: FORCE_DIGEST=1 npm run tg-digest
 */

import { config } from 'dotenv'
import { resolve } from 'path'
import { createHash } from 'crypto'
import { pathToFileURL } from 'url'
config({ path: resolve(process.cwd(), '.env.local') })

import { getServerClient } from '../lib/supabase'
import type { Article } from '../lib/supabase'
import { getArticleUrl } from '../lib/article-slugs'
import { getMoscowDateKey } from '../lib/utils'
import { fireAlert } from '../pipeline/alerts'

// ── Утилиты ───────────────────────────────────────────────────────────────────

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

const RU_MONTHS = [
  'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря',
]

function formatDateRu(date: Date): string {
  return `${date.getDate()} ${RU_MONTHS[date.getMonth()]}`
}

// Экранирование для Telegram HTML-режима
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

// ── Хэштеги ───────────────────────────────────────────────────────────────────

const HASHTAG_MAP: Record<string, string> = {
  openai: '#OpenAI',
  anthropic: '#Anthropic',
  google: '#Google',
  yandexgpt: '#YandexGPT',
  gigachat: '#GigaChat',
  claude: '#Claude',
  gpt: '#GPT',
  gemini: '#Gemini',
  llama: '#Llama',
  mistral: '#Mistral',
  huggingface: '#HuggingFace',
}

function extractHashtags(articles: Article[]): string {
  const found = new Set<string>()
  found.add('#AI')

  const combined = articles.map((a) => (a.lead ?? '') + ' ' + (a.ru_title ?? '')).join(' ').toLowerCase()

  for (const [keyword, tag] of Object.entries(HASHTAG_MAP)) {
    if (combined.includes(keyword) && found.size < 6) {
      found.add(tag)
    }
  }

  return Array.from(found).join(' ')
}

// ── Telegram API ──────────────────────────────────────────────────────────────

interface TelegramResponse {
  ok: boolean
  description?: string
  result?: {
    message_id?: number
  }
}

export function assertServiceRoleKey(): void {
  const key = process.env.SUPABASE_SERVICE_KEY
  if (!key) throw new Error('SUPABASE_SERVICE_KEY не задан')

  const [, payload] = key.split('.')
  if (!payload) throw new Error('SUPABASE_SERVICE_KEY не похож на JWT')

  let role: unknown
  try {
    role = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')).role
  } catch {
    throw new Error('Не удалось прочитать role из SUPABASE_SERVICE_KEY')
  }

  if (role !== 'service_role') {
    throw new Error(`SUPABASE_SERVICE_KEY имеет role=${String(role)}, нужен service_role`)
  }
}

async function sendTelegramMessage(
  botToken: string,
  chatId: string,
  text: string,
  disablePreview = false,
): Promise<{ result: { message_id: number } }> {
  const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: disablePreview,
    }),
  })

  const data = (await res.json()) as TelegramResponse
  if (!data.ok) throw new Error(data.description ?? 'Telegram API вернул ok: false')
  if (typeof data.result?.message_id !== 'number') {
    throw new Error('Telegram API не вернул result.message_id')
  }
  return { result: { message_id: data.result.message_id } }
}

// ── Проверка доступности ──────────────────────────────────────────────────────

async function isArticleLive(siteUrl: string, slug: string): Promise<boolean> {
  try {
    const res = await fetch(getArticleUrl(siteUrl, slug), {
      method: 'HEAD',
      signal: AbortSignal.timeout(5_000),
    })
    return res.ok
  } catch {
    return false
  }
}

async function filterLiveArticles(articles: Article[], siteUrl: string): Promise<Article[]> {
  const results = await Promise.all(
    articles.map(async (article) => {
      if (!article.slug) return null
      const live = await isArticleLive(siteUrl, article.slug)
      if (!live) log(`⚠ Страница недоступна, пропускаем: ${article.slug}`)
      return live ? article : null
    })
  )
  return results.filter((a): a is Article => a !== null)
}

// ── UTM-ссылки ────────────────────────────────────────────────────────────────

function articleUrl(siteUrl: string, slug: string, position: number, date: string): string {
  return `${getArticleUrl(siteUrl, slug)}?utm_source=tg&utm_medium=digest&utm_campaign=daily_${date}&utm_content=${position}`
}

// ── Формирование текста дайджеста ─────────────────────────────────────────────

function buildDigestText(
  articles: Article[],
  siteUrl: string,
  totalToday: number,
  dateStr: string,
  dateUtm: string,
): string {
  const n = articles.length
  const lines: string[] = [
    `🤖 <b>AI Дайджест · ${escapeHtml(dateStr)}</b>`,
    `${n} главных событий в ИИ за сутки`,
    '',
  ]

  articles.forEach((article, idx) => {
    const pos = idx + 1
    const title = escapeHtml(article.ru_title ?? article.original_title)
    const teaser = escapeHtml(article.tg_teaser ?? '')
    const url = articleUrl(siteUrl, article.slug!, pos, dateUtm)

    lines.push(`<b>${pos}. ${title}</b>`)
    if (teaser) lines.push(teaser)
    lines.push(`<a href="${url}">→ читать</a>`)
    lines.push('')
  })

  lines.push(`Все ${totalToday} новостей дня: ${siteUrl}`)
  lines.push(extractHashtags(articles))

  return lines.join('\n')
}

// ── Health-отчёт ──────────────────────────────────────────────────────────────

async function sendHealthReport(
  supabase: ReturnType<typeof getServerClient>,
  botToken: string,
  adminChatId: string,
  articlesCount: number,
  dateStr: string,
): Promise<void> {
  await fireAlert({
    supabase,
    alertType: 'digest_low_articles',
    severity: 'warning',
    entityKey: dateStr,
    message: `Сегодня в дайджесте всего ${articlesCount} статей. Минимум для отправки: 3. Дайджест не отправлен.`,
    payload: { articlesCount, date: dateStr },
    botToken,
    adminChatId,
  })
  log('Health-отчёт отправлен администратору')
}

// ── Логирование в Supabase ────────────────────────────────────────────────────

type DigestRunStatus = 'success' | 'skipped' | 'low_articles' | 'error'

interface DigestRunPayload {
  status: DigestRunStatus
  articles_count?: number
  article_ids?: string[]
  message_text?: string
  error_message?: string
  site_url?: string
}

async function logDigestRun(
  supabase: ReturnType<typeof getServerClient>,
  payload: DigestRunPayload,
): Promise<void> {
  try {
    const { error } = await supabase.from('digest_runs').insert(payload)
    if (error) throw error
  } catch (err) {
    throw new Error(`[digest_runs] Не удалось записать лог: ${err instanceof Error ? err.message : String(err)}`)
  }
}

type DigestSupabase = ReturnType<typeof getServerClient>

export async function claimDigestSlot(
  supabase: DigestSupabase,
  digestDate: string,
  channelId: string,
): Promise<{ claimed: true; runId: string } | { claimed: false; reason: string }> {
  const { data, error } = await supabase
    .from('digest_runs')
    .insert({
      digest_date: digestDate,
      channel_id: channelId,
      status: 'running',
      claimed_at: new Date().toISOString(),
    })
    .select('id')
    .single()

  if (error) {
    if ('code' in error && error.code === '23505') {
      return { claimed: false, reason: 'already_claimed' }
    }
    throw new Error(`digest claim failed: ${error.message}`)
  }

  return { claimed: true, runId: String(data.id) }
}

export async function finalizeDigestSuccess(
  supabase: DigestSupabase,
  runId: string,
  telegramMessageId: number,
  articleIds: string[],
  messageText: string,
  siteUrl?: string,
): Promise<void> {
  const messageHash = createHash('sha256').update(messageText).digest('hex').slice(0, 32)
  const { error } = await supabase
    .from('digest_runs')
    .update({
      status: 'success',
      articles_count: articleIds.length,
      article_ids: articleIds,
      message_text: messageText,
      message_hash: messageHash,
      telegram_message_id: telegramMessageId,
      sent_at: new Date().toISOString(),
      site_url: siteUrl,
    })
    .eq('id', runId)

  if (error) throw new Error(`digest success finalize failed: ${error.message}`)
}

export async function finalizeDigestFailure(
  supabase: DigestSupabase,
  runId: string,
  err: unknown,
): Promise<void> {
  const { error } = await supabase
    .from('digest_runs')
    .update({
      status: 'failed',
      failed_at: new Date().toISOString(),
      error_message: err instanceof Error ? err.message : String(err),
    })
    .eq('id', runId)

  if (error) throw new Error(`digest failure finalize failed: ${error.message}`)
}

async function finalizeDigestNonDelivery(
  supabase: DigestSupabase,
  runId: string,
  status: 'skipped' | 'low_articles',
  payload: Omit<DigestRunPayload, 'status'>,
): Promise<void> {
  const { error } = await supabase
    .from('digest_runs')
    .update({ ...payload, status })
    .eq('id', runId)

  if (error) throw new Error(`digest ${status} finalize failed: ${error.message}`)
}

export async function markArticlesSent(
  supabase: DigestSupabase,
  articleIds: string[],
): Promise<void> {
  const { data, error } = await supabase
    .from('articles')
    .update({ tg_sent: true })
    .in('id', articleIds)
    .select('id')

  if (error) throw new Error(`tg_sent update failed: ${error.message}`)
  if ((data?.length ?? 0) !== articleIds.length) {
    throw new Error(`tg_sent обновил ${data?.length ?? 0}/${articleIds.length} строк — вероятно RLS`)
  }
}

export async function deliverClaimedDigest(
  supabase: DigestSupabase,
  runId: string,
  botToken: string,
  channelId: string,
  messageText: string,
  articleIds: string[],
  siteUrl: string,
  sendMessage = sendTelegramMessage,
): Promise<void> {
  try {
    const telegramResponse = await sendMessage(botToken, channelId, messageText, false)
    await markArticlesSent(supabase, articleIds)
    await finalizeDigestSuccess(
      supabase,
      runId,
      telegramResponse.result.message_id,
      articleIds,
      messageText,
      siteUrl,
    )
  } catch (err) {
    await finalizeDigestFailure(supabase, runId, err).catch((finalizeErr) => {
      logError('Не удалось записать failed digest_run', finalizeErr)
    })
    throw err
  }
}

// ── Основная логика ───────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const botToken = process.env.TELEGRAM_BOT_TOKEN
  const channelId = process.env.TELEGRAM_CHANNEL_ID
  const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL ?? '').replace(/\/$/, '')
  const adminChatId = process.env.TELEGRAM_ADMIN_CHAT_ID

  if (!botToken) { logError('Не задан TELEGRAM_BOT_TOKEN'); process.exit(1) }
  if (!channelId) { logError('Не задан TELEGRAM_CHANNEL_ID'); process.exit(1) }
  if (!siteUrl)   { logError('Не задан NEXT_PUBLIC_SITE_URL'); process.exit(1) }

  log('Запуск дайджеста...')

  try {
    assertServiceRoleKey()
  } catch (err) {
    logError('Supabase service-role preflight не пройден', err)
    process.exit(1)
  }

  const supabase = getServerClient()
  const digestDate = getMoscowDateKey()

  const force = process.env.FORCE_DIGEST === '1'
  const forceConfirmDate = process.env.FORCE_DIGEST_CONFIRM_DATE
  if (force && forceConfirmDate !== digestDate) {
    logError(`FORCE_DIGEST=1 требует FORCE_DIGEST_CONFIRM_DATE=${digestDate}`)
    process.exit(1)
  }

  const claim = await claimDigestSlot(supabase, digestDate, channelId)
  if (!claim.claimed) {
    log(`Slot (${digestDate}, ${channelId}) уже занят: ${claim.reason} — выходим без отправки`)
    process.exit(0)
  }
  const runId = claim.runId

  // Сохраняем старый tg_sent guard как fallback, но atomic claim теперь основной lock.
  if (!force) {
    const eightHoursAgo = new Date(Date.now() - 8 * 60 * 60 * 1000).toISOString()
    const { count: recentlySent } = await supabase
      .from('articles')
      .select('*', { count: 'exact', head: true })
      .eq('tg_sent', true)
      .gte('updated_at', eightHoursAgo)

    if ((recentlySent ?? 0) > 0) {
      log(`Дайджест за сегодня уже отправлен (${recentlySent} статей) — пропускаем`)
      await finalizeDigestNonDelivery(supabase, runId, 'skipped', { site_url: siteUrl })
      process.exit(0)
    }
  } else {
    log('FORCE_DIGEST=1 подтверждён — продолжаем с atomic claim')
  }

  // Окно выборки: вчерашний день по МСК
  const MSK_OFFSET = 3 * 60 * 60 * 1000
  const moscowNow = new Date(Date.now() + MSK_OFFSET)
  const yesterday = new Date(moscowNow)
  yesterday.setUTCDate(yesterday.getUTCDate() - 1)

  const from = new Date(
    Date.UTC(yesterday.getUTCFullYear(), yesterday.getUTCMonth(), yesterday.getUTCDate(), 0, 0, 0) - MSK_OFFSET
  )
  const to = new Date(
    Date.UTC(yesterday.getUTCFullYear(), yesterday.getUTCMonth(), yesterday.getUTCDate(), 23, 59, 59) - MSK_OFFSET
  )

  const dateStr = formatDateRu(yesterday)
  const dateUtm = yesterday.toISOString().slice(0, 10).replace(/-/g, '')

  log(`Выборка за ${yesterday.toISOString().slice(0, 10)} МСК`)

  // Основной запрос с запасом
  let articles: Article[]
  try {
    const q = supabase
      .from('articles')
      .select('*')
      .eq('published', true)
      .eq('quality_ok', true)
      .eq('verified_live', true)
      .eq('publish_status', 'live')
      .eq('tg_sent', false)
      .not('tg_teaser', 'is', null)
      .not('slug', 'is', null)
      .order('score', { ascending: false })
      .order('pub_date', { ascending: false })

    if (!force) {
      q.gte('pub_date', from.toISOString()).lte('pub_date', to.toISOString())
    }

    const { data, error } = await q.limit(8)
    if (error) throw error
    articles = (data ?? []) as Article[]
  } catch (err) {
    await finalizeDigestFailure(supabase, runId, err).catch((finalizeErr) => {
      logError('Не удалось записать failed digest_run', finalizeErr)
    })
    logError('Ошибка запроса к Supabase', err)
    process.exit(1)
  }

  if (articles.length === 0) {
    log('Нет новых статей для дайджеста')
    await finalizeDigestNonDelivery(supabase, runId, 'skipped', { articles_count: 0, site_url: siteUrl })
    process.exit(0)
  }

  log(`Найдено статей (до фильтра): ${articles.length}`)

  // Проверяем доступность на сайте
  const liveArticles = await filterLiveArticles(articles, siteUrl)

  // Берём не более 5
  const digest = liveArticles.slice(0, 5)

  // Если меньше 3 — health-отчёт и не шлём в канал
  if (digest.length < 3) {
    log(`Слишком мало статей (${digest.length}) — дайджест не отправлен`)
    await finalizeDigestNonDelivery(supabase, runId, 'low_articles', {
      articles_count: digest.length,
      article_ids: digest.map((a) => a.id),
      site_url: siteUrl,
    })
    if (adminChatId) {
      try { await sendHealthReport(supabase, botToken, adminChatId, digest.length, dateStr) } catch { /* некритично */ }
    }
    process.exit(0)
  }

  // Считаем total за день
  let totalToday = digest.length
  try {
    const countQuery = supabase
      .from('articles')
      .select('*', { count: 'exact', head: true })
      .eq('published', true)
      .eq('quality_ok', true)
      .eq('verified_live', true)
      .eq('publish_status', 'live')

    if (!force) {
      countQuery.gte('pub_date', from.toISOString()).lte('pub_date', to.toISOString())
    }

    const { count } = await countQuery
    totalToday = count ?? digest.length
  } catch { /* некритично */ }

  const messageText = buildDigestText(digest, siteUrl, totalToday, dateStr, dateUtm)

  log('Сформированное сообщение:')
  console.log('─'.repeat(60))
  console.log(messageText)
  console.log('─'.repeat(60))

  const ids = digest.map((a) => a.id)
  try {
    await deliverClaimedDigest(supabase, runId, botToken, channelId, messageText, ids, siteUrl)
    log(`tg_sent = true для ${ids.length} статей`)
  } catch (err) {
    logError('Ошибка отправки дайджеста', err)
    process.exit(1)
  }

  log(`Дайджест отправлен: ${digest.length} статей`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    logError('Unhandled error in main', err)
    process.exit(1)
  })
}
