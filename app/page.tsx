import Link from 'next/link'
import { getTopTodayArticles, getArticlesFeed } from '../lib/articles'
import ArticleCard from '../src/components/ArticleCard'

export const dynamic = 'force-dynamic'

const PER_PAGE = 12

export default async function HomePage({
  searchParams,
}: {
  searchParams: { page?: string }
}) {
  const page = Math.max(1, parseInt(searchParams.page ?? '1', 10) || 1)

  const [topToday, { articles: feed, total }] = await Promise.all([
    page === 1 ? getTopTodayArticles(7) : Promise.resolve([]),
    getArticlesFeed(page, PER_PAGE),
  ])

  const today = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long' }).format(new Date())
  const totalPages = Math.ceil(total / PER_PAGE)

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      {/* Топ сегодня — только на первой странице */}
      {page === 1 && topToday.length > 0 && (
        <section className="mb-10">
          <div className="mb-4 flex items-baseline gap-3">
            <h1 className="text-xl font-bold text-[#e5e5e5]">Топ за сегодня</h1>
            <span className="text-sm text-muted">{today}</span>
          </div>

          {/* Первая статья — широкая */}
          {topToday[0] && (
            <div className="mb-4">
              <ArticleCard article={topToday[0]} variant="featured" />
            </div>
          )}

          {/* Остальные — сетка */}
          {topToday.length > 1 && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3">
              {topToday.slice(1).map((article) => (
                <ArticleCard key={article.id} article={article} variant="default" />
              ))}
            </div>
          )}
        </section>
      )}

      {/* Все новости */}
      <section>
        <div className="mb-4 flex items-baseline gap-3">
          <h2 className="text-xl font-bold text-[#e5e5e5]">
            {page === 1 ? 'Все новости' : `Все новости — страница ${page}`}
          </h2>
          {total > 0 && (
            <span className="text-sm text-muted">{total} материалов</span>
          )}
        </div>

        {feed.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-muted">
            <span className="text-4xl mb-3">📡</span>
            <p className="text-lg">Статьи появятся совсем скоро</p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3">
              {feed.map((article) => (
                <ArticleCard key={article.id} article={article} variant="default" />
              ))}
            </div>

            {/* Пагинация */}
            {totalPages > 1 && (
              <div className="mt-8 flex items-center justify-center gap-2">
                {page > 1 && (
                  <Link
                    href={page === 2 ? '/' : `/?page=${page - 1}`}
                    className="rounded-md px-4 py-2 text-sm text-muted border border-white/10 hover:border-accent/40 hover:text-[#e5e5e5] transition-colors"
                  >
                    ← Назад
                  </Link>
                )}

                <span className="px-3 py-2 text-sm text-muted">
                  {page} / {totalPages}
                </span>

                {page < totalPages && (
                  <Link
                    href={`/?page=${page + 1}`}
                    className="rounded-md px-4 py-2 text-sm text-muted border border-white/10 hover:border-accent/40 hover:text-[#e5e5e5] transition-colors"
                  >
                    Вперёд →
                  </Link>
                )}
              </div>
            )}
          </>
        )}
      </section>

      {/* Ссылки на архив */}
      <div className="mt-10 flex gap-4 text-sm text-muted">
        <Link href={`/archive/${getYesterdayDate()}`} className="hover:text-accent transition-colors">
          ← Вчера
        </Link>
        <Link href={`/archive/${getDayBeforeDate()}`} className="hover:text-accent transition-colors">
          ← Позавчера
        </Link>
      </div>
    </div>
  )
}

function getYesterdayDate(): string {
  const d = new Date()
  d.setDate(d.getDate() - 1)
  return d.toISOString().slice(0, 10)
}

function getDayBeforeDate(): string {
  const d = new Date()
  d.setDate(d.getDate() - 2)
  return d.toISOString().slice(0, 10)
}
