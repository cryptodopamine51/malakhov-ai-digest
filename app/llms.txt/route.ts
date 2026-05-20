import { getAllGuides, getGuideAbsoluteUrl } from '../../lib/guides'
import { getLatestArticles } from '../../lib/articles'
import { getArticlePath } from '../../lib/article-slugs'
import { SITE_URL } from '../../lib/site'

export const revalidate = 3600

const CATEGORIES: Array<{ slug: string; label: string; path: string }> = [
  { slug: 'ai-industry',   label: 'AI индустрия',            path: '/categories/ai-industry' },
  { slug: 'ai-research',   label: 'AI исследования',         path: '/categories/ai-research' },
  { slug: 'ai-labs',       label: 'AI лаборатории',          path: '/categories/ai-labs' },
  { slug: 'ai-investments',label: 'AI инвестиции',           path: '/categories/ai-investments' },
  { slug: 'ai-startups',   label: 'AI стартапы',             path: '/categories/ai-startups' },
  { slug: 'ai-russia',     label: 'AI в России',             path: '/russia' },
  { slug: 'coding',        label: 'Код / разработка',        path: '/categories/coding' },
]

export async function GET() {
  const guides = getAllGuides()
  const recent = await getLatestArticles(35)

  // Bucket the last 35 articles into categories so each cluster has a few
  // concrete examples for LLM context.
  const articlesByCategory = new Map<string, Array<{ title: string; url: string }>>()
  for (const article of recent) {
    if (!article.slug) continue
    const cat = article.primary_category ?? 'ai-industry'
    const bucket = articlesByCategory.get(cat) ?? []
    if (bucket.length >= 4) continue
    bucket.push({
      title: (article.ru_title ?? article.original_title ?? '').trim(),
      url: `${SITE_URL}${getArticlePath(article.slug, article.primary_category)}`,
    })
    articlesByCategory.set(cat, bucket)
  }

  const content = [
    '# Malakhov AI Дайджест',
    '',
    '> Русскоязычный редакционный дайджест об искусственном интеллекте.',
    '',
    '## Что это',
    '',
    'Сайт публикует отредактированные на русском языке материалы о релизах, исследованиях, продуктах, стартапах, инвестициях и российском AI-рынке.',
    'Каждая статья обычно содержит заголовок, лид, краткие тезисы, основной текст, ссылку на первоисточник и тематические метки.',
    '',
    '## Основные разделы',
    '',
    `- Главная: ${SITE_URL}/`,
    `- Россия: ${SITE_URL}/russia`,
    `- Гайды: ${SITE_URL}/guides`,
    `- Источники: ${SITE_URL}/sources`,
    `- Поиск: ${SITE_URL}/search`,
    '',
    '## Тематические кластеры (категории + 3–4 свежих примера)',
    '',
    ...CATEGORIES.flatMap(({ slug, label, path }) => {
      const examples = articlesByCategory.get(slug) ?? []
      const lines = [`### ${label}`, `URL: ${SITE_URL}${path}`]
      if (examples.length > 0) {
        for (const example of examples) {
          lines.push(`- ${example.title} — ${example.url}`)
        }
      }
      lines.push('')
      return lines
    }),
    '## Топ-материалы (evergreen-гайды)',
    '',
    ...guides.flatMap((guide) => {
      const description = (guide.description ?? '').replace(/\s+/g, ' ').trim()
      return [
        `- [${guide.title}](${getGuideAbsoluteUrl(guide)})${description ? ' — ' + description : ''}`,
      ]
    }),
    '',
    '## Формат URL',
    '',
    `- Статьи: ${SITE_URL}/categories/<category>/<slug>`,
    `- Архив по дате: ${SITE_URL}/archive/YYYY-MM-DD (noindex)`,
    `- Гайды: ${SITE_URL}/guides/<slug>`,
    '',
    '## Машиночитаемые точки входа',
    '',
    `- Sitemap: ${SITE_URL}/sitemap.xml`,
    `- Google News sitemap: ${SITE_URL}/news-sitemap.xml`,
    `- RSS: ${SITE_URL}/rss.xml`,
    `- Full LLM dump: ${SITE_URL}/llms-full.txt`,
    '',
    '## Рекомендации по использованию',
    '',
    '- Для свежих публикаций сначала смотрите RSS или Google News sitemap.',
    '- Для полнотекстового контекста — `/llms-full.txt`.',
    '- Для цитирования используйте саму страницу статьи: там есть лид, краткое summary и ссылка на первоисточник.',
    '- Если нужен первоисточник, на странице статьи он указан явно в блоке "Источник".',
    '',
  ].join('\n')

  return new Response(content, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400',
    },
  })
}
