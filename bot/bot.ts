/**
 * bot/bot.ts
 *
 * Long-polling Telegram-бот для @malakhovaibot.
 * Отвечает на /start и любое сообщение приглашением подписаться на канал.
 *
 * Запуск: npm run bot
 */

import { config } from 'dotenv'
import { resolve } from 'path'

config({ path: resolve(process.cwd(), '.env.local') })

import { Telegraf, Markup, type Context } from 'telegraf'

import { readSiteUrlFromEnv } from '../lib/site'
import { getServerClient } from '../lib/supabase'
import {
  formatOpsAlertsForTelegram,
  formatOpsCostForTelegram,
  formatOpsSummaryForTelegram,
  getOpsSummary,
} from '../lib/ops-summary'

const botToken = process.env.TELEGRAM_BOT_TOKEN
const siteUrl = readSiteUrlFromEnv(process.env.NEXT_PUBLIC_SITE_URL) || 'https://news.malakhovai.ru'
const adminChatId = process.env.TELEGRAM_ADMIN_CHAT_ID

if (!botToken) {
  console.error('Не задан TELEGRAM_BOT_TOKEN')
  process.exit(1)
}

const bot = new Telegraf(botToken)

const WELCOME_TEXT = `👋 Привет! Я бот Malakhov AI Дайджеста.

Каждое утро в 9:00 мы публикуем лучшие AI-новости за день.

📢 Подпишись на канал чтобы не пропустить:
👉 @malakhovAIdigest

🌐 Сайт со всеми материалами:
${siteUrl}`

const KEYBOARD = Markup.inlineKeyboard([
  [
    Markup.button.url('📢 Открыть канал', 'https://t.me/malakhovAIdigest'),
    Markup.button.url('🌐 Сайт', siteUrl),
  ],
])

async function sendWelcome(ctx: Context): Promise<void> {
  await ctx.reply(WELCOME_TEXT, KEYBOARD)
}

function isAdminChat(ctx: Context): boolean {
  return Boolean(adminChatId && ctx.chat?.id && String(ctx.chat.id) === adminChatId)
}

async function replyAdmin(ctx: Context, text: string): Promise<void> {
  await ctx.reply(text, {
    parse_mode: 'HTML',
  })
}

async function sendAdminSummary(ctx: Context, formatter: 'summary' | 'alerts' | 'cost'): Promise<void> {
  if (!isAdminChat(ctx)) {
    await sendWelcome(ctx)
    return
  }

  try {
    const summary = await getOpsSummary(getServerClient(), { reportKind: 'manual' })
    if (formatter === 'alerts') await replyAdmin(ctx, formatOpsAlertsForTelegram(summary))
    else if (formatter === 'cost') await replyAdmin(ctx, formatOpsCostForTelegram(summary))
    else await replyAdmin(ctx, formatOpsSummaryForTelegram(summary))
  } catch (error) {
    await replyAdmin(ctx, `🔴 <b>Ops command failed</b>\n${error instanceof Error ? error.message : String(error)}`)
  }
}

bot.start(sendWelcome)
bot.command('status', (ctx) => sendAdminSummary(ctx, 'summary'))
bot.command('alerts', (ctx) => sendAdminSummary(ctx, 'alerts'))
bot.command('cost', (ctx) => sendAdminSummary(ctx, 'cost'))
bot.on('message', sendWelcome)

bot.launch()

console.log('🤖 Бот запущен — ожидаю сообщений...')

// Корректное завершение при Ctrl+C / SIGTERM
process.once('SIGINT', () => bot.stop('SIGINT'))
process.once('SIGTERM', () => bot.stop('SIGTERM'))
