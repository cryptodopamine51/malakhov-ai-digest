import type { Metadata } from 'next'
import Link from 'next/link'
import { searchArticlesByQuery } from '../../lib/articles'
import { SITE_URL, absoluteUrl } from '../../lib/site'
import ArticleFeedList from '../../src/components/ArticleFeedList'

// /search reads ?q=... so it is intentionally dynamic. We do not cache it on
// the Vercel CDN — it is fine for navigational queries and SearchAction.
export const dynamic = 'force-dynamic'

const PAGE_TITLE = 'Поиск по статьям'
const PAGE_DESCRIPTION = 'Поиск по новостям и обзорам Malakhov AI Дайджест.'

export const metadata: Metadata = {
  title: PAGE_TITLE,
  description: PAGE_DESCRIPTION,
  alternates: { canonical: '/search' },
  // Search-result pages are not indexable per Google's guidance for thin
  // search UIs (`noindex, follow` is the recommendation). The /search URL
  // itself is still discoverable via WebSite.potentialAction.
  robots: { index: false, follow: true },
  openGraph: {
    title: PAGE_TITLE,
    description: PAGE_DESCRIPTION,
    url: absoluteUrl('/search'),
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: PAGE_TITLE,
    description: PAGE_DESCRIPTION,
  },
  other: {
    'twitter:url': absoluteUrl('/search'),
  },
}

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>
}) {
  const resolvedSearchParams = await searchParams
  const query = (resolvedSearchParams.q ?? '').trim()
  const results = query ? await searchArticlesByQuery(query, 30) : []

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 md:py-10 lg:py-12">
      <h1 className="mb-2 font-serif text-3xl font-bold text-ink md:text-4xl">
        {PAGE_TITLE}
      </h1>
      <p className="mb-6 max-w-2xl text-sm leading-relaxed text-muted md:text-base">
        Введите запрос, чтобы найти статьи по заголовку, лиду или тексту.
      </p>

      <form action="/search" method="get" className="mb-10 flex max-w-2xl gap-2">
        <input
          type="search"
          name="q"
          defaultValue={query}
          placeholder="Например: OpenAI, RAG, инвестиции в ИИ"
          className="flex-1 rounded border border-line bg-base px-3 py-2 text-sm text-ink outline-none focus:border-ink"
          aria-label="Поисковый запрос"
          required
          minLength={2}
          maxLength={200}
        />
        <button
          type="submit"
          className="rounded border border-ink bg-ink px-4 py-2 text-sm font-medium text-base transition-opacity hover:opacity-90"
        >
          Найти
        </button>
      </form>

      {!query && (
        <p className="text-sm text-muted">
          Подсказки: «GPT», «инвестиции», «российский ИИ», «agentic», «Anthropic».
        </p>
      )}

      {query && results.length === 0 && (
        <p className="text-sm text-muted">
          По запросу «{query}» ничего не найдено. Попробуйте другой запрос или вернитесь{' '}
          <Link href="/" className="text-accent hover:underline">на главную</Link>.
        </p>
      )}

      {results.length > 0 && (
        <>
          <p className="mb-5 text-sm text-muted">
            Найдено {results.length}. Запрос: «{query}».
          </p>
          <ArticleFeedList articles={results} featuredFirst={false} />
        </>
      )}

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            '@context': 'https://schema.org',
            '@type': 'SearchResultsPage',
            url: `${SITE_URL}/search${query ? `?q=${encodeURIComponent(query)}` : ''}`,
            name: PAGE_TITLE,
            description: PAGE_DESCRIPTION,
          }),
        }}
      />
    </div>
  )
}
