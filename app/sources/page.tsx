import Link from 'next/link'
import type { Metadata } from 'next'
import { getSourcesStats, sourceNameToSlug } from '../../lib/articles'

export const revalidate = 3600

export const metadata: Metadata = {
  title: 'Источники новостей об ИИ',
  description: 'Все источники, которые мы отслеживаем — международные и российские медиа об искусственном интеллекте.',
}

const SOURCE_DOMAINS: Record<string, string> = {
  'VentureBeat AI': 'venturebeat.com',
  'The Verge AI': 'theverge.com',
  'The Decoder': 'the-decoder.com',
  'TechCrunch AI': 'techcrunch.com',
  'TechCrunch Venture': 'techcrunch.com',
  'ZDNet AI': 'zdnet.com',
  'Wired AI': 'wired.com',
  'Ars Technica': 'arstechnica.com',
  'MIT Technology Review AI': 'technologyreview.com',
  'OpenAI News': 'openai.com',
  'Google Research Blog': 'research.google',
  'Hugging Face Blog': 'huggingface.co',
  '404 Media': '404media.co',
  'Axios Pro Rata': 'axios.com',
  'YC Blog': 'ycombinator.com',
  'a16z Blog': 'a16z.com',
  'Habr AI': 'habr.com',
  'CNews': 'cnews.ru',
  'vc.ru': 'vc.ru',
  'vc.ru Финансы': 'vc.ru',
  'vc.ru Стартапы': 'vc.ru',
}

const SOURCE_LANG: Record<string, 'EN' | 'RU'> = {
  'Habr AI': 'RU',
  'CNews': 'RU',
  'vc.ru': 'RU',
  'vc.ru Финансы': 'RU',
  'vc.ru Стартапы': 'RU',
}

function pluralCount(n: number): string {
  if (n === 1) return `${n} материал`
  if (n >= 2 && n <= 4) return `${n} материала`
  return `${n} материалов`
}

export default async function SourcesPage() {
  const sources = await getSourcesStats()

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-[#e5e5e5]">Источники</h1>
        <p className="mt-1 text-sm text-muted">
          {sources.length} источников — международные и российские медиа об ИИ
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3">
        {sources.map((source) => {
          const slug = sourceNameToSlug(source.source_name)
          const domain = SOURCE_DOMAINS[source.source_name]
          const faviconUrl = domain
            ? `https://www.google.com/s2/favicons?sz=32&domain=${domain}`
            : null
          const lang = SOURCE_LANG[source.source_name] ?? 'EN'

          return (
            <Link key={source.source_name} href={`/sources/${slug}`} className="group block">
              <article className="h-full rounded-xl border border-white/5 bg-surface p-5 hover:bg-[#222222] hover:border-accent/20 transition-colors">
                <div className="flex items-center gap-3 mb-3">
                  {faviconUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={faviconUrl} alt="" width={20} height={20} className="rounded-sm opacity-80" />
                  ) : (
                    <div className="w-5 h-5 rounded-sm bg-accent/20" />
                  )}
                  <h2 className="text-base font-semibold text-[#e5e5e5] group-hover:text-white transition-colors flex-1 min-w-0 truncate">
                    {source.source_name}
                  </h2>
                  <span className="flex-shrink-0 rounded px-1.5 py-0.5 text-xs font-medium bg-white/5 text-muted">
                    {lang}
                  </span>
                </div>

                <p className="text-xs text-muted mb-3">{pluralCount(source.count)}</p>

                {source.latest_titles.length > 0 && (
                  <ul className="space-y-1">
                    {source.latest_titles.map((title, i) => (
                      <li key={i} className="text-xs text-muted line-clamp-1 pl-2 border-l border-white/10">
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
