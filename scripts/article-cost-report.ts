import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { getServerClient } from '../lib/supabase'

const days = numberArg('days', Number(process.env.ARTICLE_COST_REPORT_DAYS ?? 2))
const limit = numberArg('limit', 40)
const slug = stringArg('slug', '')

interface UsageRow {
  article_id: string | null
  provider: string
  model: string
  operation: string
  input_tokens: number
  output_tokens: number
  cache_read_tokens: number
  cache_creation_tokens: number
  estimated_cost_usd: number
  created_at: string
}

interface ArticleRow {
  id: string
  slug: string | null
  ru_title: string | null
  original_title: string
  source_name: string
  primary_category: string | null
  cover_image_url: string | null
  created_at: string
}

interface Aggregate {
  articleId: string
  slug: string | null
  title: string
  source: string
  category: string | null
  createdAt: string
  hasCover: boolean
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheCreateTokens: number
  textCostUsd: number
  imageCostUsd: number
  totalCostUsd: number
  operations: Record<string, number>
}

function numberArg(name: string, fallback: number): number {
  const raw = process.argv.find((arg) => arg.startsWith(`--${name}=`))?.split('=').slice(1).join('=')
  const value = raw === undefined ? fallback : Number(raw)
  return Number.isFinite(value) && value > 0 ? value : fallback
}

function stringArg(name: string, fallback: string): string {
  return process.argv.find((arg) => arg.startsWith(`--${name}=`))?.split('=').slice(1).join('=') ?? fallback
}

function money(value: number): string {
  return `$${value.toFixed(4)}`
}

function roundUsd(value: number): number {
  return Number(value.toFixed(6))
}

function addOperation(target: Aggregate, operation: string, cost: number): void {
  target.operations[operation] = roundUsd((target.operations[operation] ?? 0) + cost)
}

async function main(): Promise<void> {
  const supabase = getServerClient()
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()

  let articleIdsForSlug: string[] | null = null
  if (slug) {
    const { data: matching, error: articleError } = await supabase
      .from('articles')
      .select('id')
      .eq('slug', slug)

    if (articleError) throw new Error(`article lookup failed: ${articleError.message}`)
    articleIdsForSlug = ((matching ?? []) as Array<{ id: string }>).map((row) => row.id)
    if (articleIdsForSlug.length === 0) {
      console.log(`No article found for slug=${slug}`)
      return
    }
  }

  let usageQuery = supabase
    .from('llm_usage_logs')
    .select('article_id, provider, model, operation, input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens, estimated_cost_usd, created_at')
    .not('article_id', 'is', null)
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(10_000)

  if (articleIdsForSlug) usageQuery = usageQuery.in('article_id', articleIdsForSlug)

  const { data: usageRows, error: usageError } = await usageQuery
  if (usageError) throw new Error(`llm_usage_logs query failed: ${usageError.message}`)

  const rows = (usageRows ?? []) as UsageRow[]
  const articleIds = Array.from(new Set(rows.map((row) => row.article_id).filter((id): id is string => Boolean(id))))
  if (articleIds.length === 0) {
    console.log(`No per-article usage rows in the last ${days} day(s)`)
    return
  }

  const { data: articles, error: articlesError } = await supabase
    .from('articles')
    .select('id, slug, ru_title, original_title, source_name, primary_category, cover_image_url, created_at')
    .in('id', articleIds)

  if (articlesError) throw new Error(`articles query failed: ${articlesError.message}`)

  const articleById = new Map(((articles ?? []) as ArticleRow[]).map((article) => [article.id, article]))
  const aggregates = new Map<string, Aggregate>()

  for (const row of rows) {
    if (!row.article_id) continue
    const article = articleById.get(row.article_id)
    const existing = aggregates.get(row.article_id) ?? {
      articleId: row.article_id,
      slug: article?.slug ?? null,
      title: article?.ru_title ?? article?.original_title ?? row.article_id,
      source: article?.source_name ?? 'unknown',
      category: article?.primary_category ?? null,
      createdAt: article?.created_at ?? row.created_at,
      hasCover: Boolean(article?.cover_image_url),
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheCreateTokens: 0,
      textCostUsd: 0,
      imageCostUsd: 0,
      totalCostUsd: 0,
      operations: {},
    }

    const cost = Number(row.estimated_cost_usd ?? 0)
    existing.inputTokens += Number(row.input_tokens ?? 0)
    existing.outputTokens += Number(row.output_tokens ?? 0)
    existing.cacheReadTokens += Number(row.cache_read_tokens ?? 0)
    existing.cacheCreateTokens += Number(row.cache_creation_tokens ?? 0)

    if (row.operation.includes('image') || row.provider === 'openai') {
      existing.imageCostUsd = roundUsd(existing.imageCostUsd + cost)
    } else {
      existing.textCostUsd = roundUsd(existing.textCostUsd + cost)
    }
    existing.totalCostUsd = roundUsd(existing.textCostUsd + existing.imageCostUsd)
    addOperation(existing, `${row.provider}:${row.operation}`, cost)
    aggregates.set(row.article_id, existing)
  }

  const list = Array.from(aggregates.values())
    .sort((a, b) => b.totalCostUsd - a.totalCostUsd || b.createdAt.localeCompare(a.createdAt))
    .slice(0, limit)

  const totals = list.reduce(
    (acc, row) => ({
      textCostUsd: roundUsd(acc.textCostUsd + row.textCostUsd),
      imageCostUsd: roundUsd(acc.imageCostUsd + row.imageCostUsd),
      totalCostUsd: roundUsd(acc.totalCostUsd + row.totalCostUsd),
    }),
    { textCostUsd: 0, imageCostUsd: 0, totalCostUsd: 0 },
  )

  console.log(`Article cost report: last ${days} day(s), rows=${list.length}`)
  console.log(`Totals: text=${money(totals.textCostUsd)} image=${money(totals.imageCostUsd)} total=${money(totals.totalCostUsd)}`)
  console.log('')

  for (const row of list) {
    console.log(`${money(row.totalCostUsd)} | text=${money(row.textCostUsd)} image=${money(row.imageCostUsd)} | in=${row.inputTokens} out=${row.outputTokens} | ${row.slug ?? row.articleId}`)
    console.log(`  ${row.title}`)
    console.log(`  ${row.source}${row.category ? ` / ${row.category}` : ''} / cover=${row.hasCover ? 'yes' : 'no'}`)
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
