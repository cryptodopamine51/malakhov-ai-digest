import type { Article } from './supabase'
import { sanitizeArticleMedia } from './media-sanitizer'
import { buildStorySourceCounts, getStoryImportance } from './story-signal'
import type { ImportanceComponents } from './story-signal'

export type { ImportanceComponents } from './story-signal'

export interface RankedInterestArticle {
  article: Article
  interest: number
  components: {
    editorialScore: number
    freshnessScore: number
    importanceScore: number
    sourceWeight: number
    contentQualityBonus: number
    mediaQualityBonus: number
    importance: ImportanceComponents
  }
}

export interface RankedRecommendationArticle {
  article: Article
  recommendation: number
  components: {
    samePrimaryCategory: boolean
    relevanceScore: number
    editorialScore: number
    freshnessScore: number
    importanceScore: number
    sourceWeight: number
    contentQualityBonus: number
    mediaQualityBonus: number
    importance: ImportanceComponents
  }
}

export interface RankInterestingArticlesOptions {
  limit?: number
  minItems?: number
  now?: Date
  excludeIds?: string[]
}

const TOP_SOURCE_RE =
  /(?:openai|anthropic|google deepmind|deepmind|mit technology review|ars technica|the verge|wired|nvidia|microsoft research)/i

const STABLE_SOURCE_RE =
  /(?:techcrunch|venturebeat|cnews|vc\.ru|habr|rb\.ru|tass|reuters|bloomberg)/i

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function timestamp(value: string | null | undefined): number | null {
  if (!value) return null
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : null
}

function freshnessTimestamp(article: Article): number {
  const created = timestamp(article.created_at)
  const pub = timestamp(article.pub_date)
  return created ?? pub ?? 0
}

export function compareArticlesByFreshness(a: Article, b: Article): number {
  const dateDiff = freshnessTimestamp(b) - freshnessTimestamp(a)
  if (dateDiff !== 0) return dateDiff

  const scoreDiff = (b.score ?? 0) - (a.score ?? 0)
  if (scoreDiff !== 0) return scoreDiff

  return String(b.id).localeCompare(String(a.id))
}

function getSourceWeight(sourceName: string): number {
  if (TOP_SOURCE_RE.test(sourceName)) return 1.2
  if (STABLE_SOURCE_RE.test(sourceName)) return 0.6
  return 0
}

function getContentQualityBonus(article: Article): number {
  let bonus = 0
  if (article.lead?.trim()) bonus += 0.5
  if ((article.summary?.length ?? 0) >= 3) bonus += 0.5
  if ((article.editorial_body?.length ?? 0) >= 1200) bonus += 0.5
  if (article.card_teaser?.trim()) bonus += 0.3
  return bonus
}

function getMediaQualityBonus(article: Article): number {
  const sanitized = sanitizeArticleMedia({
    coverImageUrl: article.cover_image_url,
    articleImages: article.article_images,
    context: {
      sourceName: article.source_name,
      originalUrl: article.original_url,
      originalTitle: article.original_title,
      ruTitle: article.ru_title,
      lead: article.lead,
      summary: article.summary,
      originalText: article.original_text ?? article.editorial_body,
    },
  })

  if (sanitized.rejects.length > 0) return -0.5
  if (sanitized.coverImageUrl) return 0.3
  return 0
}

// Вклад importance в итоговый ранг. В блоке «Самое интересное» важность сопоставима со
// свежестью (freshness уменьшен с ×3 до ×2), в рекомендациях — мягче, чтобы не перебивать
// тематическую релевантность. Само importance-ядро — в lib/story-signal.ts.
const INTEREST_IMPORTANCE_WEIGHT = 1.5
const RECOMMENDATION_IMPORTANCE_WEIGHT = 0.8

function list(value: string[] | null | undefined): string[] {
  return Array.isArray(value) ? value.filter(Boolean) : []
}

function sharedCount(a: string[] | null | undefined, b: string[] | null | undefined): number {
  const left = new Set(list(a))
  let count = 0
  for (const item of list(b)) {
    if (left.has(item)) count++
  }
  return count
}

function getRecommendationRelevance(current: Article, candidate: Article): {
  samePrimaryCategory: boolean
  relevanceScore: number
} {
  const samePrimaryCategory = candidate.primary_category === current.primary_category
  let relevanceScore = samePrimaryCategory ? 12 : 0

  if (list(candidate.secondary_categories).includes(current.primary_category)) relevanceScore += 4
  if (list(current.secondary_categories).includes(candidate.primary_category)) relevanceScore += 4
  relevanceScore += Math.min(sharedCount(current.secondary_categories, candidate.secondary_categories), 2) * 2
  relevanceScore += Math.min(sharedCount(current.topics, candidate.topics), 3)

  return { samePrimaryCategory, relevanceScore }
}

export function scoreInterestingArticle(
  article: Article,
  now = new Date(),
  storySourceCounts?: Map<string, number>,
): RankedInterestArticle {
  const editorialScore = clamp(Number(article.score ?? 0), 0, 10)
  const ageMs = Math.max(0, now.getTime() - freshnessTimestamp(article))
  const ageHours = ageMs / (60 * 60 * 1000)
  const freshnessScore = Math.exp(-ageHours / 24) * 10
  const sourceWeight = getSourceWeight(article.source_name)
  const contentQualityBonus = getContentQualityBonus(article)
  const mediaQualityBonus = getMediaQualityBonus(article)
  const importance = getStoryImportance(article, storySourceCounts)
  const interest =
    editorialScore * 1.0 +
    freshnessScore * 2.0 +
    importance.importanceScore * INTEREST_IMPORTANCE_WEIGHT +
    sourceWeight +
    contentQualityBonus +
    mediaQualityBonus

  return {
    article,
    interest,
    components: {
      editorialScore,
      freshnessScore,
      importanceScore: importance.importanceScore,
      sourceWeight,
      contentQualityBonus,
      mediaQualityBonus,
      importance,
    },
  }
}

