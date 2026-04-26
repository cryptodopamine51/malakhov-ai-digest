import type { Article } from '../lib/supabase'

export const DEFAULT_MIN_SCORE_FOR_CLAUDE = 2

export const CATEGORY_MIN_SCORE_FOR_CLAUDE: Partial<Record<string, number>> = {
  'ai-research': 4,
}

export function getArticleCategories(article: Pick<Article, 'primary_category' | 'secondary_categories' | 'topics'>): string[] {
  return [
    article.primary_category,
    ...(article.secondary_categories ?? []),
    ...(article.topics ?? []),
  ].filter((category): category is string => typeof category === 'string' && category.length > 0)
}

export function articleHasCategory(
  article: Pick<Article, 'primary_category' | 'secondary_categories' | 'topics'>,
  category: string,
): boolean {
  return getArticleCategories(article).includes(category)
}

export function getMinScoreForArticle(
  article: Pick<Article, 'primary_category' | 'secondary_categories' | 'topics'>,
): number {
  const categories = getArticleCategories(article)
  const thresholds = categories
    .map((category) => CATEGORY_MIN_SCORE_FOR_CLAUDE[category])
    .filter((score): score is number => typeof score === 'number')

  return thresholds.length > 0 ? Math.max(...thresholds) : DEFAULT_MIN_SCORE_FOR_CLAUDE
}
