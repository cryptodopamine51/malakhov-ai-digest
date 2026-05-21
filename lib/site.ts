export const SITE_URL = 'https://news.malakhovai.ru'
export const SITE_HOST = 'news.malakhovai.ru'
export const SITE_NAME = 'Malakhov AI Дайджест'
export const SITE_DESCRIPTION =
  'Русскоязычный редакционный дайджест об искусственном интеллекте: релизы, исследования, продукты, инвестиции и AI-рынок.'
export const SITE_LOGO_PATH = '/icon-512x512.png'
export const SITE_LOGO_URL = `${SITE_URL}${SITE_LOGO_PATH}`

// Brand social profile used in Organization JSON-LD `sameAs`. Keep this list
// in sync with the actual published channels; add x.com / youtube / github
// when they become public.
export const SITE_TELEGRAM_URL = 'https://t.me/malakhovaidigest'
export const SITE_SAME_AS: string[] = [SITE_TELEGRAM_URL]

// Editor identity for E-E-A-T signals: used by NewsArticle.author (Person),
// the AboutPage block, and Organization.founder. Keep these in sync with the
// `/about` page copy — they are the single source of truth.
export const EDITOR_NAME = 'Иван Малахов'
export const EDITOR_JOB_TITLE = 'Главный редактор Malakhov AI Дайджест'
export const EDITOR_DESCRIPTION =
  'Предприниматель, AI-архитектор и продуктовый маркетолог. 11+ лет работы на стыке маркетинга, трафика, разработки и внедрения ИИ в бизнес.'
export const EDITOR_PATH = '/about'
export const EDITOR_URL = `${SITE_URL}${EDITOR_PATH}`
// Public portrait. The file is shipped at /public/about/editor.jpg so it is
// served from the canonical news.malakhovai.ru domain. If the file is
// missing the page just renders without the portrait — JSON-LD still cites
// the URL (Google will degrade gracefully).
export const EDITOR_IMAGE_PATH = '/about/editor.jpg'
export const EDITOR_IMAGE_URL = `${SITE_URL}${EDITOR_IMAGE_PATH}`
export const EDITOR_KNOWS_ABOUT: string[] = [
  'искусственный интеллект',
  'AI в бизнесе',
  'внедрение ИИ',
  'продуктовая разработка',
  'продуктовый маркетинг',
  'трафик и реклама',
]

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
