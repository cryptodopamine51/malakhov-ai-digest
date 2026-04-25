/**
 * lib/categories.ts
 *
 * Канонический список slug-ов категорий и хелперы для маппинга legacy topics[]
 * в новую модель primary_category + secondary_categories (волна 2.1).
 *
 * Slug-и должны совпадать с записями в таблице `categories` (миграция 013).
 * Source of truth по доменной модели — docs/ARTICLE_SYSTEM.md.
 */

export const CATEGORY_SLUGS = [
  'ai-industry',
  'ai-research',
  'ai-labs',
  'ai-investments',
  'ai-startups',
  'ai-russia',
  'coding',
] as const

export type CategorySlug = (typeof CATEGORY_SLUGS)[number]

export const DEFAULT_CATEGORY: CategorySlug = 'ai-industry'

const CATEGORY_SET = new Set<string>(CATEGORY_SLUGS)

export function isKnownCategory(slug: string | null | undefined): slug is CategorySlug {
  return typeof slug === 'string' && CATEGORY_SET.has(slug)
}

/**
 * Распилить legacy `topics[]` на основной + до двух смежных категорий.
 * Неизвестные topic-и игнорируются. Если ни один topic не известен —
 * primary падает в DEFAULT_CATEGORY (`ai-industry`), secondary остаются пустыми.
 */
export function splitTopicsToCategories(
  topics: readonly string[] | null | undefined
): { primary: CategorySlug; secondary: CategorySlug[] } {
  const seen = new Set<string>()
  const known: CategorySlug[] = []

  for (const t of topics ?? []) {
    if (typeof t !== 'string') continue
    if (seen.has(t)) continue
    if (!isKnownCategory(t)) continue
    seen.add(t)
    known.push(t)
  }

  if (known.length === 0) {
    return { primary: DEFAULT_CATEGORY, secondary: [] }
  }

  return { primary: known[0], secondary: known.slice(1, 3) }
}
