#!/usr/bin/env tsx
import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { getServerClient } from '../lib/supabase'
import { fetchArticleContent } from '../pipeline/fetcher'

const LIMIT = 500
const SOURCE_DELAY_MS = 500

function sleep(ms: number): Promise<void> {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms))
}

async function main(): Promise<void> {
  const supabase = getServerClient()
  const { data: articles, error } = await supabase
    .from('articles')
    .select('id, original_url, article_videos')
    .eq('publish_status', 'live')
    .eq('verified_live', true)
    .eq('quality_ok', true)
    .is('article_videos', null)
    .limit(LIMIT)

  if (error) throw error

  console.log(`Backfill candidates: ${articles?.length ?? 0}`)

  let done = 0
  let failed = 0

  for (const article of articles ?? []) {
    try {
      const { inlineVideos } = await fetchArticleContent(article.original_url, { includeText: false })
      const { error: updateError } = await supabase
        .from('articles')
        .update({ article_videos: inlineVideos.length > 0 ? inlineVideos : [] })
        .eq('id', article.id)

      if (updateError) throw updateError

      done++
      if (done % 20 === 0) console.log(`  ...${done}`)
    } catch (err) {
      failed++
      console.error(`fail ${article.id}: ${err instanceof Error ? err.message : String(err)}`)
    }

    await sleep(SOURCE_DELAY_MS)
  }

  console.log(`Done: updated=${done}, failed=${failed}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
