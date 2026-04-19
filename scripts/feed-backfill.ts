import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { fetchAllFeeds, type ParsedItem } from '../pipeline/rss-parser'
import { getServerClient } from '../lib/supabase'

const MAX_AGE_MINUTES = Number(process.env.FEED_BACKFILL_MINUTES ?? 60 * 24 * 14)

function log(message: string) {
  console.log(`[${new Date().toTimeString().slice(0, 8)}] ${message}`)
}

async function insertArticle(
  supabase: ReturnType<typeof getServerClient>,
  item: ParsedItem,
): Promise<'inserted' | 'skipped' | 'error'> {
  const { data: existing, error: checkError } = await supabase
    .from('articles')
    .select('id')
    .eq('dedup_hash', item.dedupHash)
    .maybeSingle()

  if (checkError) {
    log(`Ошибка дедупликации: ${checkError.message}`)
    return 'error'
  }

  if (existing) return 'skipped'

  const { error } = await supabase.from('articles').insert({
    original_url: item.originalUrl,
    original_title: item.originalTitle,
    original_text: null,
    source_name: item.sourceName,
    source_lang: item.sourceLang,
    topics: item.topics,
    pub_date: item.pubDate,
    dedup_hash: item.dedupHash,
    enriched: false,
    published: false,
    tg_sent: false,
    score: 0,
  })

  if (error) {
    if (error.code === '23505') return 'skipped'
    log(`Ошибка вставки "${item.originalTitle.slice(0, 80)}": ${error.message}`)
    return 'error'
  }

  return 'inserted'
}

async function main() {
  const supabase = getServerClient()
  log(`Feed backfill window: ${MAX_AGE_MINUTES} min`)

  const items = await fetchAllFeeds(MAX_AGE_MINUTES)
  log(`Получено элементов: ${items.length}`)

  let inserted = 0
  let skipped = 0
  let errors = 0

  for (const item of items) {
    const status = await insertArticle(supabase, item)
    if (status === 'inserted') inserted++
    if (status === 'skipped') skipped++
    if (status === 'error') errors++
  }

  log(`Добавлено: ${inserted}`)
  log(`Пропущено: ${skipped}`)
  log(`Ошибок: ${errors}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
