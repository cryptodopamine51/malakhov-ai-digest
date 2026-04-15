/**
 * bot/daily-digest.ts
 *
 * Ежедневный Telegram-дайджест: берёт топ-5 новых статей из Supabase,
 * формирует сообщение и отправляет в канал. Опционально — health-отчёт в личку.
 *
 * Запуск: npm run tg-digest
 */

import { config } from 'dotenv'
import { resolve } from 'path'

config({ path: resolve(process.cwd(), '.env.local') })

import { getServerClient } from '../lib/supabase'
import type { Article } from '../lib/supabase'

// ── Утилиты ───────────────────────────────────────────────────────────────────

function log(message: string): void {
  const ts = new Date().toISOString().replace('T', ' ').slice(0, 19)
  console.log(`[${ts}] ${message}`)
}

function logError(message: string, error?: unknown): void {
  const ts = new Date().toISOString().replace('T', ' ').slice(0, 19)
  const detail =
    error instanceof Error
      ? error.message
      : error && typeof error === 'object' && 'message' in error
        ? String((error as Record<string, unknown>).message)
        : String(error ?? '')
  console.error(`[${ts}] ERROR: ${message}${detail ? ` — ${detail}` : ''}`)
}

// ── Форматирование даты на русском ────────────────────────────────────────────

const RU_MONTHS = [
  'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря',
]

function formatDateRu(date: Date): string {
  return `${date.getDate()} ${RU_MONTHS[date.getMonth()]}`
}

// ── Экранирование Telegram Markdown v1 ────────────────────────────────────────
// Экранируем _ ` [ в обычном тексте (не в заголовках, они уже в **)

function escapeMd(text: string): string {
  return text.replace(/([_`\[])/g, '\\$1')
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
  disablePreview = true,
): Promise<void> {
  const url = `https://api.telegram.org/bot${botToken}/sendMessage`
  const body = JSON.stringify({
    chat_id: chatId,
    text,
    parse_mode: 'Markdown',
    disable_web_page_preview: disablePreview,
  })

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  })

  const data = (await res.json()) as TelegramResponse

  if (!data.ok) {
    throw new Error(data.description ?? 'Telegram API вернул ok: false')
  }
}

// ── Формирование текста дайджеста ─────────────────────────────────────────────

function buildDigestText(articles: Article[], siteUrl: string): string {
  const dateStr = formatDateRu(new Date())

  const lines: string[] = [`🤖 *Malakhov AI Дайджест* — ${dateStr}`, '']

  articles.forEach((article, idx) => {
    const title = escapeMd(article.ru_title ?? article.original_title)
    const body =
      article.why_it_matters
        ? escapeMd(article.why_it_matters)
        : escapeMd((article.ru_text ?? article.original_text ?? '').slice(0, 120))
    const articleUrl = `${siteUrl}/articles/${article.slug}`

    lines.push(`*${idx + 1}. ${title}*`)
    if (body) lines.push(body)
    lines.push(`[Читать →](${articleUrl})`)
    lines.push('')
  })

  lines.push('——————————————')
  lines.push(`Все новости: ${siteUrl}`)

  return lines.join('\n')
}

// ── Health-отчёт ──────────────────────────────────────────────────────────────

async function sendHealthReport(
  botToken: string,
  adminChatId: string,
): Promise<void> {
  const supabase = getServerClient()
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

  const [{ count: total }, { count: published }, { count: sent }] =
    await Promise.all([
      supabase
        .from('articles')
        .select('*', { count: 'exact', head: true })
        .gte('created_at', since),
      supabase
        .from('articles')
        .select('*', { count: 'exact', head: true })
        .gte('created_at', since)
        .eq('published', true),
      supabase
        .from('articles')
        .select('*', { count: 'exact', head: true })
        .gte('created_at', since)
        .eq('tg_sent', true),
    ])

  const dateStr = formatDateRu(new Date())
  const text = [
    `📊 Health Report ${dateStr}`,
    `Спарсено: ${total ?? 0}`,
    `Опубликовано: ${published ?? 0}`,
    `Отправлено в TG: ${sent ?? 0}`,
    `Источники с ошибками: смотри GitHub Actions логи`,
  ].join('\n')

  await sendTelegramMessage(botToken, adminChatId, text, true)
  log('Health-отчёт отправлен администратору')
}

// ── Основная логика ───────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const botToken = process.env.TELEGRAM_BOT_TOKEN
  const channelId = process.env.TELEGRAM_CHANNEL_ID
  const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL ?? '').replace(/\/$/, '')
  const adminChatId = process.env.TELEGRAM_ADMIN_CHAT_ID

  if (!botToken) {
    logError('Не задан TELEGRAM_BOT_TOKEN')
    process.exit(1)
  }
  if (!channelId) {
    logError('Не задан TELEGRAM_CHANNEL_ID')
    process.exit(1)
  }
  if (!siteUrl) {
    logError('Не задан NEXT_PUBLIC_SITE_URL')
    process.exit(1)
  }

  log('Запуск дайджеста...')

  // 1. Достать топ-5 статей за последние 24 часа
  const supabase = getServerClient()
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

  let articles: Article[]

  try {
    const { data, error } = await supabase
      .from('articles')
      .select('*')
      .eq('published', true)
      .eq('tg_sent', false)
      .gte('created_at', since)
      .order('score', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(5)

    if (error) throw error
    articles = (data ?? []) as Article[]
  } catch (err) {
    logError('Ошибка запроса к Supabase', err)
    process.exit(1)
  }

  // 2. Нет статей — выходим
  if (articles.length === 0) {
    log('Нет новых статей для дайджеста')
    process.exit(0)
  }

  log(`Найдено статей: ${articles.length}`)

  // 3. Формируем сообщение
  const messageText = buildDigestText(articles, siteUrl)

  log('Сформированное сообщение:')
  console.log('─'.repeat(60))
  console.log(messageText)
  console.log('─'.repeat(60))

  // 4. Отправляем в канал
  try {
    await sendTelegramMessage(botToken, channelId, messageText)
  } catch (err) {
    logError('Ошибка отправки в Telegram', err)
    log('Сообщение сформировано корректно, но отправка не прошла')
    process.exit(1)
  }

  // 5. Помечаем статьи как отправленные
  const ids = articles.map((a) => a.id)

  try {
    const { error } = await supabase
      .from('articles')
      .update({ tg_sent: true })
      .in('id', ids)

    if (error) throw error
    log(`tg_sent = true для ${ids.length} статей`)
  } catch (err) {
    logError('Ошибка обновления tg_sent в Supabase', err)
    // Не падаем — сообщение уже отправлено, это некритично
  }

  log(`Дайджест отправлен: ${articles.length} статей`)

  // 6. Health-отчёт (опционально)
  if (adminChatId) {
    try {
      await sendHealthReport(botToken, adminChatId)
    } catch (err) {
      logError('Ошибка отправки health-отчёта', err)
      // Некритично — не падаем
    }
  }
}

main()
