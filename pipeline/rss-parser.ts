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
  // Паттерны: /2024/01/, /20240115/, /2024-01-15/
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
 * Lowercase + убрать пунктуацию + trim.
 */
export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^\wа-яёa-z0-9\s]/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Простая транслитерация кириллицы → латиница для slug.
 */
function transliterate(text: string): string {
  const map: Record<string, string> = {
    а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'yo',
    ж: 'zh', з: 'z', и: 'i', й: 'j', к: 'k', л: 'l', м: 'm',
    н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u',
    ф: 'f', х: 'kh', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'shch',
    ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
  }
  return text
    .toLowerCase()
    .split('')
    .map((ch) => map[ch] ?? ch)
    .join('')
}

/**
 * Генерирует URL-slug из русского заголовка + последние 6 символов id.
 * Максимум 80 символов.
 */
export function generateSlug(ruTitle: string, id: string): string {
  const suffix = id.slice(-6)
  const base = transliterate(ruTitle)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 73) // 80 - 1 (дефис) - 6 (суффикс)

  return `${base}-${suffix}`
}

// ── Основная функция парсинга ─────────────────────────────────────────────────

/**
 * Формирует простой дедуп-хэш из нормализованного заголовка.
 * При желании можно усилить crypto.createHash('md5').
 */
function buildDedupHash(title: string, url: string): string {
  const normalized = normalizeTitle(title)
  // Простой хэш: длина + первые 64 символа + длина url
  // Достаточно для MVP; для продакшена заменить на MD5/SHA256
  return `${normalized.slice(0, 64)}_${url.length}`
}

/**
 * Парсит все RSS-фиды и возвращает список свежих AI-новостей.
 *
 * @param maxAgeMinutes - максимальный возраст публикации в минутах (по умолчанию 60)
 */
export async function fetchAllFeeds(maxAgeMinutes = 60): Promise<ParsedItem[]> {
  const parser = new RSSParser({
    headers: {
      'User-Agent':
        'Mozilla/5.0 (compatible; MalakhovAIDigestBot/1.0; +https://news.malakhovai.ru)',
    },
    timeout: 10_000, // 10 секунд на фид
  })

  const cutoff = new Date(Date.now() - maxAgeMinutes * 60 * 1000)

  // Парсим все фиды параллельно; один сломанный фид не валит весь запуск
  const results = await Promise.allSettled(
    FEEDS.map((feed) => parseFeed(parser, feed, cutoff))
  )

  const allItems: ParsedItem[] = []

  for (const result of results) {
    if (result.status === 'fulfilled') {
      allItems.push(...result.value)
    }
    // Ошибки уже залогированы внутри parseFeed
  }

  return allItems
}

/**
 * Парсит один RSS-фид и фильтрует элементы по свежести и ключевым словам.
 */
async function parseFeed(
  parser: RSSParser,
  feed: FeedConfig,
  cutoff: Date
): Promise<ParsedItem[]> {
  const ts = () => new Date().toTimeString().slice(0, 8)

  try {
    const feedData = await parser.parseURL(feed.url)
    const items = feedData.items.slice(0, 20) // берём не более 20 последних

    const result: ParsedItem[] = []

    for (const item of items) {
      // ── Проверка свежести ────────────────────────────────────────────────
      // isoDate — нормализованная дата от rss-parser; pubDate — сырая строка из фида
      const rawDate = item.isoDate ?? item.pubDate
      const pubDate = rawDate ? new Date(rawDate) : null
      if (!pubDate || isNaN(pubDate.getTime()) || pubDate < cutoff) continue

      const url = item.link ?? item.guid
      if (!url) continue

      // ── Фильтр вечнозелёных страниц для ru-источников ───────────────────
      if (feed.lang === 'ru' && feed.needsKeywordFilter && !hasDateInUrl(url)) {
        continue
      }

      // ── Ключевые слова для широких ru-источников ─────────────────────────
      if (feed.needsKeywordFilter) {
        const searchText = [
          item.title ?? '',
          item.contentSnippet ?? item.content ?? '',
        ]
          .join(' ')
          .toLowerCase()

        const hasKeyword = RU_AI_KEYWORDS.some((kw) => searchText.includes(kw))
        if (!hasKeyword) continue
      }

      // ── Сборка элемента ───────────────────────────────────────────────────
      const rawTitle = item.title ?? 'Без заголовка'
      const rawSnippet = item.contentSnippet ?? item.content ?? item.summary ?? ''

      const originalTitle = decodeHtmlEntities(rawTitle)
      const snippet = decodeHtmlEntities(rawSnippet).slice(0, 300)
      const dedupHash = buildDedupHash(originalTitle, url)

      result.push({
        originalUrl: url,
        originalTitle,
        snippet,
        pubDate: pubDate.toISOString(),
        sourceName: feed.name,
        sourceLang: feed.lang,
        topics: feed.topics,
        dedupHash,
      })
    }

    console.log(
      `[${ts()}] ${feed.name}: получено ${items.length} записей, отфильтровано ${result.length}`
    )

    return result
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`[${new Date().toTimeString().slice(0, 8)}] Ошибка фида "${feed.name}": ${message}`)
    return []
  }
}