export function rankInterestingArticles(
  candidates: Article[],
  options: RankInterestingArticlesOptions = {},
): RankedInterestArticle[] {
  const limit = options.limit ?? 4
  const minItems = options.minItems ?? 3
  const excluded = new Set(options.excludeIds ?? [])
  const now = options.now ?? new Date()
  const visible = candidates.filter((article) => !excluded.has(article.id))
  const storySourceCounts = buildStorySourceCounts(visible)
  const ranked = visible
    .map((article) => scoreInterestingArticle(article, now, storySourceCounts))
    .sort((a, b) => {
      const interestDiff = b.interest - a.interest
      if (interestDiff !== 0) return interestDiff
      return compareArticlesByFreshness(a.article, b.article)
    })

  const selected: RankedInterestArticle[] = []
  const sourceCounts = new Map<string, number>()

  for (const candidate of ranked) {
    const sourceCount = sourceCounts.get(candidate.article.source_name) ?? 0
    if (sourceCount > 0) continue

    selected.push(candidate)
    sourceCounts.set(candidate.article.source_name, sourceCount + 1)
    if (selected.length >= limit) break
  }

  if (selected.length < limit) {
    for (const candidate of ranked) {
      if (selected.some((item) => item.article.id === candidate.article.id)) continue

      const sourceCount = sourceCounts.get(candidate.article.source_name) ?? 0
      if (sourceCount >= 2) continue

      selected.push(candidate)
      sourceCounts.set(candidate.article.source_name, sourceCount + 1)
      if (selected.length >= limit) break
    }
  }

  return selected.length >= minItems ? selected : []
}

export function rankInterestingArticlesWithFallback(
  primaryCandidates: Article[],
  fallbackCandidates: Article[],
  options: RankInterestingArticlesOptions = {},
): RankedInterestArticle[] {
  const minItems = options.minItems ?? 3
  const primaryRanked = rankInterestingArticles(primaryCandidates, options)
  if (primaryRanked.length >= minItems) return primaryRanked

  return rankInterestingArticles(fallbackCandidates, options)
}

export function scoreArticleRecommendation(
  current: Article,
  candidate: Article,
  now = new Date(),
  storySourceCounts?: Map<string, number>,
): RankedRecommendationArticle {
  const editorialScore = clamp(Number(candidate.score ?? 0), 0, 10)
  const ageMs = Math.max(0, now.getTime() - freshnessTimestamp(candidate))
  const ageHours = ageMs / (60 * 60 * 1000)
  const freshnessScore = Math.exp(-ageHours / 48) * 10
  const sourceWeight = getSourceWeight(candidate.source_name)
  const contentQualityBonus = getContentQualityBonus(candidate)
  const mediaQualityBonus = getMediaQualityBonus(candidate)
  const importance = getStoryImportance(candidate, storySourceCounts)
  const { samePrimaryCategory, relevanceScore } = getRecommendationRelevance(current, candidate)
  const recommendation =
    relevanceScore * 4.0 +
    freshnessScore * 2.4 +
    editorialScore * 0.9 +
    importance.importanceScore * RECOMMENDATION_IMPORTANCE_WEIGHT +
    sourceWeight +
    contentQualityBonus +
    mediaQualityBonus

  return {
    article: candidate,
    recommendation,
    components: {
      samePrimaryCategory,
      relevanceScore,
      editorialScore,
      freshnessScore,
      importanceScore: importance.importanceScore,
      sourceWeight,
      contentQualityBonus,
      mediaQualityBonus,
      importance,
    },
  }
}

export function rankArticleRecommendations(
  current: Article,
  candidates: Article[],
  options: RankInterestingArticlesOptions = {},
): RankedRecommendationArticle[] {
  const limit = options.limit ?? 3
  const minItems = options.minItems ?? 3
  const excluded = new Set([current.id, ...(options.excludeIds ?? [])])
  const now = options.now ?? new Date()
  const visible = candidates.filter((article) => !excluded.has(article.id))
  const storySourceCounts = buildStorySourceCounts(visible)
  const ranked = visible
    .map((article) => scoreArticleRecommendation(current, article, now, storySourceCounts))
    .sort((a, b) => {
      const primaryDiff = Number(b.components.samePrimaryCategory) - Number(a.components.samePrimaryCategory)
      if (primaryDiff !== 0) return primaryDiff

      const relevanceDiff = b.components.relevanceScore - a.components.relevanceScore
      if (relevanceDiff !== 0) return relevanceDiff

      const recommendationDiff = b.recommendation - a.recommendation
      if (recommendationDiff !== 0) return recommendationDiff

      return compareArticlesByFreshness(a.article, b.article)
    })

  const selected: RankedRecommendationArticle[] = []
  const sourceCounts = new Map<string, number>()

  for (const candidate of ranked) {
    const sourceCount = sourceCounts.get(candidate.article.source_name) ?? 0
    if (sourceCount > 0) continue

    selected.push(candidate)
    sourceCounts.set(candidate.article.source_name, sourceCount + 1)
    if (selected.length >= limit) break
  }

  if (selected.length < limit) {
    for (const candidate of ranked) {
      if (selected.some((item) => item.article.id === candidate.article.id)) continue

      const sourceCount = sourceCounts.get(candidate.article.source_name) ?? 0
      if (sourceCount >= 2) continue

      selected.push(candidate)
      sourceCounts.set(candidate.article.source_name, sourceCount + 1)
      if (selected.length >= limit) break
    }
  }

  return selected.length >= minItems ? selected : []
}
