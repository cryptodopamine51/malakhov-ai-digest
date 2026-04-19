/**
 * pipeline/enricher.ts
 *
 * Этап 2 пайплайна: обогащение статей через Claude Sonnet.
 *
 * Запуск: npm run enrich
 */

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { getServerClient, type Article } from '../lib/supabase'
import { scoreArticle } from './scorer'
import { fetchArticleContent } from './fetcher'
import { generateEditorial } from './claude'
import { generateSlug } from './slug'

const MIN_SCORE_FOR_CLAUDE = 2
const BATCH_SIZE = 25
const SLEEP_MS = 2_000

function log(msg: string): void {
  const ts = new Date().toTimeString().slice(0, 8)
  console.log(`[${ts}] ${msg}`)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function enrichArticle(
  supabase: ReturnType<typeof getServerClient>,
  article: Article,
): Promise<'published' | 'skipped' | 'rejected' | 'error'> {
  const { text: fullText, imageUrl, tables, inlineImages } = await fetchArticleContent(article.original_url)
  const articleForScoring: Article = {
    ...article,
    original_text: fullText || article.original_text,
    cover_image_url: imageUrl || article.cover_image_url,
  }
  const score = scoreArticle(articleForScoring)

  // Слишком слабая статья — не тратим токены Claude
  if (score < MIN_SCORE_FOR_CLAUDE) {
    const { error } = await supabase
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

    if (error) {
      log(`Ошибка сохранения (low_score) "${article.original_title.slice(0, 60)}": ${error.message}`)
      return 'error'
    }

    log(`— low_score [${score}]: ${article.original_title.slice(0, 60)}`)
    return 'skipped'
  }

  const contentForClaude = fullText || article.original_text || ''

  // Вызов редактора
  const editorial = await generateEditorial(
    article.original_title,
    contentForClaude,
    article.source_name,
    article.source_lang,
    article.topics ?? [],
  )

  const slug = generateSlug(
    editorial?.ru_title || article.original_title,
    article.id,
  )

  if (!editorial) {
    // Claude вернул мусор или пустоту
    const { error } = await supabase
      .from('articles')
      .update({
        enriched: true,
        published: false,
        quality_ok: false,
        quality_reason: 'editorial_parse_failed',
        score,
        cover_image_url: imageUrl,
        slug,
        updated_at: new Date().toISOString(),
      })
      .eq('id', article.id)

    if (error) log(`Ошибка сохранения (parse_failed) "${article.original_title.slice(0, 60)}": ${error.message}`)
    return 'rejected'
  }

  const { error } = await supabase
    .from('articles')
    .update({
      score,
      cover_image_url: imageUrl,
      original_text: fullText || null,
      ru_title: editorial.ru_title,
      ru_text: editorial.editorial_body,   // обратная совместимость
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

  if (error) {
    log(`Ошибка сохранения "${article.original_title.slice(0, 60)}": ${error.message}`)
    return 'error'
  }

  const status = editorial.quality_ok ? '✓ published' : '✗ rejected'
  log(
    `${status} [score:${score}] quality_ok=${editorial.quality_ok}` +
    (editorial.quality_reason ? ` reason="${editorial.quality_reason}"` : '') +
    ` — ${editorial.ru_title.slice(0, 60)}`
  )

  return editorial.quality_ok ? 'published' : 'rejected'
}

async function enrichBatch(): Promise<void> {
  log('=== Запуск enricher.ts ===')

  let supabase: ReturnType<typeof getServerClient>
  try {
    supabase = getServerClient()
    log('Supabase клиент инициализирован')
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    log(`Критическая ошибка: ${msg}`)
    process.exit(1)
  }

  const { data: articles, error: fetchError } = await supabase
    .from('articles')
    .select('*')
    .eq('enriched', false)
    .order('created_at', { ascending: true })
    .limit(BATCH_SIZE)

  if (fetchError) {
    log(`Ошибка загрузки статей: ${fetchError.message}`)
    process.exit(1)
  }

  if (!articles?.length) {
    log('Нет статей для обогащения — завершаем')
    return
  }

  log(`Загружено статей: ${articles.length}`)

  let published = 0
  let skipped = 0
  let rejected = 0
  let errors = 0

  for (const article of articles as Article[]) {
    try {
      const result = await enrichArticle(supabase, article)
      switch (result) {
        case 'published': published++; break
        case 'skipped':   skipped++;   break
        case 'rejected':  rejected++;  break
        case 'error':     errors++;    break
      }
    } catch (err) {
      errors++
      const msg = err instanceof Error ? err.message : String(err)
      log(`✗ Необработанная ошибка для ${article.original_url}: ${msg}`)
      await supabase
        .from('articles')
        .update({ enriched: true, quality_ok: false, quality_reason: 'unhandled_error' })
        .eq('id', article.id)
    }

    await sleep(SLEEP_MS)
  }

  log('─────────────────────────────────────')
  log(`Обработано:   ${articles.length}`)
  log(`Опубликовано: ${published}`)
  log(`Отклонено:    ${rejected}`)
  log(`Пропущено:    ${skipped}`)
  log(`Ошибок:       ${errors}`)
  log('=== enricher.ts завершён ===')
}

enrichBatch().catch((error: unknown) => {
  const msg = error instanceof Error ? error.message : String(error)
  console.error(`[${new Date().toTimeString().slice(0, 8)}] КРИТИЧЕСКАЯ ОШИБКА: ${msg}`)
  process.exit(1)
})
