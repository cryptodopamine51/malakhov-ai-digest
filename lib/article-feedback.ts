import type { SupabaseClient } from '@supabase/supabase-js'

export interface ParsedFeedbackCallback {
  articleId: string
  rating: 0 | 1 | 2
}

export function parseFeedbackCallbackData(value: unknown): ParsedFeedbackCallback | null {
  if (typeof value !== 'string') return null
  const match = value.match(/^af:([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}):([012])$/i)
  if (!match) return null
  return {
    articleId: match[1]!.toLowerCase(),
    rating: Number(match[2]) as 0 | 1 | 2,
  }
}

export function feedbackRatingLabel(rating: 0 | 1 | 2): string {
  if (rating === 2) return '🔥 сильная'
  if (rating === 1) return '👌 норм'
  return '👎 слабая'
}

export function isAuthorizedFeedbackUser(fromId: number | null | undefined, env: NodeJS.ProcessEnv = process.env): boolean {
  const ownerId = env.TELEGRAM_OWNER_USER_ID ?? env.TELEGRAM_ADMIN_CHAT_ID
  if (!ownerId || typeof fromId !== 'number') return false
  return String(fromId) === String(ownerId)
}

export function withFeedbackConfirmation(text: string, rating: 0 | 1 | 2): string {
  const clean = text.replace(/\n\n✓ оценено: .+$/u, '').trimEnd()
  return `${clean}\n\n✓ оценено: ${feedbackRatingLabel(rating)}`
}

export async function upsertArticleFeedback(params: {
  supabase: SupabaseClient
  articleId: string
  rating: 0 | 1 | 2
  telegramChatId: number | null
  telegramMessageId: number | null
  telegramUserId: number
  metadata?: Record<string, unknown>
}): Promise<void> {
  const { error } = await params.supabase
    .from('article_feedback')
    .upsert({
      article_id: params.articleId,
      rating: params.rating,
      source: 'owner_tg',
      telegram_chat_id: params.telegramChatId,
      telegram_message_id: params.telegramMessageId,
      telegram_user_id: params.telegramUserId,
      metadata: params.metadata ?? {},
    }, { onConflict: 'article_id,source' })

  if (error) throw new Error(`article_feedback upsert failed: ${error.message}`)
}
