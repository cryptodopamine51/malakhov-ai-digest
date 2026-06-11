import { NextRequest, NextResponse } from 'next/server'
import { getServerClient } from '../../../lib/supabase'
import {
  isAuthorizedFeedbackUser,
  parseFeedbackCallbackData,
  upsertArticleFeedback,
  withFeedbackConfirmationForArticle,
} from '../../../lib/article-feedback'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface TelegramCallbackQuery {
  id: string
  data?: string
  from?: { id?: number; username?: string }
  message?: {
    message_id?: number
    chat?: { id?: number }
    text?: string
    caption?: string
    reply_markup?: unknown
  }
}

interface TelegramUpdate {
  callback_query?: TelegramCallbackQuery
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const expectedSecret = process.env.TELEGRAM_FEEDBACK_SECRET_TOKEN ?? process.env.CRON_SECRET
  if (!expectedSecret) {
    return NextResponse.json({ ok: false, error: 'TELEGRAM_FEEDBACK_SECRET_TOKEN is not configured' }, { status: 500 })
  }

  const actualSecret = request.headers.get('x-telegram-bot-api-secret-token')
  if (actualSecret !== expectedSecret) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }

  const update = await request.json().catch(() => null) as TelegramUpdate | null
  const callback = update?.callback_query
  const parsed = parseFeedbackCallbackData(callback?.data)
  const fromId = callback?.from?.id
  const fromUsername = callback?.from?.username

  if (!callback?.id || !parsed) {
    return NextResponse.json({ ok: true, skipped: 'not_feedback_callback' })
  }

  const botToken = process.env.TELEGRAM_BOT_TOKEN
  if (!botToken) {
    return NextResponse.json({ ok: false, error: 'TELEGRAM_BOT_TOKEN missing' }, { status: 500 })
  }

  const chatId = callback.message?.chat?.id ?? null
  if (!isAuthorizedFeedbackUser(fromId, fromUsername, chatId)) {
    await answerCallbackQuery(botToken, callback.id, 'Недостаточно прав')
    return NextResponse.json({ ok: true, skipped: 'forbidden_user' })
  }

  const messageId = callback.message?.message_id ?? null
  await upsertArticleFeedback({
    supabase: getServerClient(),
    articleId: parsed.articleId,
    rating: parsed.rating,
    telegramChatId: chatId,
    telegramMessageId: messageId,
    telegramUserId: fromId!,
    metadata: { callback_id: callback.id, username: fromUsername ?? null },
  })

  await answerCallbackQuery(botToken, callback.id, `Оценено: ${ratingShort(parsed.rating)}`)
  await editFeedbackMessage(botToken, callback, parsed.articleId, parsed.rating)

  return NextResponse.json({ ok: true })
}

async function answerCallbackQuery(botToken: string, callbackQueryId: string, text: string): Promise<void> {
  await fetch(`https://api.telegram.org/bot${botToken}/answerCallbackQuery`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      callback_query_id: callbackQueryId,
      text,
      show_alert: false,
    }),
  }).catch(() => null)
}

async function editFeedbackMessage(
  botToken: string,
  callback: TelegramCallbackQuery,
  articleId: string,
  rating: 0 | 1 | 2,
): Promise<void> {
  const chatId = callback.message?.chat?.id
  const messageId = callback.message?.message_id
  if (typeof chatId !== 'number' || typeof messageId !== 'number') return

  const replyMarkup = callback.message?.reply_markup
  const caption = callback.message?.caption
  const text = callback.message?.text
  if (typeof caption === 'string') {
    await fetch(`https://api.telegram.org/bot${botToken}/editMessageCaption`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        message_id: messageId,
        caption: withFeedbackConfirmationForArticle(caption, articleId, rating, replyMarkup),
        reply_markup: replyMarkup,
      }),
    }).catch(() => null)
    return
  }

  if (typeof text === 'string') {
    await fetch(`https://api.telegram.org/bot${botToken}/editMessageText`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        message_id: messageId,
        text: withFeedbackConfirmationForArticle(text, articleId, rating, replyMarkup),
        disable_web_page_preview: false,
        reply_markup: replyMarkup,
      }),
    }).catch(() => null)
  }
}

function ratingShort(rating: 0 | 1 | 2): string {
  if (rating === 2) return 'сильная'
  if (rating === 1) return 'норм'
  return 'слабая'
}
