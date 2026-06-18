/**
 * pipeline/scorer.ts
 *
 * Оценка релевантности статьи. Score определяет:
 *   1. Допуск к редактору Claude (порог в scorer.config.ts).
 *   2. Порядок в Telegram-дайджесте (с поправкой на diversity-кэп в `bot/daily-digest-core.ts`).
 *
 * Версия 2026-05-22 (`spec_2026-05-22_digest_editorial_priority.md` Wave 1):
 *   - убрано дублирование `ai-russia +2` + `source_lang=ru +1` (теперь только `ai-russia +1`);
 *   - AI-лаборатории детектируются по сущностям в title/text, а не только по source_name;
 *   - major-announcement-сигнал (unveils/launches/представил/анонсиров) даёт +2 поверх AI-lab match,
 *     чтобы реальные продуктовые анонсы Gemini/GPT/Claude не проигрывали dev-материалам Habr;
 *   - длинный editorial_body (а не raw text) даёт +1 после enrich;
 *   - +1 за обложку больше не начисляется AI/template/stock-обложкам, потому что это fill-in,
 *     а не сигнал качества источника.
 */

import type { Article } from '../lib/supabase'
import { articleHasCategory } from './scorer.config'

const STARTUP_SIGNAL_RE = /(\$|€|£)\s?\d+(?:[.,]\d+)?\s?(?:m|mn|million|b|bn|billion)?|series\s?[abc]|seed(?:\s+round)?|pre-seed|раунд|посев|привлек[а-я]*|оценк[а-я]*|инвестиц[а-я]*/i

// Сущности, которые делают материал крупным AI-сюжетом независимо от выбранного издания.
// Word-boundary через Unicode \P{L} (не-буква любого скрипта) — так корректно работают и латинские,
// и кириллические соседи токена.
const AI_LAB_TOKEN_RE =
  /(?:^|\P{L})(openai|chatgpt|gpt-?\d(?:\.\d)?|sora|anthropic|claude|deepmind|gemini|veo|imagen|mistral|cohere|xai|grok|llama|nvidia|blackwell|copilot|phi-?\d|yandexgpt|gigachat)(?:$|\P{L})/iu

// Глаголы запуска/анонса. EN — через Unicode word-boundary, RU — через стем substring.
const EN_ANNOUNCEMENT_RE =
  /(?:^|\P{L})(unveil(?:s|ed|ing)?|launch(?:es|ed|ing)?|announc(?:es|ed|ing)?|releas(?:es|ed|ing)?|introduc(?:es|ed|ing)?|debut(?:s|ed|ing)?)(?:$|\P{L})/iu

const RU_ANNOUNCEMENT_RE = /(представ(?:ил|ля|ит)|запуст(?:ил|ит|ил[аи])|запуска(?:ет|ют)|анонсир(?:овал|ует)|выпуст(?:ил|ит|или))/i

const GENERATED_COVER_URL_RE = /\/article-images\/(?:ai|template|stock)-covers\//

const TOP_OUTLETS: string[] = [
  'VentureBeat',
  'The Verge',
  'MIT Technology Review',
  'Wired',
  'The Decoder',
]

function hasAiLabSignal(article: Article): boolean {
  const haystacks = [article.original_title, article.ru_title, article.original_text?.slice(0, 1200)]
    .filter((value): value is string => typeof value === 'string' && value.length > 0)
  return haystacks.some((value) => AI_LAB_TOKEN_RE.test(value))
}

function hasMajorAnnouncementSignal(article: Article): boolean {
  const titles = [article.original_title, article.ru_title]
    .filter((value): value is string => typeof value === 'string' && value.length > 0)
  return titles.some((value) => EN_ANNOUNCEMENT_RE.test(value) || RU_ANNOUNCEMENT_RE.test(value))
}

function hasRealCover(article: Article): boolean {
  const url = article.cover_image_url
  if (typeof url !== 'string' || url.length === 0) return false
  return !GENERATED_COVER_URL_RE.test(url)
}

export function scoreArticle(article: Article): number {
  let score = 0

  const aiLabMatch = hasAiLabSignal(article)
  if (aiLabMatch) score += 2

  if (aiLabMatch && hasMajorAnnouncementSignal(article)) score += 2

  if (articleHasCategory(article, 'ai-russia')) score += 1

  if ((article.original_text?.length ?? 0) > 200) score += 1

  if (article.pub_date && new Date(article.pub_date) > new Date(Date.now() - 6 * 60 * 60 * 1000)) {
    score += 1
  }

  // Внешний бонус за «топовое» издание: материал ещё может не упоминать конкретную лабу в
  // заголовке, но если он на Verge / MIT TR / Wired / Decoder / VentureBeat — это сигнал.
  if (TOP_OUTLETS.some((outlet) => article.source_name.includes(outlet))) score += 1

  // Длина уже отредактированного материала. Сырой original_text больше +1 не даёт — Habr/CNews
  // часто прицепляют UI-мусор, который раздувал raw text без editorial-качества.
  if ((article.editorial_body?.length ?? 0) > 1000) score += 1

  if (hasRealCover(article)) score += 1

  if (article.original_title.trim().split(/\s+/).length < 5) score -= 1

  if (articleHasCategory(article, 'ai-startups')) {
    const text = `${article.original_title}\n${article.original_text ?? ''}`
    if (STARTUP_SIGNAL_RE.test(text)) score += 1
  }

  return Math.max(0, score)
}
