import Link from 'next/link'
import Image from 'next/image'
import { redirect } from 'next/navigation'
import { getHotStoryOfTheDay, getRecentHeadlines, getArticlesFeed } from '../lib/articles'
import { getAllGuides } from '../lib/guides'
import { getMoscowDateKey, shiftMoscowDateKey, pluralize } from '../lib/utils'
import ArticleCard from '../src/components/ArticleCard'
import ArticleFeedList from '../src/components/ArticleFeedList'
import PulseList from '../src/components/PulseList'
import TopicTabs from '../src/components/TopicTabs'

export const revalidate = 300

const PER_PAGE = 12
const HEADLINES_COUNT = 12
const HEADLINES_PAGE_SIZE = 4

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>
}) {
  const resolvedSearchParams = await searchParams
  const page = Math.max(1, parseInt(resolvedSearchParams.page ?? '1', 10) || 1)
  const [featuredGuide] = getAllGuides()

  const hotStory = await getHotStoryOfTheDay()
  const feedExcludeIds = hotStory ? [hotStory.id] : []
  const [headlines, { articles: feed, total }] = await Promise.all([
    page === 1
      ? getRecentHeadlines(HEADLINES_COUNT, feedExcludeIds)
      : Promise.resolve([]),
    getArticlesFeed(page, PER_PAGE, { excludeIds: feedExcludeIds }),
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
            <p className="mt-7 max-w-3xl border border-line border-l-[3px] border-l-accent bg-surface px-4 py-3 text-[15px] font-semibold leading-relaxed text-ink shadow-[0_1px_0_var(--line)] md:text-base lg:text-[17px]">
              Ежедневная редакционная лента об ИИ: ключевые релизы, исследования, продукты и
              индустриальные сдвиги без визуального шума.
            </p>
          </section>
          <TopicTabs className="mb-12" />
        </>
      )}

      {page === 1 && featuredGuide && (
        <section className="mb-12 overflow-hidden rounded border border-line bg-base md:grid md:grid-cols-[minmax(0,1fr)_320px]">
          <div className="p-6 md:p-7">
            <p className="mb-2 text-[12px] font-semibold uppercase text-accent">Гайд для бизнеса</p>
            <h2 className="max-w-2xl font-serif text-2xl font-bold leading-tight text-ink md:text-3xl">
              {featuredGuide.seoTitle}
            </h2>
            <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted md:text-[15px]">
              Пошаговая рамка: выбрать первый AI-проект, подготовить данные, посчитать экономику и не застрять на демо.
            </p>
            <Link
              href={featuredGuide.path}
              className="mt-5 inline-flex rounded border border-ink px-4 py-2 text-sm font-semibold text-ink transition-colors hover:bg-ink hover:text-[var(--base)]"
            >
              Читать гайд
            </Link>
          </div>
          <Link href={featuredGuide.path} className="block border-t border-line md:border-l md:border-t-0">
            <Image
              src={featuredGuide.cover.src}
              alt={featuredGuide.cover.alt}
              width={featuredGuide.cover.width}
              height={featuredGuide.cover.height}
              sizes="(max-width: 768px) 100vw, 320px"
              className="h-full min-h-[180px] w-full object-cover"
            />
          </Link>
        </section>
      )}

      {page === 1 && hotStory && (
        <section className="mb-12 grid grid-cols-1 gap-8 lg:grid-cols-5 lg:gap-10">
          <div className="lg:col-span-2 lg:order-1">
            <h2 className="mb-4 font-serif text-2xl font-bold text-ink">Свежие заголовки</h2>
            <PulseList articles={headlines} pageSize={HEADLINES_PAGE_SIZE} />
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
            <ArticleFeedList articles={feed} featuredFirst={page === 1} />

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
