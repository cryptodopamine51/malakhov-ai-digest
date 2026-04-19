import type { MetadataRoute } from 'next'
import { getAllSlugs } from '../../lib/articles'

const BASE_URL = 'https://news.malakhovai.ru'

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const slugs = await getAllSlugs()

  const staticRoutes: MetadataRoute.Sitemap = [
    { url: `${BASE_URL}/`,                    changeFrequency: 'hourly', priority: 1.0 },
    { url: `${BASE_URL}/russia`,              changeFrequency: 'hourly', priority: 0.9 },
    { url: `${BASE_URL}/topics/ai-research`,  changeFrequency: 'daily',  priority: 0.7 },
    { url: `${BASE_URL}/topics/ai-labs`,      changeFrequency: 'daily',  priority: 0.7 },
    { url: `${BASE_URL}/topics/ai-industry`,  changeFrequency: 'daily',  priority: 0.7 },
    { url: `${BASE_URL}/topics/coding`,       changeFrequency: 'daily',  priority: 0.7 },
  ]

  const articleRoutes: MetadataRoute.Sitemap = slugs.map((slug) => ({
    url: `${BASE_URL}/articles/${slug}`,
    changeFrequency: 'weekly',
    priority: 0.6,
  }))

  return [...staticRoutes, ...articleRoutes]
}
