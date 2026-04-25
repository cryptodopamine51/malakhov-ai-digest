/**
 * lib/articles.ts
 *
 * Запросы к Supabase для страниц сайта.
 * Все публичные выборки фильтруют quality_ok=true.
 */

import { getPublicReadClient, type Article } from './supabase'
import { toPublicArticleSlug } from './article-slugs'

function client() {
  return getPublicReadClient()
}

const MOSCOW_TZ = 'Europe/Moscow'

function getMoscowDateKey(date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: MOSCOW_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)

  const year = parts.find((part) => part.type === 'year')?.value
  const month = parts.find((part) => part.type === 'month')?.value
  const day = parts.find((part) => part.type === 'day')?.value

  return `${year}-${month}-${day}`
}

export async function getLatestArticles(limit = 20): Promise<Article[]> {
  const { data, error } = await client()
    .from('articles')
    .select('*')
    .eq('published', true)
    .eq('quality_ok', true)
    .eq('verified_live', true)
    .eq('publish_status', 'live')
    .order('score', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) {
    console.error('getLatestArticles error:', error.message)
    return []
  }

  return (data ?? []) as Article[]
}

export async function getArticleBySlug(slug: string): Promise<Article | null> {
  const liveArticleQuery = () => client()
    .from('articles')
    .select('*')
    .eq('published', true)
    .eq('quality_ok', true)
    .eq('verified_live', true)
    .eq('publish_status', 'live')

  const { data, error } = await liveArticleQuery()
    .eq('slug', slug)
    .maybeSingle()

  if (error) {
    console.error('getArticleBySlug error:', error.message)
    return null
  }

  if (data) return data as Article

  const publicSlug = toPublicArticleSlug(slug)
  if (publicSlug !== slug) {
    const { data: strippedMatch, error: strippedError } = await liveArticleQuery()
      .eq('slug', publicSlug)
      .maybeSingle()

    if (strippedError) {
      console.error('getArticleBySlug stripped error:', strippedError.message)
      return null
    }

    if (strippedMatch) return strippedMatch as Article
  }

  const { data: prefixed, error: prefixError } = await liveArticleQuery()
    .like('slug', `${publicSlug}%`)
    .limit(12)

  if (prefixError) {
    console.error('getArticleBySlug prefix error:', prefixError.message)
    return null
  }

  const matches = ((prefixed ?? []) as Article[]).filter((article) =>
    article.slug ? toPublicArticleSlug(article.slug) === publicSlug : false
  )

  return matches.length === 1 ? matches[0] : null
}

export async function getArticlesByTopic(topic: string, limit = 20): Promise<Article[]> {
  const { data, error } = await client()
    .from('articles')
    .select('*')
    .eq('published', true)
    .eq('quality_ok', true)
    .eq('verified_live', true)
    .eq('publish_status', 'live')
    .contains('topics', [topic])
    .order('score', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) {
    console.error('getArticlesByTopic error:', error.message)
    return []
  }

  return (data ?? []) as Article[]
}

export async function getRussiaArticles(limit = 20): Promise<Article[]> {
  return getArticlesByTopic('ai-russia', limit)
}

export async function getAllSlugs(): Promise<string[]> {
  const { data, error } = await client()
    .from('articles')
    .select('slug')
    .eq('published', true)
    .eq('quality_ok', true)
    .eq('verified_live', true)
    .eq('publish_status', 'live')
    .not('slug', 'is', null)
    .order('created_at', { ascending: false })

  if (error) {
    console.error('getAllSlugs error:', error.message)
    return []
  }

  return (data ?? [])
    .map((row: { slug: string | null }) => row.slug)
    .filter((s): s is string => s !== null)
    .map((slug) => toPublicArticleSlug(slug))
    .filter((slug, index, arr) => arr.indexOf(slug) === index)
}

export async function getTopTodayArticles(limit = 7): Promise<Article[]> {
  const moscowToday = getMoscowDateKey()
  const since = new Date(`${moscowToday}T00:00:00+03:00`).toISOString()
  const until = new Date(`${moscowToday}T23:59:59.999+03:00`).toISOString()

  const { data, error } = await client()
    .from('articles')
    .select('*')
    .eq('published', true)
    .eq('quality_ok', true)
    .eq('verified_live', true)
    .eq('publish_status', 'live')
    .gte('created_at', since)
    .lte('created_at', until)
    .order('score', { ascending: false })
    .limit(limit)

  if (error) {
    console.error('getTopTodayArticles error:', error.message)
    return []
  }

  return (data ?? []) as Article[]
}

/**
 * Свежие заголовки для левой колонки VC-блока на главной — чисто хронологически.
 * Используется отдельно от `getLatestArticles`, который сортирует по score.
 */
