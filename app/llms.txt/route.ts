const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? 'https://news.malakhovai.ru').replace(/\/$/, '')

export async function GET() {
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
    `- Темы: ${SITE_URL}/topics/ai-industry, ${SITE_URL}/topics/ai-research, ${SITE_URL}/topics/ai-labs, ${SITE_URL}/topics/ai-investments, ${SITE_URL}/topics/ai-startups, ${SITE_URL}/topics/ai-russia, ${SITE_URL}/topics/coding`,
    `- Источники: ${SITE_URL}/sources`,
    '',
    '## Формат URL',
    '',
    `- Статьи: ${SITE_URL}/articles/<slug>`,
    `- Архив по дате: ${SITE_URL}/archive/YYYY-MM-DD`,
    '',
    '## Машиночитаемые точки входа',
    '',
    `- Sitemap: ${SITE_URL}/sitemap.xml`,
    `- RSS: ${SITE_URL}/rss.xml`,
    '',
    '## Рекомендации по использованию',
    '',
    '- Для свежих публикаций сначала смотрите RSS.',
    '- Для цитирования используйте саму страницу статьи: там есть лид, краткое summary и ссылка на первоисточник.',
    '- Если нужен первоисточник, на странице статьи он указан явно в блоке "Источник".',
    '',
  ].join('\n')

  return new Response(content, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 's-maxage=3600, stale-while-revalidate=86400',
    },
  })
}
