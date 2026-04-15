/**
 * pipeline/scorer.ts
 *
 * Оценка релевантности статьи для публикации.
 * Возвращает целое число ≥ 0.
 */

import type { Article } from '../lib/supabase'

// ── Списки источников ─────────────────────────────────────────────────────────

/** Ведущие AI-лаборатории — высший приоритет */
const AI_LABS: string[] = [
  'OpenAI',
  'Google Research',
  'Hugging Face',
  'Anthropic',
  'DeepMind',
  'Meta AI',
  'Mistral',
]

/** Топовые отраслевые издания */
const TOP_OUTLETS: string[] = [
  'VentureBeat',
  'The Verge',
  'MIT Technology Review',
  'Wired',
  'The Decoder',
]

// ── Основная функция ──────────────────────────────────────────────────────────

/**
 * Считает score статьи на основе источника, тематики, свежести и длины текста.
 *
 * Логика начисления очков:
 *   +3  — статья из AI-лаборатории (OpenAI, Anthropic, DeepMind и др.)
 *   +2  — российская AI-тематика (topics содержит 'ai-russia')
 *   +1  — текст содержательный (original_text длиннее 200 символов)
 *   +1  — статья свежая (pub_date не старше 6 часов)
 *   +1  — источник входит в топ-издания
 *   -1  — заголовок короче 5 слов (скудный заголовок — признак неважной новости)
 */
export function scoreArticle(article: Article): number {
  let score = 0

  // +3 за источник — AI-лаборатория
  if (AI_LABS.some((lab) => article.source_name.includes(lab))) {
    score += 3
  }

  // +2 за российскую AI-тематику
  if (article.topics?.includes('ai-russia')) {
    score += 2
  }

  // +1 если есть содержательный текст (заполняется при обогащении предыдущего батча)
  if ((article.original_text?.length ?? 0) > 200) {
    score += 1
  }

  // +1 за свежесть — опубликовано не позже 6 часов назад
  const sixHoursAgo = new Date(Date.now() - 6 * 60 * 60 * 1000)
  if (article.pub_date && new Date(article.pub_date) > sixHoursAgo) {
    score += 1
  }

  // +1 за топовое издание
  if (TOP_OUTLETS.some((outlet) => article.source_name.includes(outlet))) {
    score += 1
  }

  // -1 за слишком короткий заголовок (менее 5 слов)
  const wordCount = article.original_title.trim().split(/\s+/).length
  if (wordCount < 5) {
    score -= 1
  }

  return Math.max(0, score)
}
