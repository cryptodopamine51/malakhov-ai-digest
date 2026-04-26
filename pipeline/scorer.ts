/**
 * pipeline/scorer.ts
 *
 * Оценка релевантности статьи. Score определяет допуск к редактору Claude.
 * Порог для Claude задаётся в scorer.config.ts и может отличаться по категориям.
 */

import type { Article } from '../lib/supabase'
import { articleHasCategory } from './scorer.config'

const AI_LABS: string[] = [
  'OpenAI',
  'Google Research',
  'Hugging Face',
  'Anthropic',
  'DeepMind',
  'Meta AI',
  'Mistral',
]

const TOP_OUTLETS: string[] = [
  'VentureBeat',
  'The Verge',
  'MIT Technology Review',
  'Wired',
  'The Decoder',
]

const STARTUP_SIGNAL_RE = /(\$|€|£)\s?\d+(?:[.,]\d+)?\s?(?:m|mn|million|b|bn|billion)?|series\s?[abc]|seed(?:\s+round)?|pre-seed|раунд|посев|привлек[а-я]*|оценк[а-я]*|инвестиц[а-я]*/i

export function scoreArticle(article: Article): number {
  let score = 0

  if (AI_LABS.some((lab) => article.source_name.includes(lab))) score += 3
  if (article.topics?.includes('ai-russia')) score += 2
  if ((article.original_text?.length ?? 0) > 200) score += 1
  if (article.pub_date && new Date(article.pub_date) > new Date(Date.now() - 6 * 60 * 60 * 1000)) score += 1
  if (TOP_OUTLETS.some((outlet) => article.source_name.includes(outlet))) score += 1
  if ((article.original_text?.length ?? 0) > 1000) score += 1
  if (article.cover_image_url) score += 1
  if (article.source_lang === 'ru') score += 1
  if (article.original_title.trim().split(/\s+/).length < 5) score -= 1
  if (articleHasCategory(article, 'ai-startups')) {
    const text = `${article.original_title}\n${article.original_text ?? ''}`
    if (STARTUP_SIGNAL_RE.test(text)) score += 1
  }

  return Math.max(0, score)
}
