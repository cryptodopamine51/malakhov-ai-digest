import { notFound } from 'next/navigation'
import Link from 'next/link'
import type { Metadata } from 'next'
import { getArticlesByDate } from '../../../lib/articles'
import ArticleCard from '../../../src/components/ArticleCard'

export const revalidate = 3600

export async function generateMetadata({
  params,
}: {
  params: { date: string }
}): Promise<Metadata> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(params.date)) return {}

  const formatted = new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date(params.date + 'T12:00:00'))

  return {
    title: `AI новости за ${formatted}`,
    description: `Все материалы об искусственном интеллекте за ${formatted} на Malakhov AI Дайджест.`,
  }
}

export default async function ArchivePage({
  params,
}: {
  params: { date: string }
}) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(params.date)) notFound()

  const articles = await getArticlesByDate(params.date)

  const formatted = new Intl.DateTimeFormat('ru-RU', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date(params.date + 'T12:00:00'))

  const prev = offsetDate(params.date, -1)
  const next = offsetDate(params.date, +1)
  const todayStr = new Date().toISOString().slice(0, 10)

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <nav className="mb-6 flex items-center gap-2 text-sm text-muted">
        <Link href="/" className="hover:text-accent transition-colors">Главная</Link>
        <span>→</span>
        <span>Архив</span>
        <span>→</span>
        <span className="capitalize">{formatted}</span>
      </nav>

      <div className="mb-8 flex flex-wrap items-baseline gap-4">
        <h1 className="text-2xl font-bold text-[#e5e5e5] capitalize">{formatted}</h1>
        {articles.length > 0 && (
          <span className="text-sm text-muted">{articles.length} материалов</span>
        )}
      </div>

      {articles.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-muted">
          <span className="text-4xl mb-3">📅</span>
          <p className="text-lg">За этот день материалов нет</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3">
          {articles.map((article) => (
            <ArticleCard key={article.id} article={article} variant="default" />
          ))}
        </div>
      )}

      <div className="mt-10 flex items-center justify-between text-sm text-muted border-t border-white/10 pt-5">
        <Link href={`/archive/${prev}`} className="hover:text-accent transition-colors">
          ← {formatShort(prev)}
        </Link>
        {next <= todayStr && (
          <Link href={`/archive/${next}`} className="hover:text-accent transition-colors">
            {formatShort(next)} →
          </Link>
        )}
      </div>
    </div>
  )
}

function offsetDate(dateStr: string, days: number): string {
  const d = new Date(dateStr + 'T12:00:00')
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

function formatShort(dateStr: string): string {
  return new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long' }).format(
    new Date(dateStr + 'T12:00:00')
  )
}
