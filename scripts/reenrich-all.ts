/**
 * scripts/reenrich-all.ts
 *
 * Одноразовый backfill: сбрасывает enriched=false для статей за последние 14 дней
 * без quality_ok=true, затем запускает enrichBatch в цикле.
 *
 * Запуск: npx tsx scripts/reenrich-all.ts
 */

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { getServerClient } from '../lib/supabase'
import { scoreArticle } from '../pipeline/scorer'
import { fetchArticleContent } from '../pipeline/fetcher'
import { generateEditorial } from '../pipeline/claude'
import { generateSlug } from '../pipeline/slug'
import type { Article } from '../lib/supabase'

const BATCH_SIZE = 10
const SLEEP_MS = 2_500
const DAYS_BACK = 14

function log(msg: string) {
  console.log(`[${new Date().toTimeString().slice(0, 8)}] ${msg}`)
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

async function main() {
  log('=== reenrich-all.ts ===')

  const supabase = getServerClient()
  const since = new Date(Date.now() - DAYS_BACK * 24 * 60 * 60 * 1000).toISOString()

  // Сбросить enriched=false для кандидатов
  const { data: candidates, error: selectErr } = await supabase
    .from('articles')
    .select('id')
    .gte('created_at', since)
    .or('quality_ok.is.null,quality_ok.eq.false')

  if (selectErr) {
    log(`Ошибка выборки: ${selectErr.message}`)
    process.exit(1)
  }

  const ids = (candidates ?? []).map((r: { id: string }) => r.id)
  log(`Кандидатов для переобогащения: ${ids.length}`)

  if (ids.length === 0) {
    log('Нет кандидатов — завершаем')
    return
  }

  // Сбросить enriched
  const { error: resetErr } = await supabase
    .from('articles')
    .update({ enriched: false })
    .in('id', ids)

  if (resetErr) {
    log(`Ошибка сброса enriched: ${resetErr.message}`)
    process.exit(1)
  }

  log(`enriched=false для ${ids.length} статей. Запускаем переобогащение...`)

  let totalProcessed = 0
  let totalPublished = 0
  let totalRejected = 0

  while (true) {
    const { data: batch, error: batchErr } = await supabase
      .from('articles')
      .select('*')
      .eq('enriched', false)
      .gte('created_at', since)
      .order('created_at', { ascending: true })
      .limit(BATCH_SIZE)

    if (batchErr) {
      log(`Ошибка загрузки батча: ${batchErr.message}`)
      break
    }

    if (!batch || batch.length === 0) break

    for (const article of batch as Article[]) {
      try {
        const score = scoreArticle(article)

        if (score < 2) {
          await supabase
            .from('articles')
            .update({ enriched: true, published: false, quality_ok: false, quality_reason: 'low_score', score })
            .eq('id', article.id)
          totalProcessed++
          continue
        }

        const { text: fullText, imageUrl } = await fetchArticleContent(article.original_url)
        const content = fullText || article.original_text || ''
        const { output: editorial } = await generateEditorial(
          article.original_title,
          content,
          article.source_name,
          article.source_lang,
          article.topics ?? [],
        )
        const slug = generateSlug(editorial?.ru_title || article.original_title, article.id)

        if (!editorial) {
          await supabase
            .from('articles')
            .update({ enriched: true, published: false, quality_ok: false, quality_reason: 'editorial_parse_failed', score, slug })
            .eq('id', article.id)
          totalRejected++
        } else {
          await supabase
            .from('articles')
            .update({
              score,
              cover_image_url: imageUrl,
              original_text: fullText || null,
              ru_title: editorial.ru_title,
              ru_text: editorial.editorial_body,
              lead: editorial.lead,
              summary: editorial.summary,
              card_teaser: editorial.card_teaser,
              tg_teaser: editorial.tg_teaser,
              editorial_body: editorial.editorial_body,
              editorial_model: 'claude-sonnet-4-6',
              quality_ok: editorial.quality_ok,
              quality_reason: editorial.quality_reason || null,
              slug,
              enriched: true,
              published: editorial.quality_ok,
              updated_at: new Date().toISOString(),
            })
            .eq('id', article.id)

          editorial.quality_ok ? totalPublished++ : totalRejected++
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        log(`Ошибка для ${article.id}: ${msg}`)
        await supabase
          .from('articles')
          .update({ enriched: true, quality_ok: false, quality_reason: 'unhandled_error' })
          .eq('id', article.id)
      }

      totalProcessed++
      await sleep(SLEEP_MS)
    }

    log(`Обработано: ${totalProcessed} / опубликовано: ${totalPublished} / отклонено: ${totalRejected}`)
  }

  log('─────────────────────────────────────')
  log(`Итого обработано: ${totalProcessed}`)
  log(`Опубликовано: ${totalPublished}`)
  log(`Отклонено: ${totalRejected}`)
  log('=== reenrich-all.ts завершён ===')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
