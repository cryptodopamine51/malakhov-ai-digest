import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { getServerClient } from '../lib/supabase'
import type { Article } from '../lib/supabase'

type Topic = 'ai-labs' | 'ai-investments' | 'ai-startups'

const TITLE_RULES: Array<{ topic: Topic; patterns: RegExp[] }> = [
  {
    topic: 'ai-labs',
    patterns: [
      /\bopenai\b/i,
      /\banthropic\b/i,
      /\bclaude\b/i,
      /\bgemini\b/i,
      /\bgoogle\b/i,
      /\bgpt\b/i,
      /\bsber\b/i,
      /\bdeepmind\b/i,
      /\bcodex\b/i,
      /\bkvae\b/i,
    ],
  },
  {
    topic: 'ai-investments',
    patterns: [
      /\$\d+/i,
      /\bipo\b/i,
      /\bvaluation\b/i,
      /\bmarket share\b/i,
      /\bads\b/i,
      /\brevenue\b/i,
      /\bdeal\b/i,
      /\bfunding\b/i,
      /\bseries [abc]\b/i,
      /\bпривлек\b/i,
      /\bсделк/i,
      /\bвыручк/i,
      /\bреклам/i,
      /\bрынка\b/i,
      /\bзарплат/i,
    ],
  },
  {
    topic: 'ai-startups',
    patterns: [
      /\bcharacter\.ai\b/i,
      /\bmanus\b/i,
      /\bcursor\b/i,
      /\brufler\b/i,
      /\bseberd\b/i,
      /\bunitree\b/i,
      /\bstartup\b/i,
      /\bстартап/i,
      /\bосновател/i,
      /\bproduct\b/i,
    ],
  },
]

function deriveExtraTopics(article: Article): Topic[] {
  const text = `${article.ru_title ?? article.original_title} ${article.source_name}`.toLowerCase()
  const existing = new Set(article.topics ?? [])
  const next: Topic[] = []

  for (const rule of TITLE_RULES) {
    if (existing.has(rule.topic)) continue
    if (rule.patterns.some((pattern) => pattern.test(text))) next.push(rule.topic)
  }

  return next
}

async function main() {
  const supabase = getServerClient()
  const { data, error } = await supabase
    .from('articles')
    .select('*')
    .eq('published', true)
    .eq('quality_ok', true)
    .order('created_at', { ascending: false })
    .limit(200)

  if (error) throw error

  let updated = 0
  for (const article of (data ?? []) as Article[]) {
    const extraTopics = deriveExtraTopics(article)
    if (extraTopics.length === 0) continue

    const merged = Array.from(new Set([...(article.topics ?? []), ...extraTopics]))
    const { error: updateError } = await supabase
      .from('articles')
      .update({ topics: merged })
      .eq('id', article.id)

    if (updateError) {
      console.error(`Ошибка обновления ${article.id}: ${updateError.message}`)
      continue
    }

    updated++
    console.log(`updated ${article.id} -> ${merged.join(', ')}`)
  }

  console.log(`Всего обновлено: ${updated}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
