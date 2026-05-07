import Link from 'next/link'
import type { Metadata } from 'next'
import { getSourcesStats, sourceNameToSlug } from '../../lib/articles'
import { absoluteUrl } from '../../lib/site'
import { pluralize } from '../../lib/utils'

export const revalidate = 3600

export const metadata: Metadata = {
  title: 'Источники новостей об ИИ',
  description: 'Все источники, которые мы отслеживаем — международные и российские медиа об искусственном интеллекте.',
  alternates: { canonical: '/sources' },
  openGraph: {
    title: 'Источники новостей об ИИ',
    description: 'Все источники, которые мы отслеживаем — международные и российские медиа об искусственном интеллекте.',
    type: 'website',
    url: absoluteUrl('/sources'),
  },
  other: {
    'twitter:url': absoluteUrl('/sources'),
  },
}

const SOURCE_DOMAINS: Record<string, string> = {
  'VentureBeat AI': 'venturebeat.com',
  'The Verge AI': 'theverge.com',
  'The Decoder': 'the-decoder.com',
  'TechCrunch AI': 'techcrunch.com',
  'TechCrunch Venture': 'techcrunch.com',
  'TechCrunch Startups': 'techcrunch.com',
  'ZDNet AI': 'zdnet.com',
  'Wired AI': 'wired.com',
  'Ars Technica': 'arstechnica.com',
  'MIT Technology Review AI': 'technologyreview.com',
  'OpenAI News': 'openai.com',
  'AWS Machine Learning Blog': 'aws.amazon.com',
  'Microsoft Blogs': 'blogs.microsoft.com',
  'NVIDIA Blog': 'blogs.nvidia.com',
  'Google Research Blog': 'research.google',
  'Google DeepMind Blog': 'deepmind.google',
  'Hugging Face Blog': 'huggingface.co',
  '404 Media': '404media.co',
  'YC Blog': 'ycombinator.com',
  'Crunchbase News': 'news.crunchbase.com',
  'Sequoia Capital': 'sequoiacap.com',
  'Habr AI': 'habr.com',
  'Habr Startups': 'habr.com',
  'CNews': 'cnews.ru',
  'RB.ru': 'rb.ru',
  'vc.ru AI/стартапы': 'vc.ru',
}

const SOURCE_LANG: Record<string, 'EN' | 'RU'> = {
  'Habr AI': 'RU',
  'Habr Startups': 'RU',
  'CNews': 'RU',
  'RB.ru': 'RU',
  'vc.ru AI/стартапы': 'RU',
}


export default async function SourcesPage() {
  const sources = await getSourcesStats()

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 md:py-10">
      <div className="mb-8">
        <h1 className="font-serif text-2xl font-bold text-ink">Источники</h1>
        <p className="mt-1 text-sm text-muted">
          {sources.length} источников — международные и российские медиа об ИИ
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {sources.map((source) => {
          const slug = sourceNameToSlug(source.source_name)
          const domain = SOURCE_DOMAINS[source.source_name]
          const faviconUrl = domain
            ? `https://www.google.com/s2/favicons?sz=32&domain=${domain}`
            : null
          const lang = SOURCE_LANG[source.source_name] ?? 'EN'

          return (
            <Link key={source.source_name} href={`/sources/${slug}`} className="group block">
              <article className="h-full rounded border border-line bg-base p-5 transition-all hover:-translate-y-0.5 hover:shadow-sm">
                <div className="flex items-center gap-3 mb-3">
                  {faviconUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={faviconUrl} alt="" width={20} height={20} className="rounded-sm opacity-80" />
                  ) : (
                    <div className="w-5 h-5 rounded-sm bg-accent/20" />
                  )}
                  <h2 className="min-w-0 flex-1 truncate text-base font-semibold text-ink">
                    {source.source_name}
                  </h2>
                  <span className="flex-shrink-0 rounded-sm border border-line px-1.5 py-0.5 text-xs text-muted">
                    {lang}
                  </span>
                </div>

                <p className="text-xs text-muted mb-3">{source.count} {pluralize(source.count, 'материал', 'материала', 'материалов')}</p>

                {source.latest_titles.length > 0 && (
                  <ul className="space-y-1">
                    {source.latest_titles.map((title, i) => (
                      <li key={i} className="border-l border-line pl-2 text-xs text-muted line-clamp-1">
                        {title}
                      </li>
                    ))}
                  </ul>
                )}
              </article>
            </Link>
          )
        })}
      </div>
    </div>
  )
}
