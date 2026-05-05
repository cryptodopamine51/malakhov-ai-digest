export const SITE_URL = 'https://news.malakhovai.ru'
export const SITE_HOST = 'news.malakhovai.ru'
export const SITE_NAME = 'Malakhov AI Дайджест'
export const SITE_DESCRIPTION =
  'Русскоязычный редакционный дайджест об искусственном интеллекте: релизы, исследования, продукты, инвестиции и AI-рынок.'

export function absoluteUrl(path = '/'): string {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`
  return `${SITE_URL}${normalizedPath}`
}

// Reads a site-URL env value defensively: strips surrounding whitespace
// (including the trailing \n that Vercel UI silently injects when you press
// Enter inside the value field — incident 2026-05-04, broke TG digest links),
// strips trailing slashes, and rejects values that don't look like an http(s)
// URL. Returns '' for unset/empty so callers can keep their preflight branches.
export function readSiteUrlFromEnv(envValue: string | undefined): string {
  const raw = (envValue ?? '').trim()
  if (!raw) return ''
  const cleaned = raw.replace(/\/+$/, '')
  if (!/^https?:\/\/[^\s]+$/.test(cleaned)) {
    throw new Error(
      `NEXT_PUBLIC_SITE_URL is malformed: ${JSON.stringify(envValue)} — expected http(s)://host with no whitespace`,
    )
  }
  return cleaned
}
