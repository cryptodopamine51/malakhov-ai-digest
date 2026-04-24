import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { getServerClient, type Article } from '../lib/supabase'
import { scoreArticle } from '../pipeline/scorer'
import { fetchArticleContent } from '../pipeline/fetcher'
import { generateEditorial } from '../pipeline/claude'
import { ensureUniqueSlug } from '../pipeline/slug'

const DEFAULT_TOPICS = ['ai-labs', 'ai-investments', 'ai-startups'] as const
const TARGET_TOPICS = (process.env.REENRICH_TOPICS?.split(',').map((topic) => topic.trim()).filter(Boolean) ??
  [...DEFAULT_TOPICS]) as string[]
const LIMIT = Number(process.env.REENRICH_LIMIT ?? 36)
const SLEEP_MS = 2_500

function log(msg: string) {
  console.log(`[${new Date().toTimeString().slice(0, 8)}] ${msg}`)
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function main() {
  const supabase = getServerClient()

  const { data, error } = await supabase
    .from('articles')
    .select('*')
    .in('enriched', [false, true])
    .or('quality_ok.is.null,quality_ok.eq.false')
    .order('created_at', { ascending: false })
    .limit(200)

  if (error) throw error

  const candidates = (data ?? [])
    .filter((article) => (article.topics ?? []).some((topic: string) => TARGET_TOPICS.includes(topic)))
    .slice(0, LIMIT) as Article[]

  log(`Кандидатов на targeted reenrich: ${candidates.length}`)

  let published = 0
  let rejected = 0
  let errors = 0

  for (const article of candidates) {
    try {
      const { text: fullText, imageUrl, tables, inlineImages } = await fetchArticleContent(article.original_url)
      const scoringArticle: Article = {
        ...article,
        original_text: fullText || article.original_text,
        cover_image_url: imageUrl || article.cover_image_url,
      }

      const score = scoreArticle(scoringArticle)
      if (score < 2) {
        await supabase
          .from('articles')
          .update({
            enriched: true,
            published: false,
            quality_ok: false,
            quality_reason: 'low_score',
            score,
            original_text: fullText || article.original_text,
            cover_image_url: imageUrl || article.cover_image_url,
          })
          .eq('id', article.id)
        rejected++
        continue
      }

      const { output: editorial } = await generateEditorial(
        article.original_title,
        fullText || article.original_text || '',
        article.source_name,
        article.source_lang,
        article.topics ?? [],
        {
          operation: 'reenrich_topic_slices',
          articleId: article.id,
          metadata: {
            script: 'reenrich-topic-slices',
            targetTopics: TARGET_TOPICS,
          },
        },
      )

      const slug = await ensureUniqueSlug(supabase, editorial?.ru_title || article.original_title, article.id)

      if (!editorial) {
        await supabase
          .from('articles')
          .update({
            enriched: true,
            published: false,
            quality_ok: false,
            quality_reason: 'editorial_parse_failed',
            score,
            slug,
            original_text: fullText || article.original_text,
            cover_image_url: imageUrl || article.cover_image_url,
          })
          .eq('id', article.id)
        rejected++
      } else {
        await supabase
          .from('articles')
          .update({
            score,
            cover_image_url: imageUrl || article.cover_image_url,
            original_text: fullText || null,
            ru_title: editorial.ru_title,
            ru_text: editorial.editorial_body,
            lead: editorial.lead,
            summary: editorial.summary,
            card_teaser: editorial.card_teaser,
            tg_teaser: editorial.tg_teaser,
            editorial_body: editorial.editorial_body,
            editorial_model: 'claude-sonnet-4-6',
            glossary: editorial.glossary.length > 0 ? editorial.glossary : null,
            link_anchors: editorial.link_anchors.length > 0 ? editorial.link_anchors : null,
            article_tables: tables.length > 0 ? tables : null,
            article_images: inlineImages.length > 0 ? inlineImages : null,
            quality_ok: editorial.quality_ok,
            quality_reason: editorial.quality_reason || null,
            slug,
            enriched: true,
            published: editorial.quality_ok,
            updated_at: new Date().toISOString(),
          })
          .eq('id', article.id)

        editorial.quality_ok ? published++ : rejected++
      }

      log(`processed ${article.source_name}: ${(article.original_title || '').slice(0, 90)}`)
      await sleep(SLEEP_MS)
    } catch (error) {
      errors++
      log(`Ошибка: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  log(`Опубликовано: ${published}`)
  log(`Отклонено: ${rejected}`)
  log(`Ошибок: ${errors}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
