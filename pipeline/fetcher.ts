/**
 * pipeline/fetcher.ts
 *
 * Загружает полный текст статьи, og:image, таблицы и inline-картинки. Не бросает исключения.
 */

import { parse as parseHtml } from 'node-html-parser'
import { JSDOM, VirtualConsole } from 'jsdom'
import { Readability } from '@mozilla/readability'

const FETCH_TIMEOUT_MS = 15_000
const MAX_TEXT_LENGTH = 8_000

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) ' +
  'AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

export interface ExtractedTable {
  headers: string[]
  rows: string[][]
}

export interface ExtractedImage {
  src: string
  alt: string
}

export interface FetchedContent {
  text: string
  imageUrl: string | null
  tables: ExtractedTable[]
  inlineImages: ExtractedImage[]
}

function ts(): string {
  return new Date().toTimeString().slice(0, 8)
}

function extractOgImage(html: string): string | null {
  try {
    const root = parseHtml(html)
    const meta = root.querySelector('meta[property="og:image"]')
    return meta?.getAttribute('content')?.trim() || null
  } catch {
    return null
  }
}

function cleanText(raw: string): string {
  return raw
    .replace(/Уровень сложности[А-ЯA-Z][а-яa-z]+/g, '')
    .replace(/Уровень сложности\s*\S+/g, '')
    .replace(/Время на прочтение\d+\s*мин/g, '')
    .replace(/Время на прочтение\s*\d+\s*мин/g, '')
    .replace(/Охват и читатели[\d.,]+[KkМмKк]?/g, '')
    .replace(/Охват и читатели\s*[\d.,]+\s*[KkМм]?/g, '')
    .replace(/Всего голосов\s*\d+:?\s*[+-]?\d*\s*[и]?[\s\S]{0,20}/g, '')
    .replace(/Комментарии\s*\d*/gi, '')
    .replace(/(Читать далее|Поделиться|Подписаться|В закладки)/gi, '')
    .replace(/^Читать статью на vc\.ru.*$/gm, '')
    .replace(/^Источник:?\s*CNews.*$/gm, '')
    .replace(/^Теги:.*$/gm, '')
    .split('\n')
    .filter((line, idx) => idx > 5 || line.trim().length >= 40 || line.trim().length === 0)
    .join('\n')
    .replace(/\s{3,}/g, '  ')
    .trim()
}

function extractTables(document: Document): ExtractedTable[] {
  const tables: ExtractedTable[] = []
  try {
    const tableEls = document.querySelectorAll('table')
    tableEls.forEach((table) => {
      const rows = Array.from(table.querySelectorAll('tr'))
      if (rows.length < 2) return

      const headerCells = Array.from(rows[0].querySelectorAll('th, td'))
      const headers = headerCells.map((c) => c.textContent?.trim() ?? '')
      if (headers.every((h) => h === '')) return

      const dataRows: string[][] = []
      for (let i = 1; i < rows.length; i++) {
        const cells = Array.from(rows[i].querySelectorAll('td, th'))
        const row = cells.map((c) => c.textContent?.trim() ?? '')
        if (row.some((c) => c !== '')) dataRows.push(row)
      }

      if (dataRows.length > 0) tables.push({ headers, rows: dataRows })
    })
  } catch { /* некритично */ }
  return tables
}

function extractInlineImages(document: Document, baseUrl: string): ExtractedImage[] {
  const images: ExtractedImage[] = []
  try {
    const imgs = document.querySelectorAll('article img, .content img, .post img, main img, [class*="article"] img, [class*="content"] img')
    const seen = new Set<string>()

    imgs.forEach((img) => {
      const src = img.getAttribute('src') ?? ''
      const alt = img.getAttribute('alt')?.trim() ?? ''

      if (!src || seen.has(src)) return
      if (src.startsWith('data:')) return

      // Фильтруем пиксели слежки и иконки
      const w = parseInt(img.getAttribute('width') ?? '0', 10)
      const h = parseInt(img.getAttribute('height') ?? '0', 10)
      if ((w > 0 && w < 50) || (h > 0 && h < 50)) return
      if (/pixel|tracking|beacon|logo|icon|avatar|badge/i.test(src)) return

      // Приводим относительные URL к абсолютным
      let absoluteSrc = src
      if (src.startsWith('//')) {
        absoluteSrc = 'https:' + src
      } else if (src.startsWith('/')) {
        try {
          const base = new URL(baseUrl)
          absoluteSrc = base.origin + src
        } catch { return }
      } else if (!src.startsWith('https://')) {
        return
      }

      seen.add(src)
      images.push({ src: absoluteSrc, alt })
    })
  } catch { /* некритично */ }
  return images.slice(0, 5) // не более 5 картинок
}

function extractReadableText(html: string, url: string): string {
  try {
    const virtualConsole = new VirtualConsole()
    virtualConsole.on('jsdomError', () => undefined)
    const dom = new JSDOM(html, { url, virtualConsole })
    const reader = new Readability(dom.window.document)
    const article = reader.parse()
    const raw = (article?.textContent ?? '').replace(/\s+/g, ' ').trim()
    const cleaned = cleanText(raw)
    return cleaned.slice(0, MAX_TEXT_LENGTH).replace(/\s[^.!?]*$/, '')
  } catch {
    return ''
  }
}

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
      return { text: '', imageUrl: null, tables: [], inlineImages: [] }
    }

    const html = await response.text()
    const imageUrl = extractOgImage(html)
    const text = extractReadableText(html, url)

    // Таблицы и картинки извлекаем из отдельного DOM (без Readability, который их стрипает)
    let tables: ExtractedTable[] = []
    let inlineImages: ExtractedImage[] = []
    try {
      const virtualConsole = new VirtualConsole()
      virtualConsole.on('jsdomError', () => undefined)
      const dom = new JSDOM(html, { url, virtualConsole })
      tables = extractTables(dom.window.document)
      inlineImages = extractInlineImages(dom.window.document, url)
    } catch { /* некритично */ }

    console.log(
      `[${ts()}] fetchArticleContent: text=${text.length}ч, image=${imageUrl ? 'есть' : 'нет'}` +
      ` tables=${tables.length} imgs=${inlineImages.length} [${url.slice(0, 60)}]`
    )

    return { text, imageUrl, tables, inlineImages }
  } catch (error) {
    clearTimeout(timeoutId)
    const message = error instanceof Error ? error.message : String(error)
    console.log(`[${ts()}] fetchArticleContent: ошибка — ${message} [${url.slice(0, 60)}]`)
    return { text: '', imageUrl: null, tables: [], inlineImages: [] }
  }
}
