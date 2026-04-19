/**
 * pipeline/scorer.ts
 *
 * Оценка релевантности статьи. Score определяет допуск к редактору Claude.
 * MIN_SCORE_FOR_CLAUDE = 2 — ниже Claude не вызывается, токены не тратятся.
 */

import type { Article } from '../lib/supabase'

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

export function scoreArticle(article: Article): number {
  let score = 0

  if (AI_LABS.some((lab) => article.source_name.includes(lab))) score += 3
  if (article.topics?.includes('ai-russia')) score += 2
  if ((article.original_text?.length ?? 0) > 200) score += 1
  if (article.pub_date && new Date(article.pub_date) > new Date(Date.now() - 6 * 60 * 60 * 1000)) score += 1
  if (TOP_OUTLETS.some((outlet) => article.source_name.includes(outlet))) score += 1
  if ((article.original_text?.length ?? 0) > 1000) score += 1
  if (article.cover_image_url) score += 1
  if (article.original_title.trim().split(/\s+/).length < 5) score -= 1

  return Math.max(0, score)
}
