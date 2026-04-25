import type { MetadataRoute } from 'next'
import { getArticleUrl } from '../lib/article-slugs'
import { getAllArticlesForSitemap } from '../lib/articles'

const BASE_URL = 'https://news.malakhovai.ru'

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const articles = await getAllArticlesForSitemap()

  const staticRoutes: MetadataRoute.Sitemap = [
    { url: `${BASE_URL}/`,                              changeFrequency: 'hourly', priority: 1.0 },
    { url: `${BASE_URL}/russia`,                        changeFrequency: 'hourly', priority: 0.9 },
    { url: `${BASE_URL}/categories/ai-industry`,        changeFrequency: 'daily',  priority: 0.8 },
    { url: `${BASE_URL}/categories/ai-research`,        changeFrequency: 'daily',  priority: 0.7 },
    { url: `${BASE_URL}/categories/ai-labs`,            changeFrequency: 'daily',  priority: 0.7 },
    { url: `${BASE_URL}/categories/ai-investments`,     changeFrequency: 'daily',  priority: 0.7 },
    { url: `${BASE_URL}/categories/ai-startups`,        changeFrequency: 'daily',  priority: 0.7 },
    { url: `${BASE_URL}/categories/ai-russia`,          changeFrequency: 'daily',  priority: 0.7 },
    { url: `${BASE_URL}/categories/coding`,             changeFrequency: 'daily',  priority: 0.7 },
    { url: `${BASE_URL}/sources`,                       changeFrequency: 'weekly', priority: 0.5 },
  ]

  const articleRoutes: MetadataRoute.Sitemap = articles.map(({ slug, primaryCategory, updated_at }) => ({
    url: getArticleUrl(BASE_URL, slug, primaryCategory),
    lastModified: new Date(updated_at),
    changeFrequency: 'weekly',
    priority: 0.6,
  }))

  return [...staticRoutes, ...articleRoutes]
}
