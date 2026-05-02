import type { Article } from './supabase'
import { sanitizeArticleMedia } from './media-sanitizer'

export interface RankedInterestArticle {
  article: Article
  interest: number
  components: {
    editorialScore: number
    freshnessScore: number
    sourceWeight: number
    contentQualityBonus: number
    mediaQualityBonus: number
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
  const pub = timestamp(article.pub_date)
  const created = timestamp(article.created_at)
  if (pub !== null && created !== null) return Math.max(pub, created)
  return pub ?? created ?? 0
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

export function scoreInterestingArticle(article: Article, now = new Date()): RankedInterestArticle {
  const editorialScore = clamp(Number(article.score ?? 0), 0, 10)
  const ageMs = Math.max(0, now.getTime() - freshnessTimestamp(article))
  const ageHours = ageMs / (60 * 60 * 1000)
  const freshnessScore = Math.exp(-ageHours / 48) * 10
  const sourceWeight = getSourceWeight(article.source_name)
  const contentQualityBonus = getContentQualityBonus(article)
  const mediaQualityBonus = getMediaQualityBonus(article)
  const interest =
    editorialScore * 1.0 +
    freshnessScore * 3.0 +
    sourceWeight +
    contentQualityBonus +
    mediaQualityBonus

  return {
    article,
    interest,
    components: {
      editorialScore,
      freshnessScore,
      sourceWeight,
      contentQualityBonus,
      mediaQualityBonus,
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
  const ranked = candidates
    .filter((article) => !excluded.has(article.id))
    .map((article) => scoreInterestingArticle(article, now))
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
