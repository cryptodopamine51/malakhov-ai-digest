import { NextResponse } from 'next/server'
import { getArticleUrl } from '../../lib/article-slugs'
import { getArticlesForNewsSitemap } from '../../lib/articles'
import { SITE_NAME, SITE_URL } from '../../lib/site'

// Google News sitemap protocol:
// https://developers.google.com/search/docs/crawling-indexing/sitemaps/news-sitemap
//
// Rules:
// - max 1000 URLs;
// - publication_date within the last 2 days;
// - separate from the main sitemap.xml (still referenced from robots.txt).
//
// ISR: re-generate every 10 minutes so freshly published articles surface in
// Google News quickly without burning function invocations per request.
export const revalidate = 600

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

export async function GET() {
  const articles = await getArticlesForNewsSitemap(48, 1000)

  const items = articles
    .filter((article) => article.slug && article.primaryCategory && article.title && article.pub_date)
    .map((article) => {
      const loc = getArticleUrl(SITE_URL, article.slug, article.primaryCategory)
      const publicationDate = new Date(article.pub_date).toISOString()
      return [
        '  <url>',
        `    <loc>${escapeXml(loc)}</loc>`,
        '    <news:news>',
        '      <news:publication>',
        `        <news:name>${escapeXml(SITE_NAME)}</news:name>`,
        '        <news:language>ru</news:language>',
        '      </news:publication>',
        `      <news:publication_date>${publicationDate}</news:publication_date>`,
        `      <news:title>${escapeXml(article.title)}</news:title>`,
        '    </news:news>',
        '  </url>',
      ].join('\n')
    })
    .join('\n')

  const body = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"',
    '        xmlns:news="http://www.google.com/schemas/sitemap-news/0.9">',
    items,
    '</urlset>',
    '',
  ].join('\n')

  return new NextResponse(body, {
    headers: {
      'content-type': 'application/xml; charset=utf-8',
      'cache-control': 'public, s-maxage=600, stale-while-revalidate=86400',
    },
  })
}
