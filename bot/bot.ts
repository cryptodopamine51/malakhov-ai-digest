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

const botToken = process.env.TELEGRAM_BOT_TOKEN
const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL ?? 'https://news.malakhovai.ru').replace(/\/$/, '')

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

bot.start(sendWelcome)
bot.on('message', sendWelcome)

bot.launch()

console.log('🤖 Бот запущен — ожидаю сообщений...')

// Корректное завершение при Ctrl+C / SIGTERM
process.once('SIGINT', () => bot.stop('SIGINT'))
process.once('SIGTERM', () => bot.stop('SIGTERM'))
