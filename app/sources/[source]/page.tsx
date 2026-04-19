import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { getSourceNameBySlug, getAllSourceSlugs, getArticlesBySource } from '../../../lib/articles'
import ArticleCard from '../../../src/components/ArticleCard'

export const revalidate = 3600

export async function generateStaticParams() {
  return getAllSourceSlugs()
}

export async function generateMetadata({
  params,
}: {
  params: { source: string }
}): Promise<Metadata> {
  const name = await getSourceNameBySlug(params.source)
  if (!name) return {}
  return {
    title: `${name} — источник`,
    description: `Все материалы из источника ${name} на Malakhov AI Дайджест.`,
  }
}

export default async function SourcePage({
  params,
}: {
  params: { source: string }
}) {
  const sourceName = await getSourceNameBySlug(params.source)
  if (!sourceName) notFound()

  const articles = await getArticlesBySource(sourceName, 24)

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <nav className="mb-6 flex items-center gap-2 text-sm text-muted">
        <a href="/sources" className="hover:text-accent transition-colors">Источники</a>
        <span>→</span>
        <span>{sourceName}</span>
      </nav>

      <div className="mb-8">
        <h1 className="text-2xl font-bold text-[#e5e5e5]">{sourceName}</h1>
        <p className="mt-1 text-sm text-muted">
          {articles.length} материалов
        </p>
      </div>

      {articles.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-muted">
          <span className="text-4xl mb-3">📡</span>
          <p className="text-lg">Статьи из этого источника появятся совсем скоро</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3">
          {articles.map((article) => (
            <ArticleCard key={article.id} article={article} variant="default" />
          ))}
        </div>
      )}
    </div>
  )
}
