import { getServerClient } from '../../lib/supabase'
import { getArticleUrl } from '../../lib/article-slugs'

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? 'https://news.malakhovai.ru').replace(/\/$/, '')
const FEED_URL = `${SITE_URL}/rss.xml`
const SITE_TITLE = 'Malakhov AI Дайджест'
const SITE_DESCRIPTION = 'Русскоязычный редакционный дайджест новостей об искусственном интеллекте.'

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

export async function GET() {
  const client = getServerClient()
  const { data, error } = await client
    .from('articles')
    .select('slug, ru_title, original_title, lead, card_teaser, source_name, topics, primary_category, pub_date, created_at, updated_at')
    .eq('published', true)
    .eq('quality_ok', true)
    .eq('verified_live', true)
    .eq('publish_status', 'live')
    .not('slug', 'is', null)
    .order('pub_date', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })
    .limit(50)

  if (error) {
    return new Response('Failed to generate RSS feed', { status: 500 })
  }

  const items = (data ?? []).map((article) => {
    const title = article.ru_title ?? article.original_title ?? 'Без названия'
    const articleUrl = getArticleUrl(SITE_URL, article.slug as string, article.primary_category as string | null)
    const pubDate = new Date(article.pub_date ?? article.created_at).toUTCString()
    const teaser = article.card_teaser ?? article.lead ?? ''
    const source = article.source_name ? `Источник: ${article.source_name}. ` : ''
    const categories = (article.topics ?? [])
      .map((topic: string) => `<category>${escapeXml(topic)}</category>`)
      .join('')

    return `
      <item>
        <title>${escapeXml(title)}</title>
        <link>${articleUrl}</link>
        <guid isPermaLink="true">${articleUrl}</guid>
        <pubDate>${pubDate}</pubDate>
        <description>${escapeXml(`${source}${teaser}`.trim())}</description>
        ${categories}
      </item>
    `.trim()
  })

  const lastBuildDate = new Date(
    (data ?? [])[0]?.updated_at ?? (data ?? [])[0]?.pub_date ?? (data ?? [])[0]?.created_at ?? Date.now()
  ).toUTCString()
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${SITE_TITLE}</title>
    <link>${SITE_URL}</link>
    <description>${SITE_DESCRIPTION}</description>
    <language>ru-RU</language>
    <lastBuildDate>${lastBuildDate}</lastBuildDate>
    <ttl>15</ttl>
    <generator>Next.js</generator>
    <atom:link href="${FEED_URL}" rel="self" type="application/rss+xml" />
    ${items.join('\n    ')}
  </channel>
</rss>`

  return new Response(xml, {
    headers: {
      'Content-Type': 'application/rss+xml; charset=utf-8',
      'Cache-Control': 's-maxage=900, stale-while-revalidate=3600',
    },
  })
}
