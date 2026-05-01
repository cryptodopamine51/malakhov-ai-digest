/**
 * pipeline/fetcher.ts
 *
 * Загружает полный текст статьи, og:image, таблицы, inline-картинки и embed-видео.
 * Не бросает исключения.
 */

import { JSDOM, VirtualConsole } from 'jsdom'
import { Readability } from '@mozilla/readability'

const FETCH_TIMEOUT_MS = 15_000
const MAX_TEXT_LENGTH = 8_000
const MAX_HTML_BYTES = 2_000_000

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

export interface ExtractedVideo {
  provider: 'youtube' | 'vimeo' | 'rutube' | 'vk' | 'direct'
  embedUrl: string
  sourceUrl: string
  title: string | null
  poster: string | null
}

export interface FetchedContent {
  text: string
  imageUrl: string | null
  tables: ExtractedTable[]
  inlineImages: ExtractedImage[]
  inlineVideos: ExtractedVideo[]
  errorCode?: 'fetch_failed' | 'fetch_timeout'
  errorMessage?: string
}

interface FetchArticleOptions {
  includeText?: boolean
}

function ts(): string {
  return new Date().toTimeString().slice(0, 8)
}

function extractOgImage(document: Document): string | null {
  try {
    return document.querySelector('meta[property="og:image"]')?.getAttribute('content')?.trim() || null
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

function absolutizeUrl(rawUrl: string, baseUrl: string): string | null {
  const value = rawUrl.trim()
  if (!value || value.startsWith('data:') || value.startsWith('javascript:')) return null

  try {
    if (value.startsWith('//')) return `https:${value}`
    return new URL(value, baseUrl).toString()
  } catch {
    return null
  }
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

      const w = parseInt(img.getAttribute('width') ?? '0', 10)
      const h = parseInt(img.getAttribute('height') ?? '0', 10)
      if ((w > 0 && w < 50) || (h > 0 && h < 50)) return
      if (/pixel|tracking|beacon|logo|icon|avatar|badge/i.test(src)) return

      const absoluteSrc = absolutizeUrl(src, baseUrl)
      if (!absoluteSrc) return

      seen.add(src)
      images.push({ src: absoluteSrc, alt })
    })
  } catch { /* некритично */ }
  return images.slice(0, 5)
}

