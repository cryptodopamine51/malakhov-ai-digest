import type { Metadata } from 'next'
import Link from 'next/link'
import Image from 'next/image'
import { getHotStoryOfTheDay, getRecentHeadlines, getArticlesFeed } from '../lib/articles'
import { getAllGuides } from '../lib/guides'
import { SITE_URL, absoluteUrl } from '../lib/site'
import { getMoscowDateKey, shiftMoscowDateKey, pluralize } from '../lib/utils'
import ArticleCard from '../src/components/ArticleCard'
import HomeFeedList from '../src/components/HomeFeedList'
import PulseList from '../src/components/PulseList'
import TopicTabs from '../src/components/TopicTabs'

export const revalidate = 300

// Home-page metadata override the layout defaults so the SERP title carries
// the primary navigational query ("AI новости на русском"). The brand suffix
// is appended via the title template in app/layout.tsx.
const HOME_TITLE = 'AI новости на русском'
const HOME_DESCRIPTION =
  'Свежие новости об искусственном интеллекте на русском: модели, лаборатории, стартапы, инвестиции и AI в России. Ежедневные редакционные обзоры.'

export const metadata: Metadata = {
  title: HOME_TITLE,
  description: HOME_DESCRIPTION,
  alternates: { canonical: '/' },
  openGraph: {
    title: HOME_TITLE,
    description: HOME_DESCRIPTION,
    url: SITE_URL,
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: HOME_TITLE,
    description: HOME_DESCRIPTION,
  },
  other: {
    'twitter:url': absoluteUrl('/'),
    'verify-admitad': 'c970c0609c',
  },
}

const PER_PAGE = 12
const HEADLINES_COUNT = 12
const HEADLINES_PAGE_SIZE = 4

export default async function HomePage() {
  const [featuredGuide] = getAllGuides()

  const hotStory = await getHotStoryOfTheDay()
  const feedExcludeIds = hotStory ? [hotStory.id] : []
  const [headlines, { articles: feed, total }] = await Promise.all([
    getRecentHeadlines(HEADLINES_COUNT, feedExcludeIds),
    getArticlesFeed(1, PER_PAGE, { excludeIds: feedExcludeIds }),
  ])

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 md:py-8 lg:py-10">
      <section className="mb-7 border-b border-line pb-8 lg:grid lg:grid-cols-[minmax(0,1fr)_360px] lg:items-end lg:gap-10">
        <div>
          <p className="mb-4 text-[12px] font-semibold uppercase tracking-[0.14em] text-accent">
            Ежедневная редакционная лента
          </p>
          <h1 className="max-w-4xl font-serif text-[42px] font-extrabold leading-[0.95] text-ink sm:text-[56px] lg:text-[68px]">
            AI-новости на русском без визуального шума
          </h1>
          <p className="mt-5 max-w-2xl text-[17px] font-medium leading-relaxed text-hero-muted md:text-[19px]">
            Релизы моделей, исследования, сделки, российский рынок и инструменты для работы
            с ИИ — в одном спокойном редакционном потоке.
          </p>
          <div className="mt-6 flex flex-wrap gap-x-6 gap-y-3 border-t border-line pt-5 text-sm text-muted">
            {total > 0 && (
              <span className="font-semibold text-ink">
                {total} {pluralize(total, 'материал', 'материала', 'материалов')}
              </span>
            )}
            <span>обновление каждые несколько часов</span>
            <span>новости, гайды и контекст</span>
          </div>
        </div>

        {featuredGuide && (
          <aside className="mt-8 border-t border-line pt-6 lg:mt-0 lg:border-l lg:border-t-0 lg:pl-8">
            <Link href={featuredGuide.path} className="group block">
              <p className="mb-3 text-[12px] font-semibold uppercase tracking-[0.12em] text-accent">
                Практический гайд
              </p>
              <div className="relative mb-4 aspect-[16/10] overflow-hidden border border-line bg-surface">
                <Image
                  src={featuredGuide.cover.src}
                  alt={featuredGuide.cover.alt}
                  width={featuredGuide.cover.width}
                  height={featuredGuide.cover.height}
                  sizes="(max-width: 1024px) 100vw, 360px"
                  className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
                />
              </div>
              <h2 className="font-serif text-[22px] font-bold leading-tight text-ink transition-colors group-hover:text-accent">
                {featuredGuide.seoTitle}
              </h2>
              <p className="mt-3 text-sm leading-relaxed text-muted">
                Выбор первого AI-проекта, подготовка данных, экономика и запуск без лишних демо.
              </p>
            </Link>
          </aside>
        )}
      </section>
      <TopicTabs className="mb-10" />

      {hotStory && (
        <section className="mb-12 grid grid-cols-1 gap-8 lg:grid-cols-5 lg:gap-10">
          <div className="lg:col-span-2">
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-accent">
              Пульс
            </p>
            <h2 className="mb-4 font-serif text-2xl font-bold text-ink">Свежие заголовки</h2>
            <PulseList articles={headlines} pageSize={HEADLINES_PAGE_SIZE} />
          </div>
          <div className="lg:col-span-3">
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-accent">
              Редакционный выбор
            </p>
            <h2 className="mb-4 font-serif text-2xl font-bold text-ink">Главное сегодня</h2>
            <ArticleCard article={hotStory} variant="featured" />
          </div>
        </section>
      )}

      {/* Все новости */}
      <section>
        <div className="mb-5 flex flex-col gap-1 sm:flex-row sm:items-baseline sm:gap-3">
          <h2 className="font-serif text-3xl font-bold text-ink">
            Все новости
          </h2>
          {total > 0 && (
            <span className="text-sm text-muted">{total} {pluralize(total, 'материал', 'материала', 'материалов')}</span>
          )}
        </div>

        <HomeFeedList
          initialArticles={feed}
          total={total}
          perPage={PER_PAGE}
          excludeId={hotStory?.id ?? null}
        />
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
