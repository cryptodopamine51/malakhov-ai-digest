/**
 * IndexNow — single-protocol ping for Yandex / Bing.
 *
 * Speeds up search-engine indexing of newly published articles. Without this,
 * Yandex / Google find new URLs only when they decide to re-crawl the sitemap,
 * which on a young news domain can take 1-3 days. IndexNow turns that into
 * minutes-to-hours.
 *
 * The endpoint `https://api.indexnow.org/indexnow` propagates pings to all
 * participating engines (Yandex, Bing, Naver, Seznam). Google does NOT
 * participate; it learns about new URLs through sitemap + crawl budget.
 *
 * Soft-fail by design: a missing key, a non-2xx response or a transport error
 * never blocks the publish path. We log and move on.
 */

const ENDPOINT = 'https://api.indexnow.org/indexnow'
const TIMEOUT_MS = 5_000
const HOST = 'news.malakhovai.ru'
const KEY_LOCATION = `https://${HOST}/indexnow.txt`
const MAX_URLS_PER_PING = 100

export interface IndexNowResult {
  ok: boolean
  status: number | null
  pinged: number
  skipped?: 'no_key' | 'no_urls'
  errorMessage?: string
}

export async function pingIndexNow(urls: string[]): Promise<IndexNowResult> {
  const key = process.env.INDEXNOW_KEY?.trim()
  if (!key) return { ok: false, status: null, pinged: 0, skipped: 'no_key' }

  const unique = Array.from(new Set(urls.map((url) => url.trim()).filter(Boolean))).slice(0, MAX_URLS_PER_PING)
  if (unique.length === 0) return { ok: false, status: null, pinged: 0, skipped: 'no_urls' }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)

  try {
    const response = await fetch(ENDPOINT, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify({
        host: HOST,
        key,
        keyLocation: KEY_LOCATION,
        urlList: unique,
      }),
    })
    clearTimeout(timer)
    const ok = response.status >= 200 && response.status < 300
    return { ok, status: response.status, pinged: unique.length }
  } catch (error) {
    clearTimeout(timer)
    return {
      ok: false,
      status: null,
      pinged: 0,
      errorMessage: error instanceof Error ? error.message : String(error),
    }
  }
}