function normalizeVideo(rawUrl: string, baseUrl: string): Omit<ExtractedVideo, 'title' | 'poster'> | null {
  const absoluteUrl = absolutizeUrl(rawUrl, baseUrl)
  if (!absoluteUrl) return null

  const url = absoluteUrl.toLowerCase()

  if (url.includes('youtube.com/embed/') || url.includes('youtube-nocookie.com/embed/')) {
    return { provider: 'youtube', embedUrl: absoluteUrl, sourceUrl: absoluteUrl }
  }

  const youtubeId = absoluteUrl.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([^?&/]+)/i)?.[1]
  if (youtubeId) {
    return {
      provider: 'youtube',
      embedUrl: `https://www.youtube.com/embed/${youtubeId}`,
      sourceUrl: absoluteUrl,
    }
  }

  if (url.includes('player.vimeo.com/video/')) {
    return { provider: 'vimeo', embedUrl: absoluteUrl, sourceUrl: absoluteUrl }
  }

  const vimeoId = absoluteUrl.match(/vimeo\.com\/(\d+)/i)?.[1]
  if (vimeoId) {
    return {
      provider: 'vimeo',
      embedUrl: `https://player.vimeo.com/video/${vimeoId}`,
      sourceUrl: absoluteUrl,
    }
  }

  if (url.includes('rutube.ru/play/embed/')) {
    return { provider: 'rutube', embedUrl: absoluteUrl, sourceUrl: absoluteUrl }
  }

  const rutubeId = absoluteUrl.match(/rutube\.ru\/video\/([a-z0-9]+)/i)?.[1]
  if (rutubeId) {
    return {
      provider: 'rutube',
      embedUrl: `https://rutube.ru/play/embed/${rutubeId}`,
      sourceUrl: absoluteUrl,
    }
  }

  if (
    url.includes('vk.com/video_ext.php') ||
    url.includes('player.vk.com/video_ext.php') ||
    url.includes('vkvideo.ru/video_ext.php')
  ) {
    return { provider: 'vk', embedUrl: absoluteUrl, sourceUrl: absoluteUrl }
  }

  if (/\.(mp4|webm|ogg)(?:[?#].*)?$/i.test(absoluteUrl)) {
    return { provider: 'direct', embedUrl: absoluteUrl, sourceUrl: absoluteUrl }
  }

  return null
}

// Селекторы контейнеров «тела статьи». Хабр, vc.ru, RB.ru, ТАСС используют
// собственные классы — без них iframe-ы из article-body теряются и в БД нет видео.
const ARTICLE_BODY_SELECTORS = [
  'article',
  'main',
  '.content',
  '.post',
  '[class*="article"]',
  '[class*="content"]',
  // Habr
  '.tm-article-body',
  '.article-formatted-body',
  '[class*="tm-article"]',
  // vc.ru / DTF / TJ (один движок)
  '.content--full',
  '[class*="content--"]',
  // RB.ru
  '.s-news__text',
  '.b-article__text',
  // Habr Q&A / classic
  '.post__text',
  '[class*="js-mediator-article"]',
] as const

const KNOWN_VIDEO_HOST_RE =
  /(?:youtube\.com|youtu\.be|youtube-nocookie\.com|player\.vimeo\.com|vimeo\.com|rutube\.ru|vk\.com\/video_ext|player\.vk\.com|vkvideo\.ru)/i

function isInsideExcludedRegion(node: Element): boolean {
  // Скрываем sidebar/related/comments — они не часть статьи.
  let cursor: Element | null = node
  while (cursor) {
    const className = (cursor.getAttribute?.('class') ?? '').toLowerCase()
    const id = (cursor.getAttribute?.('id') ?? '').toLowerCase()
    if (/sidebar|aside|related|recommend|comment|footer|promo|advert|ad-/.test(className)) return true
    if (/sidebar|aside|related|recommend|comment|footer|promo|advert|ad-/.test(id)) return true
    cursor = cursor.parentElement
  }
  return false
}

function extractInlineVideos(document: Document, baseUrl: string): ExtractedVideo[] {
  const videos: ExtractedVideo[] = []
  const seen = new Set<string>()

  try {
    const iframeSelector = ARTICLE_BODY_SELECTORS.map((sel) => `${sel} iframe`).join(', ')
    const containerIframes = Array.from(document.querySelectorAll(iframeSelector))

    // Fallback: если контейнерных iframe-ов нет, берём ВСЕ iframe на странице,
    // но фильтруем по known video host (YouTube/Rutube/VK/Vimeo) и исключаем
    // sidebar/related/comments. Это покрывает источники с нестандартной разметкой
    // (RB.ru, ТАСС) без рисков притянуть рекламу.
    const candidateIframes = containerIframes.length > 0
      ? containerIframes
      : Array.from(document.querySelectorAll('iframe')).filter((iframe) => {
          const src = (iframe.getAttribute('src') ?? iframe.getAttribute('data-src') ?? '')
          return KNOWN_VIDEO_HOST_RE.test(src) && !isInsideExcludedRegion(iframe)
        })

    candidateIframes.forEach((iframe) => {
      const rawSrc =
        iframe.getAttribute('src') ??
        iframe.getAttribute('data-src') ??
        iframe.getAttribute('data-lazy-src') ??
        ''

      const normalized = normalizeVideo(rawSrc, baseUrl)
      if (!normalized || seen.has(normalized.embedUrl)) return

      seen.add(normalized.embedUrl)
      videos.push({
        ...normalized,
        title: iframe.getAttribute('title')?.trim() || null,
        poster: null,
      })
    })

    const videoSelector = ARTICLE_BODY_SELECTORS.map((sel) => `${sel} video`).join(', ')
    document.querySelectorAll(videoSelector).forEach((video) => {
      const directSrc =
        video.getAttribute('src') ??
        video.querySelector('source')?.getAttribute('src') ??
        ''

      const normalized = normalizeVideo(directSrc, baseUrl)
      if (!normalized || seen.has(normalized.embedUrl)) return

      seen.add(normalized.embedUrl)
      videos.push({
        ...normalized,
        title: video.getAttribute('title')?.trim() || null,
        poster: video.getAttribute('poster')?.trim() || null,
      })
    })
  } catch { /* некритично */ }

  return videos.slice(0, 2)
}

function extractReadableTextFromDocument(document: Document): string {
  try {
    const reader = new Readability(document.cloneNode(true) as Document)
    const article = reader.parse()
    const raw = (article?.textContent ?? '').replace(/\s+/g, ' ').trim()
    const cleaned = cleanText(raw)
    return cleaned.slice(0, MAX_TEXT_LENGTH).replace(/\s[^.!?]*$/, '')
  } catch {
    return ''
  }
}

export async function fetchArticleContent(
  url: string,
  options: FetchArticleOptions = {},
): Promise<FetchedContent> {
  const { includeText = true } = options
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
      const message = `HTTP ${response.status} for ${url}`
      console.log(`[${ts()}] fetchArticleContent: ${message}`)
      return {
        text: '',
        imageUrl: null,
        tables: [],
        inlineImages: [],
        inlineVideos: [],
        errorCode: 'fetch_failed',
        errorMessage: message,
      }
    }

    const contentLength = Number(response.headers.get('content-length') ?? 0)
    if (contentLength > MAX_HTML_BYTES) {
      const message = `html too large: ${contentLength}`
      console.log(`[${ts()}] fetchArticleContent: ${message} [${url.slice(0, 60)}]`)
      return {
        text: '',
        imageUrl: null,
        tables: [],
        inlineImages: [],
        inlineVideos: [],
        errorCode: 'fetch_failed',
        errorMessage: message,
      }
    }

    const contentType = response.headers.get('content-type') ?? ''
    if (!contentType.includes('html') && !contentType.includes('xml')) {
      const message = `not html: ${contentType || 'missing content-type'}`
      console.log(`[${ts()}] fetchArticleContent: ${message} [${url.slice(0, 60)}]`)
      return {
        text: '',
        imageUrl: null,
        tables: [],
        inlineImages: [],
        inlineVideos: [],
        errorCode: 'fetch_failed',
        errorMessage: message,
      }
    }

    const html = await response.text()
    const virtualConsole = new VirtualConsole()
    virtualConsole.on('jsdomError', () => undefined)
    const dom = new JSDOM(html, { url, virtualConsole })
    const document = dom.window.document

    const imageUrl = extractOgImage(document)
    const text = includeText ? extractReadableTextFromDocument(document) : ''
    const tables = extractTables(document)
    const inlineImages = extractInlineImages(document, url)
    const inlineVideos = extractInlineVideos(document, url)

    console.log(
      `[${ts()}] fetchArticleContent: text=${text.length}ч, image=${imageUrl ? 'есть' : 'нет'}` +
      ` tables=${tables.length} imgs=${inlineImages.length} videos=${inlineVideos.length} [${url.slice(0, 60)}]`
    )

    return { text, imageUrl, tables, inlineImages, inlineVideos }
  } catch (error) {
    clearTimeout(timeoutId)
    const message = error instanceof Error ? error.message : String(error)
    console.log(`[${ts()}] fetchArticleContent: ошибка — ${message} [${url.slice(0, 60)}]`)
    return {
      text: '',
      imageUrl: null,
      tables: [],
      inlineImages: [],
      inlineVideos: [],
      errorCode: message.toLowerCase().includes('abort') ? 'fetch_timeout' : 'fetch_failed',
      errorMessage: message,
    }
  }
}
