export const SITE_URL = 'https://news.malakhovai.ru'
export const SITE_HOST = 'news.malakhovai.ru'
export const SITE_NAME = 'Malakhov AI Дайджест'
export const SITE_DESCRIPTION =
  'Русскоязычный редакционный дайджест об искусственном интеллекте: релизы, исследования, продукты, инвестиции и AI-рынок.'

export function absoluteUrl(path = '/'): string {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`
  return `${SITE_URL}${normalizedPath}`
}
