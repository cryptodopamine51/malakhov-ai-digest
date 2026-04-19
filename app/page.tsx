import Link from 'next/link'
import { getTopTodayArticles, getArticlesFeed } from '../lib/articles'
import { getMoscowDateKey, shiftMoscowDateKey } from '../lib/utils'
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

  const today = new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric',
    month: 'long',
    timeZone: 'Europe/Moscow',
  }).format(new Date())
  const totalPages = Math.ceil(total / PER_PAGE)

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 md:py-10">
      {page === 1 && (
        <section className="mb-10 rounded border border-line bg-base px-6 py-8 md:px-8 md:py-10">
          <h1 className="font-serif text-5xl font-bold text-ink">Malakhov AI Дайджест</h1>
          <p className="mt-4 max-w-2xl text-sm leading-relaxed text-ink opacity-70 md:text-base">
            Ежедневная редакционная лента об ИИ: ключевые релизы, исследования, продукты и
            индустриальные сдвиги без визуального шума.
          </p>
        </section>
      )}

      {page === 1 && topToday.length > 0 && (
        <section className="mb-10">
          <div className="mb-4 flex items-baseline gap-3">
            <h2 className="font-serif text-3xl font-bold text-ink">Топ за сегодня</h2>
            <span className="text-sm text-muted">{today}</span>
          </div>

          {topToday[0] && (
            <div className="mb-4">
              <ArticleCard article={topToday[0]} variant="featured" />
            </div>
          )}

          {topToday.length > 1 && (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
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
          <h2 className="font-serif text-3xl font-bold text-ink">
            {page === 1 ? 'Все новости' : `Все новости — страница ${page}`}
          </h2>
          {total > 0 && (
            <span className="text-sm text-muted">{total} материалов</span>
          )}
        </div>

        {feed.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-center text-muted">
            <span className="text-4xl mb-3">📡</span>
            <p className="text-lg">Статьи появятся совсем скоро</p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              {feed.map((article) => (
                <ArticleCard key={article.id} article={article} variant="default" />
              ))}
            </div>

            {totalPages > 1 && (
              <div className="mt-8 flex items-center justify-center gap-2">
                {page > 1 && (
                  <Link
                    href={page === 2 ? '/' : `/?page=${page - 1}`}
                    className="rounded border border-line px-4 py-2 text-sm text-muted transition-colors hover:text-ink"
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
                    className="rounded border border-line px-4 py-2 text-sm text-muted transition-colors hover:text-ink"
                  >
                    Вперёд →
                  </Link>
                )}
              </div>
            )}
          </>
        )}
      </section>

      <div className="mt-10 flex gap-4 text-sm text-muted">
        <Link href={`/archive/${getYesterdayDate()}`} className="transition-colors hover:text-ink">
          ← Вчера
        </Link>
        <Link href={`/archive/${getDayBeforeDate()}`} className="transition-colors hover:text-ink">
          ← Позавчера
        </Link>
      </div>
    </div>
  )
}

function getYesterdayDate(): string {
  return getMoscowShiftedDate(-1)
}

function getDayBeforeDate(): string {
  return getMoscowShiftedDate(-2)
}

function getMoscowShiftedDate(days: number): string {
  return shiftMoscowDateKey(getMoscowDateKey(), days)
}
