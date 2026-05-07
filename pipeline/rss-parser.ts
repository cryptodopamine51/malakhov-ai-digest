import { createHash } from 'crypto'
import RSSParser from 'rss-parser'
import { decodeHTML } from 'entities'
import { FEEDS, type FeedConfig } from './feeds.config'
import { RU_AI_KEYWORDS } from './keyword-filters'

// ── Типы ─────────────────────────────────────────────────────────────────────

export interface ParsedItem {
  originalUrl: string
  originalTitle: string
  snippet: string
  pubDate: string
  sourceName: string
  sourceLang: 'en' | 'ru'
  topics: string[]
  dedupHash: string
}

export interface SourceFeedResult {
  sourceName: string
  feedUrl: string
  status: 'ok' | 'empty' | 'failed'
  itemsSeen: number
  itemsReturned: number
  rejected: RssRejectedSummary[]
  httpStatus: number | null
  errorMessage: string | null
  responseTimeMs: number
}

export interface FetchAllFeedsResult {
  items: ParsedItem[]
  sourceResults: SourceFeedResult[]
  rejected: RssRejectedSummary[]
}

export type RssRejectedReason = 'keyword_filter' | 'requireDateInUrl' | 'dedup'

export interface RssRejectedSummary {
  reason: RssRejectedReason | string
  count: number
  examples: string[]
}

// ── Вспомогательные функции ───────────────────────────────────────────────────

/**
 * Проверяет наличие паттерна даты в URL.
 * Используется для ru-источников: отсекает вечнозелёные страницы без даты в пути.
 */
export function hasDateInUrl(url: string): boolean {
  return /\/\d{4}\/\d{2}\//.test(url) ||
    /\/\d{8}\//.test(url) ||
    /\/\d{4}-\d{2}-\d{2}\//.test(url)
}

/**
 * Нормализует заголовок для построения дедуп-хэша.
 */
export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^\wа-яёa-z0-9\s]/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export function normalizeKeywordText(text: string): string {
  return text
    .normalize('NFKC')
    .replace(/ё/g, 'е')
    .replace(/Ё/g, 'Е')
    .toLowerCase()
}

/**
 * Канонизирует URL: убирает tracking-параметры, нормализует trailing slash.
 */
export function canonicalizeUrl(url: string): string {
  try {
    const u = new URL(url)
    const TRACKING_PARAMS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content',
      'utm_term', 'fbclid', 'gclid', 'ref', 'source', '_ga']
    for (const p of TRACKING_PARAMS) u.searchParams.delete(p)
    // Normalize: remove trailing slash from path (except root)
    if (u.pathname.length > 1 && u.pathname.endsWith('/')) {
      u.pathname = u.pathname.slice(0, -1)
    }
    return u.toString()
  } catch {
    return url
  }
}

/**
 * SHA-256 дедуп-хэш по нормализованному заголовку + канонический URL.
 */
function buildDedupHash(title: string, url: string): string {
  const canonical = canonicalizeUrl(url)
  const normalized = normalizeTitle(title)
  return createHash('sha256')
    .update(`${normalized}|${canonical}`)
    .digest('hex')
    .slice(0, 32)
}

function rejectionExample(title: string | null | undefined, url: string | null | undefined): string {
  return [title?.trim(), url?.trim()].filter(Boolean).join(' | ').slice(0, 240)
}

function addRejected(
  rejected: Map<string, RssRejectedSummary>,
  reason: RssRejectedReason,
  example: string,
): void {
  const current = rejected.get(reason) ?? { reason, count: 0, examples: [] }
  current.count++
  if (example && current.examples.length < 3) current.examples.push(example)
  rejected.set(reason, current)
}

export function summarizeRejected(rejected: Iterable<RssRejectedSummary>): RssRejectedSummary[] {
  const aggregate = new Map<string, RssRejectedSummary>()
  for (const entry of rejected) {
    if (!entry.reason || entry.count <= 0) continue
    const current = aggregate.get(entry.reason) ?? { reason: entry.reason, count: 0, examples: [] }
    current.count += entry.count
    for (const example of entry.examples ?? []) {
      if (example && current.examples.length < 3) current.examples.push(example)
    }
    aggregate.set(entry.reason, current)
  }
  return [...aggregate.values()]
}

export function keywordMatches(searchText: string, keyword: string): boolean {
  const haystack = normalizeKeywordText(searchText)
  const normalized = normalizeKeywordText(keyword.trim())
  if (normalized === 'ии' || normalized === 'ai') {
    return new RegExp(`(^|[^\\p{L}\\p{N}])${normalized}([^\\p{L}\\p{N}]|$)`, 'iu').test(haystack)
  }
  return haystack.includes(normalized)
}

/**
 * Парсит все RSS-фиды и возвращает список свежих AI-новостей + source-level результаты.
 *
 * @param maxAgeMinutes - максимальный возраст публикации в минутах (по умолчанию 60)
 */
export async function fetchAllFeeds(maxAgeMinutes = 60): Promise<FetchAllFeedsResult> {
  const parser = new RSSParser({
    headers: {
      'User-Agent':
        'Mozilla/5.0 (compatible; MalakhovAIDigestBot/1.0; +https://news.malakhovai.ru)',
    },
    timeout: 20_000,
  })

  const cutoff = new Date(Date.now() - maxAgeMinutes * 60 * 1000)

  const allItems: ParsedItem[] = []
  const sourceResults: SourceFeedResult[] = []

  for (let i = 0; i < FEEDS.length; i += 5) {
    const batch = FEEDS.slice(i, i + 5)
    const results = await Promise.allSettled(
      batch.map((feed) => parseFeedWithRetry(parser, feed, cutoff))
    )
    for (const result of results) {
      if (result.status === 'fulfilled') {
        allItems.push(...result.value.items)
        sourceResults.push(result.value.sourceResult)
      }
    }
  }

  return {
    items: allItems,
    sourceResults,
    rejected: summarizeRejected(sourceResults.flatMap((result) => result.rejected)),
  }
}

