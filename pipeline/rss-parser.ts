import { createHash } from 'crypto'
import RSSParser from 'rss-parser'
import { FEEDS, type FeedConfig } from './feeds.config'

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
  httpStatus: number | null
  errorMessage: string | null
  responseTimeMs: number
}

export interface FetchAllFeedsResult {
  items: ParsedItem[]
  sourceResults: SourceFeedResult[]
}

// ── Ключевые слова для русскоязычных источников с широкой тематикой ──────────

const RU_AI_KEYWORDS: string[] = [
  'искусственный интеллект',
  'нейросеть',
  'нейросети',
  'машинное обучение',
  'языковая модель',
  'генеративный',
  'chatgpt',
  'gpt',
  'llm',
  'ии ',
  ' ии',
  'яндекс gpt',
  'gigachat',
  'сбер ai',
  'claude',
  'gemini',
  'mistral',
  'нейронная сеть',
  'автоматизация',
  'компьютерное зрение',
]

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
 * Декодирует HTML-entities в текстовых полях из RSS.
 */
export function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&#(\d+);/g, (_, code: string) =>
      String.fromCharCode(parseInt(code, 10))
    )
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

  return { items: allItems, sourceResults }
}

/**
 * Парсит фид с одним retry при ошибке.
 */
async function parseFeedWithRetry(
  parser: RSSParser,
  feed: FeedConfig,
  cutoff: Date
): Promise<{ items: ParsedItem[]; sourceResult: SourceFeedResult }> {
  try {
    return await parseFeed(parser, feed, cutoff)
  } catch {
    await new Promise(r => setTimeout(r, 3_000))
    return parseFeed(parser, feed, cutoff)
  }
}

/**
 * Парсит один RSS-фид и фильтрует элементы по свежести и ключевым словам.
 */
async function parseFeed(
  parser: RSSParser,
  feed: FeedConfig,
  cutoff: Date
): Promise<{ items: ParsedItem[]; sourceResult: SourceFeedResult }> {
  const ts = () => new Date().toTimeString().slice(0, 8)
  const startedAt = Date.now()

  const sourceResult: SourceFeedResult = {
    sourceName: feed.name,
    feedUrl: feed.url,
    status: 'failed',
    itemsSeen: 0,
    itemsReturned: 0,
    httpStatus: null,
    errorMessage: null,
    responseTimeMs: 0,
  }

  try {
    const feedData = await parser.parseURL(feed.url)
    sourceResult.responseTimeMs = Date.now() - startedAt

    const items = feedData.items.slice(0, 20)
    sourceResult.itemsSeen = items.length

    const result: ParsedItem[] = []

    for (const item of items) {
      const rawDate = item.isoDate ?? item.pubDate
      const pubDate = rawDate ? new Date(rawDate) : null
      if (!pubDate || isNaN(pubDate.getTime()) || pubDate < cutoff) continue

      const url = item.link ?? item.guid
      if (!url) continue

      if (feed.lang === 'ru' && feed.needsKeywordFilter && !hasDateInUrl(url)) {
        continue
      }

      if (feed.needsKeywordFilter) {
        const searchText = [
          item.title ?? '',
          item.contentSnippet ?? item.content ?? '',
        ]
          .join(' ')
          .toLowerCase()

        const keywordList = feed.keywords ?? RU_AI_KEYWORDS
        const hasKeyword = keywordList.some((kw) => searchText.includes(kw))
        if (!hasKeyword) continue
      }

      const rawTitle = item.title ?? 'Без заголовка'
      const rawSnippet = item.contentSnippet ?? item.content ?? item.summary ?? ''

      const originalTitle = decodeHtmlEntities(rawTitle)
      const snippet = decodeHtmlEntities(rawSnippet).slice(0, 300)
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
    sourceResult.status = result.length === 0 ? 'empty' : 'ok'

    console.log(
      `[${ts()}] ${feed.name}: получено ${items.length} записей, отфильтровано ${result.length}`
    )

    return { items: result, sourceResult }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    sourceResult.responseTimeMs = Date.now() - startedAt
    sourceResult.errorMessage = message
    console.error(`[${new Date().toTimeString().slice(0, 8)}] Ошибка фида "${feed.name}": ${message}`)
    return { items: [], sourceResult }
  }
}
