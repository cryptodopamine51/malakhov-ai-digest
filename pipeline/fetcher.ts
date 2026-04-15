/**
 * pipeline/fetcher.ts
 *
 * Загружает полный текст статьи и og:image со страницы по URL.
 * При любой ошибке возвращает пустые значения — не бросает исключения.
 */

import { parse as parseHtml } from 'node-html-parser'
import { JSDOM } from 'jsdom'
import { Readability } from '@mozilla/readability'

// ── Константы ─────────────────────────────────────────────────────────────────

const FETCH_TIMEOUT_MS = 15_000
const MAX_TEXT_LENGTH = 2_000

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) ' +
  'AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

// ── Типы ──────────────────────────────────────────────────────────────────────

export interface FetchedContent {
  text: string
  imageUrl: string | null
}

// ── Вспомогательные функции ───────────────────────────────────────────────────

function ts(): string {
  return new Date().toTimeString().slice(0, 8)
}

/**
 * Извлекает og:image из HTML-строки.
 * Использует node-html-parser — быстрее jsdom для простых мета-тегов.
 */
function extractOgImage(html: string): string | null {
  try {
    const root = parseHtml(html)
    const meta = root.querySelector('meta[property="og:image"]')
    const content = meta?.getAttribute('content')
    return content?.trim() || null
  } catch {
    return null
  }
}

/**
 * Извлекает основной текст статьи через @mozilla/readability + jsdom.
 * Обрезает до MAX_TEXT_LENGTH символов.
 */
function extractReadableText(html: string, url: string): string {
  try {
    const dom = new JSDOM(html, { url })
    const reader = new Readability(dom.window.document)
    const article = reader.parse()
    return (article?.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT_LENGTH)
  } catch {
    return ''
  }
}

// ── Основная функция ──────────────────────────────────────────────────────────

/**
 * Загружает страницу по URL и возвращает og:image и первые 2000 символов текста.
 * При таймауте или сетевой ошибке возвращает { text: '', imageUrl: null }.
 */
export async function fetchArticleContent(url: string): Promise<FetchedContent> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'ru-RU,ru;q=0.9,en;q=0.8',
      },
    })

    clearTimeout(timeoutId)

    if (!response.ok) {
      console.log(`[${ts()}] fetchArticleContent: HTTP ${response.status} для ${url}`)
      return { text: '', imageUrl: null }
    }

    const html = await response.text()
    const imageUrl = extractOgImage(html)
    const text = extractReadableText(html, url)

    console.log(
      `[${ts()}] fetchArticleContent: ` +
        `text=${text.length}ч, image=${imageUrl ? 'есть' : 'нет'} [${url.slice(0, 60)}]`
    )

    return { text, imageUrl }
  } catch (error) {
    clearTimeout(timeoutId)
    const message = error instanceof Error ? error.message : String(error)
    console.log(`[${ts()}] fetchArticleContent: ошибка — ${message} [${url.slice(0, 60)}]`)
    return { text: '', imageUrl: null }
  }
}
