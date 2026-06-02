import {
  buildStorySourceCounts,
  deriveDigestStory,
  extractNumericAnchors,
  getStoryImportance,
} from '../lib/story-signal'
import type {
  DigestEventType,
  DigestSelectionArticle,
  DigestStory,
} from '../lib/story-signal'

export { deriveDigestStory, extractNumericAnchors }
export type { DigestEventType, DigestSelectionArticle, DigestStory }

// Вклад importance в порядок отбора дайджеста. Внутри окна «вчера по МСК» свежесть почти не
// различает кандидатов (все за один день), поэтому ранжируем по editorial score + важность
// истории. Вес подобран так, чтобы крупная мульти-источниковая история (раунд/релиз известной
// лабы) поднималась к топу и получала слот, но не полностью топила editorial score.
const DIGEST_IMPORTANCE_WEIGHT = 0.5

function digestSortScore(article: DigestSelectionArticle, storySourceCounts: Map<string, number>): number {
  const editorialScore = Number(article.score ?? 0)
  const importance = getStoryImportance(article, storySourceCounts)
  return editorialScore + DIGEST_IMPORTANCE_WEIGHT * importance.importanceScore
}

function pubDateMs(value: string | null | undefined): number {
  if (!value) return 0
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : 0
}

// Детерминированно переупорядочивает кандидатов по композиту editorial score + importance
// ПЕРЕД selectDigestArticles. Сами caps/дедуп (per-source, per-entity, storyKey) не трогаются —
// importance лишь решает, какие сюжеты борются за слоты первыми.
export function rankDigestCandidates<T extends DigestSelectionArticle>(candidates: T[]): T[] {
  const storySourceCounts = buildStorySourceCounts(candidates)
  return [...candidates].sort((a, b) => {
    const scoreDiff = digestSortScore(b, storySourceCounts) - digestSortScore(a, storySourceCounts)
    if (scoreDiff !== 0) return scoreDiff

    const rawScoreDiff = Number(b.score ?? 0) - Number(a.score ?? 0)
    if (rawScoreDiff !== 0) return rawScoreDiff

    const dateDiff = pubDateMs(b.pub_date) - pubDateMs(a.pub_date)
    if (dateDiff !== 0) return dateDiff

    return String(b.id).localeCompare(String(a.id))
  })
}

export interface DigestSelectionSkipped {
  articleId: string
  title: string
  sourceName: string
  reason: 'source_cap' | 'duplicate_story' | 'recent_story_duplicate' | 'primary_entity_cap'
  storyKey: string | null
  primaryEntity: string | null
}

export interface DigestSelectionDiagnostics {
  candidateCount: number
  recentMemoryCount: number
  selectedCount: number
  sourceDistribution: Record<string, number>
  primaryEntityDistribution: Record<string, number>
  storyKeys: string[]
  skipped: DigestSelectionSkipped[]
}

interface DigestSelectionOptions {
  target?: number
  perSourceCap?: number
  perPrimaryEntityCap?: number
}

function increment(map: Map<string, number>, key: string): void {
  map.set(key, (map.get(key) ?? 0) + 1)
}

function mapToRecord(map: Map<string, number>): Record<string, number> {
  return Object.fromEntries([...map.entries()].sort(([a], [b]) => a.localeCompare(b)))
}

export function validateDigestComposition(articles: DigestSelectionArticle[]): {
  ok: boolean
  duplicateStoryKeys: string[]
  sourceDistribution: Record<string, number>
  primaryEntityDistribution: Record<string, number>
} {
  const storyCounts = new Map<string, number>()
  const sourceCounts = new Map<string, number>()
  const entityCounts = new Map<string, number>()

  for (const article of articles) {
    increment(sourceCounts, article.source_name)
    const story = deriveDigestStory(article)
    if (story.storyKey) increment(storyCounts, story.storyKey)
    if (story.primaryEntity) increment(entityCounts, story.primaryEntity)
  }

  const duplicateStoryKeys = [...storyCounts.entries()]
    .filter(([, count]) => count > 1)
    .map(([key]) => key)

  return {
    ok: duplicateStoryKeys.length === 0,
    duplicateStoryKeys,
    sourceDistribution: mapToRecord(sourceCounts),
    primaryEntityDistribution: mapToRecord(entityCounts),
  }
}

export function selectDigestArticles<T extends DigestSelectionArticle>(
  candidates: T[],
  recentSentArticles: DigestSelectionArticle[] = [],
  options: DigestSelectionOptions = {},
): { articles: T[]; diagnostics: DigestSelectionDiagnostics } {
  const target = options.target ?? 5
  const perSourceCap = options.perSourceCap ?? 2
  const perPrimaryEntityCap = options.perPrimaryEntityCap ?? 2

  const selected: T[] = []
  const skipped: DigestSelectionSkipped[] = []
  const sourceCounts = new Map<string, number>()
  const entityCounts = new Map<string, number>()
  const selectedStoryKeys = new Set<string>()
  const recentStoryKeys = new Set(
    recentSentArticles
      .map((article) => deriveDigestStory(article))
      .filter((story) => story.strong && story.storyKey)
      .map((story) => story.storyKey as string),
  )

  for (const article of candidates) {
    if (selected.length >= target) break

    const story = deriveDigestStory(article)
    const sourceCount = sourceCounts.get(article.source_name) ?? 0
    if (sourceCount >= perSourceCap) {
      skipped.push(skippedEntry(article, 'source_cap', story))
      continue
    }

    if (story.storyKey && selectedStoryKeys.has(story.storyKey)) {
      skipped.push(skippedEntry(article, 'duplicate_story', story))
      continue
    }

    if (story.storyKey && recentStoryKeys.has(story.storyKey)) {
      skipped.push(skippedEntry(article, 'recent_story_duplicate', story))
      continue
    }

    const entityCount = story.primaryEntity ? (entityCounts.get(story.primaryEntity) ?? 0) : 0
    if (story.primaryEntity && entityCount >= perPrimaryEntityCap) {
      skipped.push(skippedEntry(article, 'primary_entity_cap', story))
      continue
    }

    selected.push(article)
    increment(sourceCounts, article.source_name)
    if (story.primaryEntity) increment(entityCounts, story.primaryEntity)
    if (story.storyKey) selectedStoryKeys.add(story.storyKey)
  }

  return {
    articles: selected,
    diagnostics: {
      candidateCount: candidates.length,
      recentMemoryCount: recentStoryKeys.size,
      selectedCount: selected.length,
      sourceDistribution: mapToRecord(sourceCounts),
      primaryEntityDistribution: mapToRecord(entityCounts),
      storyKeys: [...selectedStoryKeys].sort(),
      skipped,
    },
  }
}

function skippedEntry(
  article: DigestSelectionArticle,
  reason: DigestSelectionSkipped['reason'],
  story: DigestStory,
): DigestSelectionSkipped {
  return {
    articleId: article.id,
    title: article.ru_title ?? article.original_title,
    sourceName: article.source_name,
    reason,
    storyKey: story.storyKey,
    primaryEntity: story.primaryEntity,
  }
}
