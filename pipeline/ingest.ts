/**
 * pipeline/ingest.ts
 *
 * Парсит все RSS-фиды и записывает новые статьи в Supabase.
 * Запуск: npm run ingest
 */

import { config } from 'dotenv'
import { resolve } from 'path'

// Явно указываем .env.local — Next.js-соглашение для локальных секретов
config({ path: resolve(process.cwd(), '.env.local') })
import { fetchAllFeeds, type ParsedItem } from './rss-parser'
import { getServerClient } from '../lib/supabase'

// ── Утилита логирования с временной меткой ────────────────────────────────────

function log(message: string): void {
  const ts = new Date().toTimeString().slice(0, 8)
  console.log(`[${ts}] ${message}`)
}

function logError(message: string, error?: unknown): void {
  const ts = new Date().toTimeString().slice(0, 8)
  let errMsg = ''
  if (error instanceof Error) {
    errMsg = error.message
  } else if (error && typeof error === 'object') {
    // Supabase возвращает объект с полями message, code, details, hint
    const e = error as Record<string, unknown>
    errMsg = [e.message, e.code, e.details, e.hint].filter(Boolean).join(' | ')
  } else {
    errMsg = String(error ?? '')
  }
  console.error(`[${ts}] ОШИБКА: ${message}${errMsg ? ' — ' + errMsg : ''}`)
}

// ── Вставка одного элемента в Supabase ────────────────────────────────────────

async function insertArticle(
  supabase: ReturnType<typeof getServerClient>,
  item: ParsedItem
): Promise<'inserted' | 'skipped' | 'error'> {
  // Проверяем дедупликацию: если dedup_hash уже есть — пропускаем
  const { data: existing, error: checkError } = await supabase
    .from('articles')
    .select('id')
    .eq('dedup_hash', item.dedupHash)
    .maybeSingle()

  if (checkError) {
    logError(`Ошибка проверки дедупликации для "${item.originalTitle}"`, checkError)
    return 'error'
  }

  if (existing) {
    return 'skipped'
  }

  // Вставляем новую запись
  const { error: insertError } = await supabase.from('articles').insert({
    original_url: item.originalUrl,
    original_title: item.originalTitle,
    original_text: null, // заполняется на этапе обогащения (enricher.ts)
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

  if (insertError) {
    // Уникальное ограничение — нормальная ситуация при параллельном запуске
    if (insertError.code === '23505') {
      return 'skipped'
    }
    logError(`Ошибка вставки "${item.originalTitle}"`, insertError)
    return 'error'
  }

  return 'inserted'
}

// ── Главная функция ───────────────────────────────────────────────────────────

async function main(): Promise<void> {
  log('=== Запуск ingest.ts ===')

  // Инициализируем Supabase серверный клиент
  let supabase: ReturnType<typeof getServerClient>
  try {
    supabase = getServerClient()
    log('Supabase клиент инициализирован')
  } catch (error) {
    logError('Не удалось создать Supabase клиент', error)
    process.exit(1)
  }

  // Парсим все RSS-фиды (последний час)
  log('Начинаем парсинг RSS-фидов...')
  let items: ParsedItem[]
  try {
    items = await fetchAllFeeds(60)
    log(`Получено записей из фидов: ${items.length}`)
  } catch (error) {
    logError('Критическая ошибка при парсинге фидов', error)
    process.exit(1)
  }

  if (items.length === 0) {
    log('Новых записей нет — завершаем работу')
    return
  }

  // Счётчики для итогового отчёта
  let inserted = 0
  let skipped = 0
  let errors = 0

  // Обрабатываем элементы последовательно, чтобы не перегружать Supabase
  for (const item of items) {
    const status = await insertArticle(supabase, item)

    switch (status) {
      case 'inserted':
        inserted++
        log(`+ Добавлено: "${item.originalTitle}" [${item.sourceName}]`)
        break
      case 'skipped':
        skipped++
        break
      case 'error':
        errors++
        break
    }
  }

  // Итоговый отчёт
  log('─────────────────────────────────────')
  log(`Всего из фидов: ${items.length}`)
  log(`Добавлено:      ${inserted}`)
  log(`Пропущено:      ${skipped}`)
  log(`Ошибок:         ${errors}`)
  log('=== ingest.ts завершён ===')
}

main().catch((error: unknown) => {
  logError('Необработанная ошибка', error)
  process.exit(1)
})
