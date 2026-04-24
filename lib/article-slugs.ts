const LEGACY_HEX_SUFFIX_RE = /-{1,2}[a-f0-9]{6}$/i

export function toPublicArticleSlug(slug: string): string {
  return slug.replace(LEGACY_HEX_SUFFIX_RE, '')
}

export function getArticlePath(slug: string): string {
  return `/articles/${toPublicArticleSlug(slug)}`
}

export function getArticleUrl(siteUrl: string, slug: string): string {
  const base = siteUrl.replace(/\/$/, '')
  return `${base}${getArticlePath(slug)}`
}
