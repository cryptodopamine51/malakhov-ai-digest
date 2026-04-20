/**
 * pipeline/ingest.ts
 *
 * Парсит все RSS-фиды и записывает новые статьи в Supabase.
 * Пишет ingest_runs и source_runs для observability.
 *
 * Запуск: npm run ingest
 */

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { fetchAllFeeds, type ParsedItem, type SourceFeedResult } from './rss-parser'
import { getServerClient } from '../lib/supabase'

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
    const e = error as Record<string, unknown>
    errMsg = [e.message, e.code, e.details, e.hint].filter(Boolean).join(' | ')
  } else {
    errMsg = String(error ?? '')
  }
  console.error(`[${ts}] ОШИБКА: ${message}${errMsg ? ' — ' + errMsg : ''}`)
}

async function insertArticle(
  supabase: ReturnType<typeof getServerClient>,
  item: ParsedItem
): Promise<'inserted' | 'duplicate' | 'error'> {
  // Check for existing article by dedup_hash
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
    // Touch last_seen_at; discover_count increment is handled by DB trigger or backfill
    await supabase
      .from('articles')
      .update({ last_seen_at: new Date().toISOString() })
      .eq('id', existing.id)

    return 'duplicate'
  }

  const now = new Date().toISOString()
  const { error: insertError } = await supabase.from('articles').insert({
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
    // New status fields
    ingest_status: 'ingested',
    enrich_status: 'pending',
    publish_status: 'draft',
    first_seen_at: now,
    last_seen_at: now,
    discover_count: 1,
  })

  if (insertError) {
    if (insertError.code === '23505') {
      return 'duplicate'
    }
    logError(`Ошибка вставки "${item.originalTitle}"`, insertError)
    return 'error'
  }

  return 'inserted'
}

async function writeSourceRun(
  supabase: ReturnType<typeof getServerClient>,
  ingestRunId: string,
  sourceResult: SourceFeedResult,
  itemsNew: number,
  itemsDuplicates: number,
): Promise<void> {
  await supabase.from('source_runs').insert({
    ingest_run_id: ingestRunId,
    source_name: sourceResult.sourceName,
    started_at: new Date(Date.now() - sourceResult.responseTimeMs).toISOString(),
    finished_at: new Date().toISOString(),
    status: sourceResult.status,
    items_seen: sourceResult.itemsSeen,
    items_new: itemsNew,
    items_duplicates: itemsDuplicates,
    http_status: sourceResult.httpStatus,
    error_message: sourceResult.errorMessage,
    response_time_ms: sourceResult.responseTimeMs,
  })
}

async function main(): Promise<void> {
  log('=== Запуск ingest.ts ===')

  let supabase: ReturnType<typeof getServerClient>
  try {
    supabase = getServerClient()
    log('Supabase клиент инициализирован')
  } catch (error) {
    logError('Не удалось создать Supabase клиент', error)
    process.exit(1)
  }

  // Create ingest_run record
  const runStarted = new Date().toISOString()
  const { data: runData } = await supabase
    .from('ingest_runs')
    .insert({
      started_at: runStarted,
      status: 'running',
    })
    .select('id')
    .single()
  const runId: string = runData?.id ?? 'unknown'

  log('Начинаем парсинг RSS-фидов...')
  let fetchResult: Awaited<ReturnType<typeof fetchAllFeeds>>
  try {
    fetchResult = await fetchAllFeeds(60)
    log(`Получено записей из фидов: ${fetchResult.items.length} (из ${fetchResult.sourceResults.length} источников)`)
  } catch (error) {
    logError('Критическая ошибка при парсинге фидов', error)
    await supabase.from('ingest_runs').update({
      finished_at: new Date().toISOString(),
      status: 'failed',
      error_summary: error instanceof Error ? error.message : String(error),
    }).eq('id', runId)
    process.exit(1)
  }

  const { items, sourceResults } = fetchResult

  const feedsTotal = sourceResults.length
  const feedsFailed = sourceResults.filter((r) => r.status === 'failed').length

  if (items.length === 0) {
    log('Новых записей нет — завершаем работу')
    await supabase.from('ingest_runs').update({
      finished_at: new Date().toISOString(),
      status: 'ok',
      feeds_total: feedsTotal,
      feeds_failed: feedsFailed,
      items_seen: 0,
      items_inserted: 0,
      items_duplicates: 0,
      items_failed: 0,
    }).eq('id', runId)

    // Write source_runs for monitoring even when no items
    for (const sr of sourceResults) {
      await writeSourceRun(supabase, runId, sr, 0, 0)
    }
    return
  }

  let inserted = 0
  let duplicates = 0
  let errors = 0

  // Track per-source counts for source_runs
  const sourceStats = new Map<string, { new: number; dup: number }>()
  for (const sr of sourceResults) {
    sourceStats.set(sr.sourceName, { new: 0, dup: 0 })
  }

  for (const item of items) {
    const status = await insertArticle(supabase, item)
    const stats = sourceStats.get(item.sourceName) ?? { new: 0, dup: 0 }

    switch (status) {
      case 'inserted':
        inserted++
        stats.new++
        log(`+ Добавлено: "${item.originalTitle}" [${item.sourceName}]`)
        break
      case 'duplicate':
        duplicates++
        stats.dup++
        break
      case 'error':
        errors++
        break
    }

    sourceStats.set(item.sourceName, stats)
  }

  // Write source_runs
  for (const sr of sourceResults) {
    const stats = sourceStats.get(sr.sourceName) ?? { new: 0, dup: 0 }
    await writeSourceRun(supabase, runId, sr, stats.new, stats.dup)
  }

  const runStatus = errors > 0 && inserted === 0 ? 'failed'
    : feedsFailed > 0 || errors > 0 ? 'partial'
    : 'ok'

  await supabase.from('ingest_runs').update({
    finished_at: new Date().toISOString(),
    status: runStatus,
    feeds_total: feedsTotal,
    feeds_failed: feedsFailed,
    items_seen: items.length,
    items_inserted: inserted,
    items_duplicates: duplicates,
    items_failed: errors,
  }).eq('id', runId)

  log('─────────────────────────────────────')
  log(`Всего из фидов: ${items.length}`)
  log(`Добавлено:      ${inserted}`)
  log(`Дублей:         ${duplicates}`)
  log(`Ошибок:         ${errors}`)
  log(`Run status:     ${runStatus}`)
  log('=== ingest.ts завершён ===')
}

main().catch((error: unknown) => {
  logError('Необработанная ошибка', error)
  process.exit(1)
})
