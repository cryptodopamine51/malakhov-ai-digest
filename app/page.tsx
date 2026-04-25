import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getHotStoryOfTheDay, getRecentHeadlines, getArticlesFeed } from '../lib/articles'
import { getMoscowDateKey, shiftMoscowDateKey, pluralize } from '../lib/utils'
import ArticleCard from '../src/components/ArticleCard'
import PulseList from '../src/components/PulseList'
import TopicTabs from '../src/components/TopicTabs'

export const revalidate = 300

const PER_PAGE = 12
const HEADLINES_COUNT = 8

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>
}) {
  const resolvedSearchParams = await searchParams
  const page = Math.max(1, parseInt(resolvedSearchParams.page ?? '1', 10) || 1)

  const hotStory = page === 1 ? await getHotStoryOfTheDay() : null
  const [headlines, { articles: feed, total }] = await Promise.all([
    page === 1
      ? getRecentHeadlines(HEADLINES_COUNT, hotStory ? [hotStory.id] : [])
      : Promise.resolve([]),
    getArticlesFeed(page, PER_PAGE),
  ])

  const totalPages = Math.ceil(total / PER_PAGE)

  if (totalPages > 0 && page > totalPages) {
    redirect(totalPages === 1 ? '/' : `/?page=${totalPages}`)
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 md:py-10 lg:py-12">
      {page === 1 && (
        <>
          <section className="mb-6 rounded border border-line bg-base px-6 py-9 md:px-8 md:py-11 lg:px-10 lg:py-12">
            <h1 className="font-serif text-4xl font-bold leading-none text-ink sm:text-5xl md:text-6xl">
              Malakhov AI Дайджест
            </h1>
            <p className="mt-4 max-w-3xl text-sm leading-relaxed text-ink opacity-70 md:text-base lg:text-[17px]">
              Ежедневная редакционная лента об ИИ: ключевые релизы, исследования, продукты и
              индустриальные сдвиги без визуального шума.
            </p>
          </section>
          <TopicTabs className="mb-12" />
        </>
      )}

      {page === 1 && hotStory && (
        <section className="mb-12 grid grid-cols-1 gap-8 lg:grid-cols-5 lg:gap-10">
          <div className="lg:col-span-2 lg:order-1">
            <h2 className="mb-4 font-serif text-2xl font-bold text-ink">Свежие заголовки</h2>
            <PulseList articles={headlines} />
          </div>
          <div className="lg:col-span-3 lg:order-2">
            <h2 className="mb-4 font-serif text-2xl font-bold text-ink">Главное сегодня</h2>
            <ArticleCard article={hotStory} variant="featured" />
          </div>
        </section>
      )}

      {/* Все новости */}
      <section>
        <div className="mb-5 flex flex-col gap-1 sm:flex-row sm:items-baseline sm:gap-3">
          <h2 className="font-serif text-3xl font-bold text-ink">
            {page === 1 ? 'Все новости' : `Все новости — страница ${page}`}
          </h2>
          {total > 0 && (
            <span className="text-sm text-muted">{total} {pluralize(total, 'материал', 'материала', 'материалов')}</span>
          )}
        </div>

        {feed.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-center text-muted">
            <span className="text-4xl mb-3">📡</span>
            <p className="text-lg">Статьи появятся совсем скоро</p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
              {feed.map((article) => (
                <ArticleCard key={article.id} article={article} variant="default" />
              ))}
            </div>

            {totalPages > 1 && (
              <div className="mt-10 flex flex-wrap items-center justify-center gap-2">
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

      <div className="mt-10 flex flex-wrap gap-x-5 gap-y-2 text-sm text-muted">
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