export async function getRecentHeadlines(limit = 8, excludeIds: string[] = []): Promise<Article[]> {
  let query = client()
    .from('articles')
    .select('*')
    .eq('published', true)
    .eq('quality_ok', true)
    .eq('verified_live', true)
    .eq('publish_status', 'live')
    .order('created_at', { ascending: false })
    .limit(limit)

  if (excludeIds.length) query = query.not('id', 'in', `(${excludeIds.join(',')})`)

  const { data, error } = await query

  if (error) {
    console.error('getRecentHeadlines error:', error.message)
    return []
  }

  return (data ?? []) as Article[]
}

/**
 * "Горячая статья дня" для верхнего блока главной (VC-style).
 *
 * Логика (из docs/spec_2026_04_25_site_improvements.md, волна 1, задача 1.2):
 * 1. Кандидат — самая высоко оценённая статья за последние 24 часа из живых.
 * 2. Если её score дотягивает до порога — возвращаем её.
 * 3. Иначе — самая свежая опубликованная вне зависимости от окна.
 *
 * Детерминирован: при тех же входных данных два последовательных вызова дают тот же id.
 * Тай-брейкер по `created_at desc` гарантирует стабильный порядок при равных score.
 */
export async function getHotStoryOfTheDay(
  scoreThreshold = 5,
  excludeIds: string[] = []
): Promise<Article | null> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const supabase = client()

  let query = supabase
    .from('articles')
    .select('*')
    .eq('published', true)
    .eq('quality_ok', true)
    .eq('verified_live', true)
    .eq('publish_status', 'live')
    .gte('created_at', since)
    .order('score', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(1)

  if (excludeIds.length) query = query.not('id', 'in', `(${excludeIds.join(',')})`)

  const { data: hot, error } = await query.maybeSingle()

  if (error) {
    console.error('getHotStoryOfTheDay error:', error.message)
    return null
  }

  if (hot && (hot as Article).score >= scoreThreshold) return hot as Article

  let fallback = supabase
    .from('articles')
    .select('*')
    .eq('published', true)
    .eq('quality_ok', true)
    .eq('verified_live', true)
    .eq('publish_status', 'live')
    .order('created_at', { ascending: false })
    .limit(1)

  if (excludeIds.length) fallback = fallback.not('id', 'in', `(${excludeIds.join(',')})`)

  const { data: latest, error: latestError } = await fallback.maybeSingle()

  if (latestError) {
    console.error('getHotStoryOfTheDay fallback error:', latestError.message)
    return null
  }

  return (latest as Article) ?? null
}

export async function getArticlesFeed(page = 1, perPage = 12): Promise<{ articles: Article[]; total: number }> {
  const supabase = client()
  const offset = (page - 1) * perPage

  const [{ count: total }, { data, error }] = await Promise.all([
    supabase
      .from('articles')
      .select('*', { count: 'exact', head: true })
      .eq('published', true)
      .eq('quality_ok', true)
      .eq('verified_live', true)
      .eq('publish_status', 'live'),
    supabase
      .from('articles')
      .select('*')
      .eq('published', true)
      .eq('quality_ok', true)
      .eq('verified_live', true)
      .eq('publish_status', 'live')
      .order('score', { ascending: false })
      .order('created_at', { ascending: false })
      .range(offset, offset + perPage - 1),
  ])

  if (error) {
    console.error('getArticlesFeed error:', error.message)
    return { articles: [], total: 0 }
  }

  return {
    articles: (data ?? []) as Article[],
    total: total ?? 0,
  }
}

export async function getRelatedArticles(
  topics: string[],
  excludeId: string,
  limit = 3
): Promise<Article[]> {
  if (!topics.length) return []

  const { data, error } = await client()
    .from('articles')
    .select('*')
    .eq('published', true)
    .eq('quality_ok', true)
    .eq('verified_live', true)
    .eq('publish_status', 'live')
    .contains('topics', [topics[0]])
    .neq('id', excludeId)
    .order('score', { ascending: false })
    .limit(limit)

  if (error) {
    console.error('getRelatedArticles error:', error.message)
    return []
  }

  return (data ?? []) as Article[]
}

export async function getSourcesStats(): Promise<
  { source_name: string; count: number; latest_titles: string[] }[]
> {
  const { data, error } = await client()
    .from('articles')
    .select('source_name, ru_title, original_title, created_at')
    .eq('published', true)
    .eq('quality_ok', true)
    .eq('verified_live', true)
    .eq('publish_status', 'live')
    .order('created_at', { ascending: false })
    .limit(1000)

  if (error) {
    console.error('getSourcesStats error:', error.message)
    return []
  }

  const map = new Map<string, { count: number; titles: string[] }>()
  for (const row of data ?? []) {
    const name = row.source_name as string
    const title = (row.ru_title ?? row.original_title ?? '') as string
    if (!map.has(name)) map.set(name, { count: 0, titles: [] })
    const entry = map.get(name)!
    entry.count++
    if (entry.titles.length < 2) entry.titles.push(title)
  }

  return Array.from(map.entries())
    .map(([source_name, { count, titles }]) => ({ source_name, count, latest_titles: titles }))
    .sort((a, b) => b.count - a.count)
}

