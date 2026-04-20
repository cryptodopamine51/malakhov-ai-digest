/**
 * lib/articles.ts
 *
 * Запросы к Supabase для страниц сайта.
 * Все публичные выборки фильтруют quality_ok=true.
 */

import { getBrowserClient, getServerClient, type Article } from './supabase'

function client() {
  if (typeof window === 'undefined') {
    try {
      return getServerClient()
    } catch {
      // Keep server rendering alive even if Vercel env is missing the service key.
    }
  }

  return getBrowserClient()
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
  const { data, error } = await client()
    .from('articles')
    .select('*')
    .eq('slug', slug)
    .eq('published', true)
    .eq('quality_ok', true)
    .maybeSingle()

  if (error) {
    console.error('getArticleBySlug error:', error.message)
    return null
  }

  return (data as Article | null)
}

export async function getArticlesByTopic(topic: string, limit = 20): Promise<Article[]> {
  const { data, error } = await client()
    .from('articles')
    .select('*')
    .eq('published', true)
    .eq('quality_ok', true)
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
    .not('slug', 'is', null)
    .order('created_at', { ascending: false })

  if (error) {
    console.error('getAllSlugs error:', error.message)
    return []
  }

  return (data ?? [])
    .map((row: { slug: string | null }) => row.slug)
    .filter((s): s is string => s !== null)
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

function freshnessMultiplier(createdAt: string): number {
  const ageHours = (Date.now() - new Date(createdAt).getTime()) / 3_600_000
  if (ageHours < 24) return 1.0
  if (ageHours < 48) return 0.8
  if (ageHours < 72) return 0.6
  return 0.4
}

export async function getArticlesFeed(page = 1, perPage = 12): Promise<{ articles: Article[]; total: number }> {
  const POOL = 120

  const { data, error } = await client()
    .from('articles')
    .select('*')
    .eq('published', true)
    .eq('quality_ok', true)
    .order('score', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(POOL)

  if (error) {
    console.error('getArticlesFeed error:', error.message)
    return { articles: [], total: 0 }
  }

  const pool = (data ?? []) as Article[]

  const sorted = [...pool].sort(
    (a, b) =>
      b.score * freshnessMultiplier(b.created_at) -
      a.score * freshnessMultiplier(a.created_at)
  )

  const offset = (page - 1) * perPage
  return {
    articles: sorted.slice(offset, offset + perPage),
    // Cap to pool size so pagination never shows phantom empty pages
    total: pool.length,
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
      .not('pub_date', 'is', null)
      .gte('pub_date', start)
      .lte('pub_date', end)
      .order('score', { ascending: false }),
    client()
      .from('articles')
      .select('*')
      .eq('published', true)
      .eq('quality_ok', true)
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
      slug: data![0].slug as string,
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
    .not('slug', 'is', null)
    .order('updated_at', { ascending: false })

  if (error) {
    console.error('getAllArticlesForSitemap error:', error.message)
    return []
  }

  return (data ?? []).filter(
    (row): row is { slug: string; updated_at: string } =>
      row.slug !== null
  )
}
