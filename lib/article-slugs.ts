/**
 * lib/article-slugs.ts
 *
 * Канонический builder URL-ов статьи.
 * После волны 2.2 публичный URL — `/categories/<primary>/<slug>`.
 * Старые `/articles/<slug>` оставлены только как редирект-точка (см. `app/articles/[slug]`).
 */

import { DEFAULT_CATEGORY } from './categories'

const LEGACY_HEX_SUFFIX_RE = /-{1,2}[a-f0-9]{6}$/i

export function toPublicArticleSlug(slug: string): string {
  return slug.replace(LEGACY_HEX_SUFFIX_RE, '')
}

export function getArticlePath(slug: string, primaryCategory: string | null | undefined): string {
  const safeSlug = toPublicArticleSlug(slug)
  const safeCategory = primaryCategory && primaryCategory.length > 0 ? primaryCategory : DEFAULT_CATEGORY
  return `/categories/${safeCategory}/${safeSlug}`
}

export function getArticleUrl(siteUrl: string, slug: string, primaryCategory: string | null | undefined): string {
  const base = siteUrl.replace(/\/$/, '')
  return `${base}${getArticlePath(slug, primaryCategory)}`
}

/**
 * Legacy URL `/articles/<slug>` без категории. Используется только в редирект-логике
 * (старая ссылка снаружи) и в SEO-инструментах для построения redirect-target из
 * текущей записи статьи. Не использовать как основной builder для новых поверхностей.
 */
export function getLegacyArticlePath(slug: string): string {
  return `/articles/${toPublicArticleSlug(slug)}`
}