export async function getArticlesBySource(sourceName: string, limit = 20, offset = 0): Promise<Article[]> {
  const { data, error } = await client()
    .from('articles')
    .select('*')
    .eq('published', true)
    .eq('quality_ok', true)
    .eq('verified_live', true)
    .eq('publish_status', 'live')
    .eq('source_name', sourceName)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (error) {
    console.error('getArticlesBySource error:', error.message)
    return []
  }

  return (data ?? []) as Article[]
}

export async function getArticlesByDate(date: string): Promise<Article[]> {
  const start = new Date(date + 'T00:00:00+03:00').toISOString()
  const end = new Date(date + 'T23:59:59+03:00').toISOString()

  // Try pub_date first; fall back to created_at for articles where pub_date is null
  const [{ data: byPubDate }, { data: byCreatedAt }] = await Promise.all([
    client()
      .from('articles')
      .select('*')
      .eq('published', true)
      .eq('quality_ok', true)
      .eq('verified_live', true)
      .eq('publish_status', 'live')
      .not('pub_date', 'is', null)
      .gte('pub_date', start)
      .lte('pub_date', end)
      .order('score', { ascending: false }),
    client()
      .from('articles')
      .select('*')
      .eq('published', true)
      .eq('quality_ok', true)
      .eq('verified_live', true)
      .eq('publish_status', 'live')
      .is('pub_date', null)
      .gte('created_at', start)
      .lte('created_at', end)
      .order('score', { ascending: false }),
  ])

  const seen = new Set<string>()
  const merged: Article[] = []
  for (const a of [...(byPubDate ?? []), ...(byCreatedAt ?? [])] as Article[]) {
    if (!seen.has(a.id)) { seen.add(a.id); merged.push(a) }
  }

  return merged.sort((a, b) => b.score - a.score)
}

export async function resolveAnchorLinks(
  anchors: string[],
  excludeId: string
): Promise<{ anchor: string; slug: string; title: string }[]> {
  if (!anchors.length) return []

  const queries = anchors.slice(0, 3).map((anchor) => {
    const searchTerm = anchor.toLowerCase().split(/\s+/).slice(0, 4).join(' ')
    return client()
      .from('articles')
      .select('slug, ru_title, original_title')
      .eq('published', true)
      .eq('quality_ok', true)
      .eq('verified_live', true)
      .eq('publish_status', 'live')
      .neq('id', excludeId)
      .ilike('ru_title', `%${searchTerm}%`)
      .limit(1)
      .then(({ data }) => ({ anchor, data }))
  })

  const results = await Promise.all(queries)

  return results
    .filter(({ data }) => data && data.length > 0 && data[0].slug)
    .map(({ anchor, data }) => ({
      anchor,
      slug: toPublicArticleSlug(data![0].slug as string),
      title: (data![0].ru_title ?? data![0].original_title ?? '') as string,
    }))
}

export function sourceNameToSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-zа-яё0-9\s-]/gi, '')
    .trim()
    .replace(/\s+/g, '-')
}

export async function getAllSourceSlugs(): Promise<{ source: string }[]> {
  const stats = await getSourcesStats()
  return stats.map((s) => ({ source: sourceNameToSlug(s.source_name) }))
}

export async function getSourceNameBySlug(slug: string): Promise<string | null> {
  const stats = await getSourcesStats()
  const match = stats.find((s) => sourceNameToSlug(s.source_name) === slug)
  return match?.source_name ?? null
}

export async function getAllArticlesForSitemap(): Promise<{ slug: string; updated_at: string }[]> {
  const { data, error } = await client()
    .from('articles')
    .select('slug, updated_at')
    .eq('published', true)
    .eq('quality_ok', true)
    .eq('verified_live', true)
    .eq('publish_status', 'live')
    .not('slug', 'is', null)
    .order('updated_at', { ascending: false })

  if (error) {
    console.error('getAllArticlesForSitemap error:', error.message)
    return []
  }

  const unique = new Map<string, string>()

  for (const row of data ?? []) {
    if (!row.slug) continue
    const publicSlug = toPublicArticleSlug(row.slug)
    if (!unique.has(publicSlug)) {
      unique.set(publicSlug, row.updated_at)
    }
  }

  return Array.from(unique.entries()).map(([slug, updated_at]) => ({ slug, updated_at }))
}
