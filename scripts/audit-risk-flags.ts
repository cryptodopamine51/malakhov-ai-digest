import { config } from 'dotenv'
import { resolve } from 'path'
import { pathToFileURL } from 'url'

config({ path: resolve(process.cwd(), '.env.local') })

import { getServerClient, type Article } from '../lib/supabase'
import { detectEditorialRiskFlags } from '../pipeline/editorial-routing'

function arg(name: string): string | undefined {
  return process.argv.find((item) => item.startsWith(`--${name}=`))?.split('=').slice(1).join('=')
}

function numberArg(name: string, fallback: number): number {
  const value = Number(arg(name))
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback
}

async function main(): Promise<void> {
  const limit = numberArg('limit', 500)
  const supabase = getServerClient()
  const { data, error } = await supabase
    .from('articles')
    .select('id, source_name, original_title, original_text, topics, primary_category, secondary_categories, score, created_at')
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) throw new Error(`articles query failed: ${error.message}`)

  const counts = new Map<string, number>()
  const examples = new Map<string, Array<{ title: string; source: string; score: number }>>()
  const rows = (data ?? []) as Article[]

  for (const article of rows) {
    const flags = detectEditorialRiskFlags({
      sourceName: article.source_name,
      originalTitle: article.original_title,
      originalText: article.original_text ?? '',
      topics: article.topics ?? [],
      primaryCategory: article.primary_category,
      secondaryCategories: article.secondary_categories ?? [],
      score: article.score,
    })
    for (const flag of flags) {
      counts.set(flag, (counts.get(flag) ?? 0) + 1)
      const bucket = examples.get(flag) ?? []
      if (bucket.length < 8) {
        bucket.push({
          title: article.original_title,
          source: article.source_name,
          score: article.score,
        })
      }
      examples.set(flag, bucket)
    }
  }

  console.log(`[risk-flags] sample=${rows.length}`)
  for (const [flag, count] of [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))) {
    const share = rows.length ? ((count / rows.length) * 100).toFixed(1) : '0.0'
    console.log(`\n${flag}: ${count}/${rows.length} (${share}%)`)
    for (const item of examples.get(flag) ?? []) {
      console.log(`  - [${item.score}] ${item.source}: ${item.title.slice(0, 140)}`)
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  })
}
