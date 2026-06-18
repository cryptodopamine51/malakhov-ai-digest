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

export interface ArticleCategoryResolutionInput {
  topics: readonly string[] | null | undefined
  title?: string | null
  snippet?: string | null
}

export interface ArticleCategoryResolution {
  primary: CategorySlug
  secondary: CategorySlug[]
  topics: CategorySlug[]
}

export function isKnownCategory(slug: string | null | undefined): slug is CategorySlug {
  return typeof slug === 'string' && CATEGORY_SET.has(slug)
}

const RUSSIA_MARKET_SIGNAL_PATTERNS: RegExp[] = [
  boundaryPattern([
    'россия',
    'россии',
    'россию',
    'россией',
    'россиян[\\p{L}\\p{M}]*',
    'рф',
    'российск[\\p{L}\\p{M}]*',
    'отечественн[\\p{L}\\p{M}]*',
  ]),
  boundaryPattern([
    'минцифры',
    'роскомнадзор',
    'госдума',
    'правительство\\s+рф',
    'цб\\s+рф',
    'центробанк',
    'сколково',
    'сколтех',
    'иннополис',
  ]),
  boundaryPattern([
    'антиплагиат',
    'авито',
    'avito',
    'билайн',
    'beeline',
    'вконтакте',
    'втб',
    'vtb',
    'выберу\\.ру',
    'cloud\\.ru',
    'гостех',
    'итмо',
    'itmo',
    'itglobal\\.com',
    'консорциум\\s+больших\\s+данных',
    'ланит',
    'мегафон',
    'megafon',
    'мтс',
    'mts',
    'озон',
    'ozon',
    'первый\\s+бит',
    'псм',
    'psm',
    'самокат',
    'сбер(?:банк)?',
    'sber',
    'синимекс',
    'согласие',
    'т-банк',
    't-bank',
    'тинькофф',
    'честный\\s+знак',
    'юmoney',
    'юмани',
    'yoomoney',
    'x5',
    'gigachat',
    'giga\\s?chat',
    'ispring',
    'яндекс(?:gpt)?',
    'yandex(?:gpt)?',
    'vk',
    'pix\\s+robotics',
    'retailiqa',
    'russ',
    'tantor',
    'wildberries',
  ]),
]

function boundaryPattern(tokens: string[]): RegExp {
  return new RegExp(`(^|[^\\p{L}\\p{N}])(?:${tokens.join('|')})(?=$|[^\\p{L}\\p{N}])`, 'iu')
}

function normalizeSignalText(text: string): string {
  return text
    .normalize('NFKC')
    .replace(/ё/g, 'е')
    .replace(/Ё/g, 'Е')
    .toLowerCase()
}

export function hasRussiaMarketSignal(text: string | null | undefined): boolean {
  if (!text) return false
  const normalized = normalizeSignalText(text)
  return RUSSIA_MARKET_SIGNAL_PATTERNS.some((pattern) => pattern.test(normalized))
}

function knownUniqueTopics(topics: readonly string[] | null | undefined): CategorySlug[] {
  const seen = new Set<string>()
  const known: CategorySlug[] = []

  for (const t of topics ?? []) {
    if (typeof t !== 'string') continue
    if (seen.has(t)) continue
    if (!isKnownCategory(t)) continue
    seen.add(t)
    known.push(t)
  }

  return known
}

/**
 * Распилить legacy `topics[]` на основной + до двух смежных категорий.
 * Неизвестные topic-и игнорируются. Если ни один topic не известен —
 * primary падает в DEFAULT_CATEGORY (`ai-industry`), secondary остаются пустыми.
 */
export function splitTopicsToCategories(
  topics: readonly string[] | null | undefined
): { primary: CategorySlug; secondary: CategorySlug[] } {
  const known = knownUniqueTopics(topics)

  if (known.length === 0) {
    return { primary: DEFAULT_CATEGORY, secondary: [] }
  }

  return { primary: known[0], secondary: known.slice(1, 3) }
}

/**
 * Resolve feed-level topics into the canonical article category model.
 *
 * `ai-russia` is a content category, not a synonym for Russian-language sources.
 * Feed configs may still include it as a possible tag for Russian media, but
 * ingest keeps it only when the item itself has a Russia-market signal.
 */
export function resolveArticleCategories(
  input: ArticleCategoryResolutionInput,
): ArticleCategoryResolution {
  const text = [input.title, input.snippet]
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .join('\n')

  const hasRussiaSignal = hasRussiaMarketSignal(text)
  const topics = knownUniqueTopics(input.topics)
    .filter((topic) => topic !== 'ai-russia' || hasRussiaSignal)

  const { primary, secondary } = splitTopicsToCategories(topics)
  return { primary, secondary, topics: [primary, ...secondary] }
}
