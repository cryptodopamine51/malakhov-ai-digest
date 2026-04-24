import { notFound } from 'next/navigation'
import Link from 'next/link'
import type { Metadata } from 'next'
import { getArticlesByDate } from '../../../lib/articles'
import { formatMoscowDate, getMoscowDateKey, shiftMoscowDateKey, pluralize } from '../../../lib/utils'
import ArticleCard from '../../../src/components/ArticleCard'

export const revalidate = 3600

export async function generateMetadata({
  params,
}: {
  params: Promise<{ date: string }>
}): Promise<Metadata> {
  const { date } = await params
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return {}

  const formatted = formatMoscowDate(date, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })

  return {
    title: `AI новости за ${formatted}`,
    description: `Все материалы об искусственном интеллекте за ${formatted} на Malakhov AI Дайджест.`,
  }
}

export default async function ArchivePage({
  params,
}: {
  params: Promise<{ date: string }>
}) {
  const { date } = await params
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) notFound()

  const articles = await getArticlesByDate(date)

  const formatted = formatMoscowDate(date, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })

  const prev = offsetDate(date, -1)
  const next = offsetDate(date, +1)
  const todayStr = getMoscowTodayDate()

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 md:py-10">
      <nav className="mb-6 flex items-center gap-2 text-sm text-muted">
        <Link href="/" className="transition-colors hover:text-ink">Главная</Link>
        <span>→</span>
        <span>Архив</span>
        <span>→</span>
        <span className="capitalize">{formatted}</span>
      </nav>

      <div className="mb-8 flex flex-wrap items-baseline gap-4">
        <h1 className="font-serif text-2xl font-bold text-ink capitalize">{formatted}</h1>
        {articles.length > 0 && (
          <span className="text-sm text-muted">{articles.length} {pluralize(articles.length, 'материал', 'материала', 'материалов')}</span>
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

      <div className="mt-10 flex items-center justify-between border-t border-line pt-5 text-sm text-muted">
        <Link href={`/archive/${prev}`} className="transition-colors hover:text-ink">
          ← {formatShort(prev)}
        </Link>
        {next <= todayStr && (
          <Link href={`/archive/${next}`} className="transition-colors hover:text-ink">
            {formatShort(next)} →
          </Link>
        )}
      </div>
    </div>
  )
}

function offsetDate(dateStr: string, days: number): string {
  return shiftMoscowDateKey(dateStr, days)
}

function formatShort(dateStr: string): string {
  return formatMoscowDate(dateStr, { day: 'numeric', month: 'long' })
}

function getMoscowTodayDate(): string {
  return getMoscowDateKey()
}
