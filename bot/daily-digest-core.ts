/**
 * bot/daily-digest-core.ts
 *
 * Pure-logic ядро ежедневного дайджеста.
 *
 * Использует возвраты вместо `process.exit`, не подключает dotenv — пригодно
 * как для CLI-обёртки (`bot/daily-digest.ts`), так и для серверлесс-роута
 * (`app/api/cron/tg-digest/route.ts`), который дёргает Vercel Cron.
 */

import { createHash } from 'crypto'

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

async function isArticleLive(
  siteUrl: string,
  slug: string,
  primaryCategory: string | null,
): Promise<boolean> {
  try {
    const res = await fetch(getArticleUrl(siteUrl, slug, primaryCategory), {
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
      const live = await isArticleLive(siteUrl, article.slug, article.primary_category)
      if (!live) log(`⚠ Страница недоступна, пропускаем: ${article.slug}`)
      return live ? article : null
    })
  )
  return results.filter((a): a is Article => a !== null)
}

// ── UTM-ссылки ────────────────────────────────────────────────────────────────

function articleUrl(
  siteUrl: string,
  slug: string,
  primaryCategory: string | null,
  position: number,
  date: string,
): string {
  return `${getArticleUrl(siteUrl, slug, primaryCategory)}?utm_source=tg&utm_medium=digest&utm_campaign=daily_${date}&utm_content=${position}`
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
    const url = articleUrl(siteUrl, article.slug!, article.primary_category, pos, dateUtm)

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

// Migration 015 — digest_runs.status enum (надмножество с legacy).
// Legacy: 'running' | 'success' | 'skipped' | 'low_articles' | 'error' | 'failed'.
// Новые точные коды для runDailyDigest(): см. docs/spec_observability_publication_2026-05-01.md § 6.
export type DigestRunStatus =
  | 'success'
  | 'skipped'
  | 'low_articles'
  | 'error'
  | 'failed'
  | 'skipped_already_claimed'
  | 'skipped_no_articles'
  | 'skipped_outside_window'
  | 'failed_send'
  | 'failed_pipeline_stalled'

interface DigestRunPayload {
  status: DigestRunStatus
  articles_count?: number
  article_ids?: string[]
  message_text?: string
  error_message?: string
  site_url?: string
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
  status: Extract<DigestRunStatus, 'failed' | 'failed_send' | 'failed_pipeline_stalled'> = 'failed_send',
): Promise<void> {
  const { error } = await supabase
    .from('digest_runs')
    .update({
      status,
      failed_at: new Date().toISOString(),
      error_message: err instanceof Error ? err.message : String(err),
    })
    .eq('id', runId)

  if (error) throw new Error(`digest failure finalize failed: ${error.message}`)
}

export async function finalizeDigestNonDelivery(
  supabase: DigestSupabase,
  runId: string,
  status: Exclude<DigestRunStatus, 'success'>,
  payload: Omit<DigestRunPayload, 'status'>,
): Promise<void> {
  const { error } = await supabase
    .from('digest_runs')
    .update({ ...payload, status })
    .eq('id', runId)

  if (error) throw new Error(`digest ${status} finalize failed: ${error.message}`)
}

/**
 * Пишет digest_runs row для веток, где slot ещё не заклеймен (claimDigestSlot вернул claimed=false).
 * UNIQUE partial index `idx_digest_runs_date_channel_live` покрывает только
 * ('running','success'), так что 'skipped_already_claimed' insert безопасен и
 * не конфликтует с уже существующим claim-row.
 */
export async function writeUnclaimedDigestRun(
  supabase: DigestSupabase,
  digestDate: string,
  channelId: string,
  status: Extract<DigestRunStatus, 'skipped_already_claimed' | 'skipped_outside_window'>,
  payload: Omit<DigestRunPayload, 'status'> = {},
): Promise<void> {
  const { error } = await supabase.from('digest_runs').insert({
    digest_date: digestDate,
    channel_id: channelId,
    status,
    ...payload,
  })

  if (error) {
    throw new Error(`digest_runs ${status} insert failed: ${error.message}`)
  }
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

// ── Public result type ────────────────────────────────────────────────────────

export type DigestResult =
  | { status: 'success'; messageId: number; articlesCount: number; runId: string }
  | { status: 'skipped_already_claimed'; reason: string }
  | { status: 'skipped_no_articles' }
  | { status: 'failed_pipeline_stalled'; stuckProcessing: number }
  | { status: 'low_articles'; articlesCount: number }
  | { status: 'preflight_failed'; reason: string }
  | { status: 'failed'; error: string }

// ── Основная логика ───────────────────────────────────────────────────────────

interface ClaimedContext {
  supabase: DigestSupabase
  runId: string
  force: boolean
  botToken: string
  channelId: string
  siteUrl: string
  adminChatId?: string
  digestDate: string
}

export async function runDailyDigest(): Promise<DigestResult> {
  const botToken = process.env.TELEGRAM_BOT_TOKEN
  const channelId = process.env.TELEGRAM_CHANNEL_ID
  const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL ?? '').replace(/\/$/, '')
  const adminChatId = process.env.TELEGRAM_ADMIN_CHAT_ID

  if (!botToken)  { logError('Не задан TELEGRAM_BOT_TOKEN');   return { status: 'preflight_failed', reason: 'TELEGRAM_BOT_TOKEN missing' } }
  if (!channelId) { logError('Не задан TELEGRAM_CHANNEL_ID');  return { status: 'preflight_failed', reason: 'TELEGRAM_CHANNEL_ID missing' } }
  if (!siteUrl)   { logError('Не задан NEXT_PUBLIC_SITE_URL'); return { status: 'preflight_failed', reason: 'NEXT_PUBLIC_SITE_URL missing' } }

  log('Запуск дайджеста...')

  try {
    assertServiceRoleKey()
  } catch (err) {
    logError('Supabase service-role preflight не пройден', err)
    return { status: 'preflight_failed', reason: err instanceof Error ? err.message : String(err) }
  }

  const supabase = getServerClient()
  const digestDate = getMoscowDateKey()

  const force = process.env.FORCE_DIGEST === '1'
  const forceConfirmDate = process.env.FORCE_DIGEST_CONFIRM_DATE
  if (force && forceConfirmDate !== digestDate) {
    logError(`FORCE_DIGEST=1 требует FORCE_DIGEST_CONFIRM_DATE=${digestDate}`)
    return { status: 'preflight_failed', reason: 'FORCE_DIGEST_CONFIRM_DATE mismatch' }
  }

  const claim = await claimDigestSlot(supabase, digestDate, channelId)
  if (!claim.claimed) {
    log(`Slot (${digestDate}, ${channelId}) уже занят: ${claim.reason} — выходим без отправки`)
    // W2.4: гарантируем строку digest_runs даже когда slot уже взят другим runner.
    try {
      await writeUnclaimedDigestRun(supabase, digestDate, channelId, 'skipped_already_claimed', {
        site_url: siteUrl,
        error_message: `slot already claimed: ${claim.reason}`,
      })
    } catch (logErr) {
      logError('writeUnclaimedDigestRun failed', logErr)
    }
    return { status: 'skipped_already_claimed', reason: claim.reason }
  }
  const runId = claim.runId

  // Safety net — любой неожиданный throw после claim переводит slot в
  // 'failed_send', чтобы не оставить запись висящей в 'running'. Без этой
  // обёртки CHECK violation, network glitch или function timeout оставляли
  // slot заклиненным навсегда (incident 2026-05-03).
  try {
    return await runClaimedDigest({
      supabase, runId, force, botToken, channelId, siteUrl, adminChatId, digestDate,
    })
  } catch (err) {
    logError('Unhandled exception in runClaimedDigest — переводим slot в failed_send', err)
    await finalizeDigestFailure(supabase, runId, err, 'failed_send').catch((finalizeErr) => {
      logError('safety-net finalizeDigestFailure тоже упал', finalizeErr)
    })
    return { status: 'failed', error: err instanceof Error ? err.message : String(err) }
  }
}

async function runClaimedDigest(ctx: ClaimedContext): Promise<DigestResult> {
  const { supabase, runId, force, botToken, channelId, siteUrl, adminChatId, digestDate } = ctx

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
      await finalizeDigestNonDelivery(supabase, runId, 'skipped_already_claimed', {
        site_url: siteUrl,
        error_message: `tg_sent fallback: ${recentlySent} статей за окно 8h`,
      })
      return { status: 'skipped_already_claimed', reason: `tg_sent fallback: ${recentlySent}` }
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
    await finalizeDigestFailure(supabase, runId, err, 'failed_send').catch((finalizeErr) => {
      logError('Не удалось записать failed digest_run', finalizeErr)
    })
    logError('Ошибка запроса к Supabase', err)
    return { status: 'failed', error: err instanceof Error ? err.message : String(err) }
  }

  if (articles.length === 0) {
    log('Нет новых статей для дайджеста')

    // Pipeline-stalled detection: пустая выборка может означать (а) тихий день,
    // (б) застрявший enrichment. Проверяем количество статей в processing > 6h —
    // это явный сигнал, что collector не подбирает результаты.
    const stalledThreshold = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString()
    const { count: stuckProcessing } = await supabase
      .from('articles')
      .select('*', { count: 'exact', head: true })
      .eq('enrich_status', 'processing')
      .lte('processing_started_at', stalledThreshold)

    if ((stuckProcessing ?? 0) > 0 && adminChatId) {
      try {
        await fireAlert({
          supabase,
          alertType: 'digest_pipeline_stalled',
          severity: 'critical',
          entityKey: digestDate,
          message: `Дайджест за ${digestDate} пуст, но в pipeline ${stuckProcessing} статей в processing > 6h — collector не подбирает результаты Anthropic Batch. Проверь recover-batch-stuck и nullsFirst в pollBatches.`,
          payload: { digestDate, stuckProcessing, stalledThreshold },
          botToken,
          adminChatId,
        })
      } catch { /* alert is best-effort */ }
    }

    const stuck = stuckProcessing ?? 0
    const noArticleStatus: Extract<DigestRunStatus, 'failed_pipeline_stalled' | 'skipped_no_articles'> =
      stuck > 0 ? 'failed_pipeline_stalled' : 'skipped_no_articles'
    await finalizeDigestNonDelivery(supabase, runId, noArticleStatus, {
      articles_count: 0,
      site_url: siteUrl,
      error_message: stuck > 0
        ? `pipeline_stalled: ${stuck} processing>6h`
        : 'no_articles_in_window',
    })
    return stuck > 0
      ? { status: 'failed_pipeline_stalled', stuckProcessing: stuck }
      : { status: 'skipped_no_articles' }
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
    return { status: 'low_articles', articlesCount: digest.length }
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
  let messageId: number
  try {
    // deliverClaimedDigest не возвращает message_id наружу — повторим минимальный fetch,
    // но безопаснее: получаем message_id из единственного источника, обернув send.
    const tgRes = await sendTelegramMessage(botToken, channelId, messageText, false)
    messageId = tgRes.result.message_id
    await markArticlesSent(supabase, ids)
    await finalizeDigestSuccess(supabase, runId, messageId, ids, messageText, siteUrl)
    log(`tg_sent = true для ${ids.length} статей`)
  } catch (err) {
    await finalizeDigestFailure(supabase, runId, err).catch((finalizeErr) => {
      logError('Не удалось записать failed digest_run', finalizeErr)
    })
    logError('Ошибка отправки дайджеста', err)
    return { status: 'failed', error: err instanceof Error ? err.message : String(err) }
  }

  log(`Дайджест отправлен: ${digest.length} статей`)
  return { status: 'success', messageId, articlesCount: digest.length, runId }
}
