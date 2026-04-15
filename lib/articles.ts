/**
 * lib/articles.ts
 *
 * Запросы к Supabase для страниц сайта.
 * Все функции используют serverClient (SUPABASE_SERVICE_KEY).
 */

import { getBrowserClient, type Article } from './supabase'

// ── Вспомогательная функция ───────────────────────────────────────────────────
// Сайт только читает публичные данные — anon-ключ достаточен.
// SERVICE_KEY остаётся только в pipeline-скриптах (ingest, enrich, tg-digest).

function client() {
  return getBrowserClient()
}

// ── Запросы ───────────────────────────────────────────────────────────────────

/**
 * Последние N опубликованных статей для главной.
 * Сортировка: сначала по score, затем по дате создания.
 */
export async function getLatestArticles(limit = 20): Promise<Article[]> {
  const { data, error } = await client()
    .from('articles')
    .select('*')
    .eq('published', true)
    .order('score', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) {
    console.error('getLatestArticles error:', error.message)
    return []
  }

  return (data ?? []) as Article[]
}

/**
 * Статья по slug для страницы материала.
 */
export async function getArticleBySlug(slug: string): Promise<Article | null> {
  const { data, error } = await client()
    .from('articles')
    .select('*')
    .eq('slug', slug)
    .eq('published', true)
    .maybeSingle()

  if (error) {
    console.error('getArticleBySlug error:', error.message)
    return null
  }

  return (data as Article | null)
}

/**
 * Статьи по топику (фильтрация через PostgreSQL array contains).
 */
export async function getArticlesByTopic(topic: string, limit = 20): Promise<Article[]> {
  const { data, error } = await client()
    .from('articles')
    .select('*')
    .eq('published', true)
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

/**
 * Российские AI-новости.
 */
export async function getRussiaArticles(limit = 20): Promise<Article[]> {
  return getArticlesByTopic('ai-russia', limit)
}

/**
 * Все slug опубликованных статей — для generateStaticParams.
 */
export async function getAllSlugs(): Promise<string[]> {
  const { data, error } = await client()
    .from('articles')
    .select('slug')
    .eq('published', true)
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