/**
 * Парсит фид с одним retry при ошибке.
 */
export async function parseFeedWithRetry(
  parser: RSSParser,
  feed: FeedConfig,
  cutoff: Date,
  retryDelayMs = 3_000,
): Promise<{ items: ParsedItem[]; rejected: RssRejectedSummary[]; sourceResult: SourceFeedResult }> {
  try {
    const first = await parseFeed(parser, feed, cutoff)
    if (first.sourceResult.status !== 'failed') return first
    if (retryDelayMs > 0) await new Promise((resolve) => setTimeout(resolve, retryDelayMs))
    return await parseFeed(parser, feed, cutoff)
  } catch {
    if (retryDelayMs > 0) await new Promise((resolve) => setTimeout(resolve, retryDelayMs))
    return parseFeed(parser, feed, cutoff)
  }
}

/**
 * Парсит один RSS-фид и фильтрует элементы по свежести и ключевым словам.
 */
export async function parseFeed(
  parser: RSSParser,
  feed: FeedConfig,
  cutoff: Date
): Promise<{ items: ParsedItem[]; rejected: RssRejectedSummary[]; sourceResult: SourceFeedResult }> {
  const ts = () => new Date().toTimeString().slice(0, 8)
  const startedAt = Date.now()
  const rejected = new Map<string, RssRejectedSummary>()

  const sourceResult: SourceFeedResult = {
    sourceName: feed.name,
    feedUrl: feed.url,
    status: 'failed',
    itemsSeen: 0,
    itemsReturned: 0,
    rejected: [],
    httpStatus: null,
    errorMessage: null,
    responseTimeMs: 0,
  }

  try {
    const response = await fetch(feed.url, {
      headers: {
        'User-Agent': 'MalakhovAIDigestBot/1.0 (+https://news.malakhovai.ru)',
      },
      signal: AbortSignal.timeout(20_000),
    })

    sourceResult.httpStatus = response.status
    sourceResult.responseTimeMs = Date.now() - startedAt

    if (!response.ok) {
      sourceResult.errorMessage = `HTTP ${response.status}`
      console.error(`[${ts()}] Ошибка фида "${feed.name}": HTTP ${response.status}`)
      return { items: [], rejected: [], sourceResult }
    }

    const xml = await response.text()
    const feedData = await parser.parseString(xml)

    const items = feedData.items.slice(0, 20)
    sourceResult.itemsSeen = items.length

    const result: ParsedItem[] = []

    for (const item of items) {
      const rawDate = item.isoDate ?? item.pubDate
      const pubDate = rawDate ? new Date(rawDate) : null
      if (!pubDate || isNaN(pubDate.getTime()) || pubDate < cutoff) continue

      const url = item.link ?? item.guid
      if (!url) continue

      if (feed.lang === 'ru' && feed.needsKeywordFilter && feed.requireDateInUrl === true && !hasDateInUrl(url)) {
        addRejected(rejected, 'requireDateInUrl', rejectionExample(item.title, url))
        continue
      }

      if (feed.needsKeywordFilter) {
        const fields = feed.keywordSearchFields === 'title'
          ? [item.title ?? '']
          : [item.title ?? '', item.contentSnippet ?? item.content ?? '']
        const searchText = normalizeKeywordText(fields.join(' '))

        const keywordList = feed.keywords ?? RU_AI_KEYWORDS
        const hasKeyword = feed.keywordGroups?.length
          ? feed.keywordGroups.every((group) => group.some((kw) => keywordMatches(searchText, kw)))
          : keywordList.some((kw) => keywordMatches(searchText, kw))
        if (!hasKeyword) {
          addRejected(rejected, 'keyword_filter', rejectionExample(item.title, url))
          continue
        }
      }

      const rawTitle = item.title ?? 'Без заголовка'
      const rawSnippet = item.contentSnippet ?? item.content ?? item.summary ?? ''

      const originalTitle = decodeHTML(rawTitle)
      const snippet = decodeHTML(rawSnippet).slice(0, 300)
      const canonicalUrl = canonicalizeUrl(url)
      const dedupHash = buildDedupHash(originalTitle, canonicalUrl)

      result.push({
        originalUrl: canonicalUrl,
        originalTitle,
        snippet,
        pubDate: pubDate.toISOString(),
        sourceName: feed.name,
        sourceLang: feed.lang,
        topics: feed.topics,
        dedupHash,
      })
    }

    sourceResult.itemsReturned = result.length
    sourceResult.rejected = [...rejected.values()]
    sourceResult.status = result.length === 0 ? 'empty' : 'ok'

    console.log(
      `[${ts()}] ${feed.name}: получено ${items.length} записей, отфильтровано ${result.length}`
    )

    return { items: result, rejected: sourceResult.rejected, sourceResult }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    sourceResult.responseTimeMs = Date.now() - startedAt
    sourceResult.errorMessage = message
    console.error(`[${new Date().toTimeString().slice(0, 8)}] Ошибка фида "${feed.name}": ${message}`)
    return { items: [], rejected: [], sourceResult }
  }
}
