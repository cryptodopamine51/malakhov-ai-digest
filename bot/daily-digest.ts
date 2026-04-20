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
config({ path: resolve(process.cwd(), '.env.local') })

import { getServerClient } from '../lib/supabase'
import type { Article } from '../lib/supabase'

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
}

async function sendTelegramMessage(
  botToken: string,
  chatId: string,
  text: string,
  disablePreview = false,
): Promise<void> {
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
}

// ── Проверка доступности ──────────────────────────────────────────────────────

async function isArticleLive(siteUrl: string, slug: string): Promise<boolean> {
  try {
    const res = await fetch(`${siteUrl}/articles/${slug}`, { method: 'HEAD' })
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
  return `${siteUrl}/articles/${slug}?utm_source=tg&utm_medium=digest&utm_campaign=daily_${date}&utm_content=${position}`
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
  botToken: string,
  adminChatId: string,
  articlesCount: number,
): Promise<void> {
  const text = [
    `⚠️ Сегодня в дайджесте всего ${articlesCount} статей`,
    `Минимум для отправки: 3. Дайджест не отправлен.`,
    `Проверь pipeline: enrich.yml и scorer.ts`,
  ].join('\n')

  await sendTelegramMessage(botToken, adminChatId, text, true)
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
    if (error) console.error(`[digest_runs insert error] ${error.message}`)
  } catch (err) {
    console.error(`[digest_runs] Не удалось записать лог: ${err instanceof Error ? err.message : String(err)}`)
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

  const supabase = getServerClient()

  // Защита от двойной отправки
  const force = process.env.FORCE_DIGEST === '1'
  if (!force) {
    const eightHoursAgo = new Date(Date.now() - 8 * 60 * 60 * 1000).toISOString()
    const { count: recentlySent } = await supabase
      .from('articles')
      .select('*', { count: 'exact', head: true })
      .eq('tg_sent', true)
      .gte('updated_at', eightHoursAgo)

    if ((recentlySent ?? 0) > 0) {
      log(`Дайджест за сегодня уже отправлен (${recentlySent} статей) — пропускаем`)
      await logDigestRun(supabase, { status: 'skipped', site_url: siteUrl })
      process.exit(0)
    }
  } else {
    log('FORCE_DIGEST=1 — защита от дублей отключена')
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
    logError('Ошибка запроса к Supabase', err)
    process.exit(1)
  }

  if (articles.length === 0) {
    log('Нет новых статей для дайджеста')
    await logDigestRun(supabase, { status: 'skipped', articles_count: 0, site_url: siteUrl })
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
    await logDigestRun(supabase, {
      status: 'low_articles',
      articles_count: digest.length,
      article_ids: digest.map((a) => a.id),
      site_url: siteUrl,
    })
    if (adminChatId) {
      try { await sendHealthReport(botToken, adminChatId, digest.length) } catch { /* некритично */ }
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

  // Отправляем — первая ссылка даёт превью (disable_web_page_preview=false)
  try {
    await sendTelegramMessage(botToken, channelId, messageText, false)
  } catch (err) {
    logError('Ошибка отправки в Telegram', err)
    await logDigestRun(supabase, {
      status: 'error',
      articles_count: digest.length,
      article_ids: digest.map((a) => a.id),
      message_text: messageText,
      error_message: err instanceof Error ? err.message : String(err),
      site_url: siteUrl,
    })
    process.exit(1)
  }

  // Помечаем как отправленные
  const ids = digest.map((a) => a.id)
  try {
    const { error } = await supabase.from('articles').update({ tg_sent: true }).in('id', ids)
    if (error) throw error
    log(`tg_sent = true для ${ids.length} статей`)
  } catch (err) {
    logError('Ошибка обновления tg_sent', err)
  }

  await logDigestRun(supabase, {
    status: 'success',
    articles_count: digest.length,
    article_ids: digest.map((a) => a.id),
    message_text: messageText,
    site_url: siteUrl,
  })

  log(`Дайджест отправлен: ${digest.length} статей`)
}

main()
