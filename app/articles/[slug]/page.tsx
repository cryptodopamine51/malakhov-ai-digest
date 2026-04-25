/**
 * app/articles/[slug]/page.tsx
 *
 * Legacy URL `/articles/<slug>`. После волны 2.2 настоящая страница статьи живёт по
 * `/categories/<primary>/<slug>`. Этот route оставлен только как 301-редирект,
 * чтобы не сломать SEO/закладки/внешние ссылки.
 */

import { notFound, permanentRedirect } from 'next/navigation'
import { getArticleBySlug } from '../../../lib/articles'
import { getArticlePath, toPublicArticleSlug } from '../../../lib/article-slugs'

export const revalidate = 3600

export default async function LegacyArticlePage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const article = await getArticleBySlug(slug)
  if (!article || article.quality_ok !== true) notFound()

  const publicSlug = article.slug ? toPublicArticleSlug(article.slug) : slug
  permanentRedirect(getArticlePath(publicSlug, article.primary_category))
}
