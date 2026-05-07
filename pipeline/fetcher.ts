/**
 * pipeline/fetcher.ts
 *
 * Загружает полный текст статьи, og:image, таблицы, inline-картинки и embed-видео.
 * Не бросает исключения.
 */

import { JSDOM, VirtualConsole } from 'jsdom'
import { Readability } from '@mozilla/readability'
import type { ErrorCode } from './types'

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
  title?: string | null
  caption?: string | null
  width?: number | null
  height?: number | null
  parentClassName?: string | null
  parentId?: string | null
  parentHref?: string | null
  nearestFigureClassName?: string | null
  nearestFigureId?: string | null
  source?: 'inline'
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
  errorCode?: Extract<ErrorCode,
    | 'fetch_404'
    | 'fetch_5xx'
    | 'fetch_timeout'
    | 'fetch_aborted'
    | 'fetch_too_large'
    | 'fetch_empty'
    | 'fetch_blocked'
    | 'fetch_unknown'
  >
  errorMessage?: string
}

interface FetchArticleOptions {
  includeText?: boolean
}

function ts(): string {
  return new Date().toTimeString().slice(0, 8)
}

export function extractOgImage(document: Document, baseUrl: string): string | null {
  try {
    const candidates = [
      'meta[property="og:image:secure_url"]',
      'meta[property="og:image:url"]',
      'meta[property="og:image"]',
      'meta[name="og:image"]',
      'meta[name="twitter:image"]',
      'meta[name="twitter:image:src"]',
      'link[rel="image_src"]',
    ]

    for (const selector of candidates) {
      const element = document.querySelector(selector)
      const value = (element?.getAttribute('content') ?? element?.getAttribute('href'))?.trim()
      if (!value) continue

      const absolute = absolutizeUrl(value, baseUrl)
      if (absolute) return absolute
    }

    return null
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

function imageValueToUrl(value: unknown, baseUrl: string): string | null {
  if (!value) return null
  if (typeof value === 'string') return absolutizeUrl(value, baseUrl)
  if (Array.isArray(value)) {
    for (const item of value) {
      const url = imageValueToUrl(item, baseUrl)
      if (url) return url
    }
    return null
  }
  if (typeof value === 'object') {
    const object = value as Record<string, unknown>
    return imageValueToUrl(object.url ?? object.contentUrl ?? object['@id'], baseUrl)
  }
  return null
}

function findJsonLdImage(value: unknown, baseUrl: string, depth = 0): string | null {
  if (!value || depth > 4) return null
  if (Array.isArray(value)) {
    for (const item of value) {
      const url = findJsonLdImage(item, baseUrl, depth + 1)
      if (url) return url
    }
    return null
  }
  if (typeof value !== 'object') return null

  const object = value as Record<string, unknown>
  const direct = imageValueToUrl(object.image, baseUrl)
  if (direct) return direct

  return findJsonLdImage(object['@graph'], baseUrl, depth + 1)
}

export function extractJsonLdImage(document: Document, baseUrl: string): string | null {
  try {
    const scripts = document.querySelectorAll('script[type="application/ld+json"]')
    for (const script of scripts) {
      const raw = script.textContent?.trim()
      if (!raw) continue

      try {
        const parsed = JSON.parse(raw)
        const url = findJsonLdImage(parsed, baseUrl)
        if (url) return url
      } catch {
        continue
      }
    }
  } catch {
    return null
  }

  return null
}

function firstSrcFromSrcset(srcset: string): string | null {
  return srcset
    .split(',')
    .map((part) => part.trim().split(/\s+/)[0])
    .find(Boolean) ?? null
}

function pickImageSrc(img: Element): string {
  const direct =
    img.getAttribute('src') ??
    img.getAttribute('data-src') ??
    img.getAttribute('data-lazy-src') ??
    img.getAttribute('data-original') ??
    ''
  if (direct.trim()) return direct

  const srcset = img.getAttribute('srcset') ?? img.getAttribute('data-srcset') ?? ''
  const firstSrc = firstSrcFromSrcset(srcset)
  if (firstSrc) return firstSrc

  const pictureSource = img.closest('picture')?.querySelector('source[srcset], source[data-srcset]')
  const pictureSrcset = pictureSource?.getAttribute('srcset') ?? pictureSource?.getAttribute('data-srcset') ?? ''

  return firstSrcFromSrcset(pictureSrcset) ?? ''
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
    const selector = ARTICLE_BODY_SELECTORS.map((sel) => `${sel} img`).join(', ')
    const imgs = document.querySelectorAll(selector)
    const seen = new Set<string>()

    imgs.forEach((img) => {
      if (isInsideExcludedRegion(img)) return
      if (img.closest('button, [role="button"], a[class*="share" i], a[class*="social" i], [class*="share" i], [class*="social" i]')) return

      const src = pickImageSrc(img)
      const alt = img.getAttribute('alt')?.trim() ?? ''
      const title = img.getAttribute('title')?.trim() || null

      if (!src) return
      if (src.startsWith('data:')) return
      if (/\.svg(?:[?#]|$)/i.test(src)) return

      const w = parseInt(img.getAttribute('width') ?? '0', 10)
      const h = parseInt(img.getAttribute('height') ?? '0', 10)
      if ((w > 0 && w < 50) || (h > 0 && h < 50)) return
      if (/pixel|tracking|beacon|logo|icon|avatar|badge|sprite|share[-_.]|social[-_.]|arrow[-_.]|button[-_.]/i.test(src)) return

      const absoluteSrc = absolutizeUrl(src, baseUrl)
      if (!absoluteSrc) return
      if (seen.has(absoluteSrc)) return

      const parent = img.parentElement
      const parentLink = img.closest('a')
      const figure = img.closest('figure')
      const caption = figure?.querySelector('figcaption')?.textContent?.trim() || null

      seen.add(absoluteSrc)
      images.push({
        src: absoluteSrc,
        alt,
        title,
        caption,
        width: Number.isFinite(w) && w > 0 ? w : null,
        height: Number.isFinite(h) && h > 0 ? h : null,
        parentClassName: parent?.getAttribute('class') ?? null,
        parentId: parent?.getAttribute('id') ?? null,
        parentHref: parentLink?.getAttribute('href') ?? null,
        nearestFigureClassName: figure?.getAttribute('class') ?? null,
        nearestFigureId: figure?.getAttribute('id') ?? null,
        source: 'inline',
      })
    })
  } catch { /* некритично */ }
  return images.slice(0, 5)
}

function pickFallbackCoverFromInlineImages(inlineImages: ExtractedImage[]): string | null {
  for (const image of inlineImages) {
    const width = Number(image.width ?? 0)
    const height = Number(image.height ?? 0)

    if ((width > 0 && width < 80) || (height > 0 && height < 80)) continue
    if (width > 0 && height > 0 && width / height >= 2.8) continue

    return image.src
  }

  return null
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
    const tagName = cursor.tagName?.toLowerCase()
    if (tagName && /^(aside|nav|footer|header)$/.test(tagName)) return true

    const className = (cursor.getAttribute?.('class') ?? '').toLowerCase()
    const id = (cursor.getAttribute?.('id') ?? '').toLowerCase()
    if (/(?:sidebar|aside|related|recommend|comment|footer|promo|advert|banner|career|jobs|byline|author|profile|avatar|\bad[-_])/i.test(className)) return true
    if (/(?:sidebar|aside|related|recommend|comment|footer|promo|advert|banner|career|jobs|byline|author|profile|avatar|\bad[-_])/i.test(id)) return true
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

function emptyFetchResult(errorCode: NonNullable<FetchedContent['errorCode']>, errorMessage: string): FetchedContent {
  return {
    text: '',
    imageUrl: null,
    tables: [],
    inlineImages: [],
    inlineVideos: [],
    errorCode,
    errorMessage,
  }
}

export function normalizeHttpFetchErrorCode(status: number): NonNullable<FetchedContent['errorCode']> {
  if (status === 404) return 'fetch_404'
  if (status >= 500 && status <= 599) return 'fetch_5xx'
  if ([401, 403, 429, 451].includes(status)) return 'fetch_blocked'
  return 'fetch_unknown'
}

export function normalizeThrownFetchErrorCode(error: unknown, timedOut: boolean): NonNullable<FetchedContent['errorCode']> {
  if (timedOut) return 'fetch_timeout'
  if (error instanceof Error) {
    const name = error.name.toLowerCase()
    const message = error.message.toLowerCase()
    if (name.includes('timeout') || message.includes('timeout') || message.includes('timed out')) {
      return 'fetch_timeout'
    }
    if (name.includes('abort') || message.includes('abort')) {
      return 'fetch_aborted'
    }
  }
  return 'fetch_unknown'
}

function looksBlocked(document: Document, html: string): boolean {
  const title = document.querySelector('title')?.textContent ?? ''
  const bodyText = document.body?.textContent ?? ''
  const sample = `${title}\n${bodyText}`.slice(0, 3_000)
  return /cloudflare|just a moment|attention required|access denied|captcha|checking your browser|enable javascript|unusual traffic/i.test(sample) ||
    /cf-browser-verification|cf-challenge|g-recaptcha|hcaptcha/i.test(html.slice(0, 20_000))
}

export async function fetchArticleContent(
  url: string,
  options: FetchArticleOptions = {},
): Promise<FetchedContent> {
  const { includeText = true } = options
  const controller = new AbortController()
  let timedOut = false
  const timeoutId = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, FETCH_TIMEOUT_MS)

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
      return emptyFetchResult(normalizeHttpFetchErrorCode(response.status), message)
    }

    const contentLength = Number(response.headers.get('content-length') ?? 0)
    if (contentLength > MAX_HTML_BYTES) {
      const message = `html too large: ${contentLength}`
      console.log(`[${ts()}] fetchArticleContent: ${message} [${url.slice(0, 60)}]`)
      return emptyFetchResult('fetch_too_large', message)
    }

    const contentType = response.headers.get('content-type') ?? ''
    if (!contentType.includes('html') && !contentType.includes('xml')) {
      const message = `not html: ${contentType || 'missing content-type'}`
      console.log(`[${ts()}] fetchArticleContent: ${message} [${url.slice(0, 60)}]`)
      return emptyFetchResult('fetch_unknown', message)
    }

    const html = await response.text()
    const htmlBytes = Buffer.byteLength(html, 'utf8')
    if (htmlBytes > MAX_HTML_BYTES) {
      const message = `html too large: ${htmlBytes}`
      console.log(`[${ts()}] fetchArticleContent: ${message} [${url.slice(0, 60)}]`)
      return emptyFetchResult('fetch_too_large', message)
    }

    const virtualConsole = new VirtualConsole()
    virtualConsole.on('jsdomError', () => undefined)
    const dom = new JSDOM(html, { url, virtualConsole })
    const document = dom.window.document

    const tables = extractTables(document)
    const inlineImages = extractInlineImages(document, url)
    const inlineVideos = extractInlineVideos(document, url)
    const imageUrl = extractOgImage(document, url) ??
      extractJsonLdImage(document, url) ??
      pickFallbackCoverFromInlineImages(inlineImages)

    if (looksBlocked(document, html) && (includeText || (!imageUrl && inlineImages.length === 0))) {
      const message = `blocked or challenge page for ${url}`
      console.log(`[${ts()}] fetchArticleContent: ${message}`)
      return emptyFetchResult('fetch_blocked', message)
    }

    const text = includeText ? extractReadableTextFromDocument(document) : ''

    if (includeText && !text) {
      const message = `empty readable text for ${url}`
      console.log(`[${ts()}] fetchArticleContent: ${message}`)
      return emptyFetchResult('fetch_empty', message)
    }

    console.log(
      `[${ts()}] fetchArticleContent: text=${text.length}ч, image=${imageUrl ? 'есть' : 'нет'}` +
      ` tables=${tables.length} imgs=${inlineImages.length} videos=${inlineVideos.length} [${url.slice(0, 60)}]`
    )

    return { text, imageUrl, tables, inlineImages, inlineVideos }
  } catch (error) {
    clearTimeout(timeoutId)
    const message = error instanceof Error ? error.message : String(error)
    const errorCode = normalizeThrownFetchErrorCode(error, timedOut)
    console.log(`[${ts()}] fetchArticleContent: ошибка — ${message} [${url.slice(0, 60)}]`)
    return emptyFetchResult(errorCode, message)
  }
}
