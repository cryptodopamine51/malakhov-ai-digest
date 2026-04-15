/**
 * pipeline/enricher.ts
 *
 * Этап 2 пайплайна: обогащение статей из Supabase.
 *
 * Для каждой необогащённой статьи:
 *   - считает score
 *   - если score < 2 — помечает как enriched, не публикует
 *   - если score >= 2 — загружает полный текст, переводит, генерирует slug,
 *     для топовых статей — вызывает Claude для why_it_matters
 *
 * Запуск: npm run enrich
 */

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { getServerClient, type Article } from '../lib/supabase'
import { scoreArticle } from './scorer'
import { fetchArticleContent } from './fetcher'
import { translateTitle, translateText } from './deepl'
import { generateWhyItMatters } from './claude'
import { generateSlug } from './slug'

// ── Константы ─────────────────────────────────────────────────────────────────

/** Минимальный score для публикации */
const MIN_SCORE_TO_PUBLISH = 2

/** Минимальный score для вызова Claude (дорогой ресурс — только для лучших) */
const MIN_SCORE_FOR_CLAUDE = 4

/** Размер батча за один запуск */
const BATCH_SIZE = 20

/** Пауза между статьями (мс) — защита от rate limit внешних API */
const SLEEP_MS = 1_000

// ── Утилиты ───────────────────────────────────────────────────────────────────

function log(msg: string): void {
  const ts = new Date().toTimeString().slice(0, 8)
  console.log(`[${ts}] ${msg}`)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// ── Топ статей за сегодня ──────────────────────────────────────────────────────

/**
 * Возвращает id статей с наибольшим score за последние 24 часа.
 * Используется чтобы вызывать Claude только для самых важных материалов.
 */
async function getTodayTopIds(
  supabase: ReturnType<typeof getServerClient>
): Promise<Set<string>> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

  const { data, error } = await supabase
    .from('articles')
    .select('id')
    .gte('created_at', since)
    .eq('published', true)
    .order('score', { ascending: false })
    .limit(10)

  if (error) {
    log(`Предупреждение: не удалось загрузить топ за сегодня — ${error.message}`)
    return new Set()
  }

  return new Set((data ?? []).map((a: { id: string }) => a.id))
}

function isInTopToday(id: string, topIds: Set<string>): boolean {
  return topIds.has(id)
}

// ── Обогащение одной статьи ───────────────────────────────────────────────────

async function enrichArticle(
  supabase: ReturnType<typeof getServerClient>,
  article: Article,
  topIds: Set<string>
): Promise<'published' | 'skipped' | 'error'> {
  const score = scoreArticle(article)

  // Слабая статья — пропускаем без обогащения
  if (score < MIN_SCORE_TO_PUBLISH) {
    const { error } = await supabase
      .from('articles')
      .update({ enriched: true, published: false, score })
      .eq('id', article.id)

    if (error) {
      log(`Ошибка сохранения (пропуск) "${article.original_title}": ${error.message}`)
      return 'error'
    }

    log(`— Пропущено [score: ${score}]: ${article.original_title.slice(0, 60)}`)
    return 'skipped'
  }

  // ── Полное обогащение ───────────────────────────────────────────────────────

  // 1. Загрузка страницы
  const { text: fullText, imageUrl } = await fetchArticleContent(article.original_url)
  const contentForTranslation = fullText || article.original_text || ''

  // 2. Перевод
  const lang = article.source_lang
  const ru_title = await translateTitle(article.original_title, lang)
  const ru_text = await translateText(contentForTranslation, lang)

  // 3. Slug
  const slug = generateSlug(ru_title || article.original_title, article.id)

  // 4. why_it_matters — только для топовых статей
  let why_it_matters = ''
  if (score >= MIN_SCORE_FOR_CLAUDE || isInTopToday(article.id, topIds)) {
    why_it_matters = await generateWhyItMatters(ru_title, ru_text)
  }

  // 5. Сохранение в Supabase
  const { error } = await supabase
    .from('articles')
    .update({
      score,
      cover_image_url: imageUrl,
      original_text: fullText || null,
      ru_title,
      ru_text,
      why_it_matters: why_it_matters || null,
      slug,
      enriched: true,
      published: true,
      updated_at: new Date().toISOString(),
    })
    .eq('id', article.id)

  if (error) {
    log(`Ошибка сохранения "${article.original_title}": ${error.message}`)
    return 'error'
  }

  log(
    `✓ Опубликовано [score: ${score}${why_it_matters ? ', Claude ✓' : ''}]: ` +
    `${(ru_title || article.original_title).slice(0, 60)}`
  )

  return 'published'
}

// ── Главная функция ───────────────────────────────────────────────────────────

async function enrichBatch(): Promise<void> {
  log('=== Запуск enricher.ts ===')

  // Инициализация Supabase
  let supabase: ReturnType<typeof getServerClient>
  try {
    supabase = getServerClient()
    log('Supabase клиент инициализирован')
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    log(`Критическая ошибка: ${msg}`)
    process.exit(1)
  }

  // Загружаем необогащённые статьи
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

  // Топ-10 за сегодня для Claude
  const topIds = await getTodayTopIds(supabase)
  log(`Топ-статей за 24ч: ${topIds.size}`)

  // Счётчики
  let published = 0
  let skipped = 0
  let errors = 0

  for (const article of articles as Article[]) {
    try {
      const result = await enrichArticle(supabase, article, topIds)

      switch (result) {
        case 'published': published++; break
        case 'skipped':   skipped++;   break
        case 'error':     errors++;    break
      }
    } catch (err) {
      errors++
      const msg = err instanceof Error ? err.message : String(err)
      log(`✗ Необработанная ошибка для ${article.original_url}: ${msg}`)
      // Помечаем как enriched чтобы не застревать в очереди
      await supabase
        .from('articles')
        .update({ enriched: true })
        .eq('id', article.id)
    }

    // Пауза между статьями
    await sleep(SLEEP_MS)
  }

  // Итоговый отчёт
  log('─────────────────────────────────────')
  log(`Обработано:  ${articles.length}`)
  log(`Опубликовано: ${published}`)
  log(`Пропущено:   ${skipped}`)
  log(`Ошибок:      ${errors}`)
  log('=== enricher.ts завершён ===')
}

enrichBatch().catch((error: unknown) => {
  const msg = error instanceof Error ? error.message : String(error)
  console.error(`[${new Date().toTimeString().slice(0, 8)}] КРИТИЧЕСКАЯ ОШИБКА: ${msg}`)
  process.exit(1)
})
