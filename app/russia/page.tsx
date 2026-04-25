import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { CATEGORY_PAGE_SIZE, getArticlesByCategoryPage } from '../../lib/articles'
import { getPaginationMeta, normalizePositivePage } from '../../lib/pagination'
import { SITE_URL, absoluteUrl } from '../../lib/site'
import CategoryArticleList from '../../src/components/CategoryArticleList'
import TopicTabs from '../../src/components/TopicTabs'

export const revalidate = 300

export const metadata: Metadata = {
  title: 'ИИ в России — новости и тренды',
  description: 'Российский рынок ИИ: государственная политика, отечественные модели, кейсы компаний и академические достижения.',
  alternates: { canonical: '/russia' },
  openGraph: {
    title: 'ИИ в России — новости и тренды',
    description: 'Российский рынок ИИ: государственная политика, отечественные модели, кейсы компаний и академические достижения.',
    type: 'website',
    url: absoluteUrl('/russia'),
  },
  twitter: {
    card: 'summary_large_image',
    title: 'ИИ в России — новости и тренды',
    description: 'Российский рынок ИИ: государственная политика, отечественные модели, кейсы компаний и академические достижения.',
  },
  other: {
    'twitter:url': absoluteUrl('/russia'),
  },
}

const jsonLd = {
  '@context': 'https://schema.org',
  '@type': 'CollectionPage',
  name: 'ИИ в России',
  description: 'Российский рынок ИИ: государственная политика, отечественные модели, кейсы компаний и академические достижения.',
  url: `${SITE_URL}/russia`,
  publisher: { '@type': 'Organization', name: 'Malakhov AI Дайджест', url: SITE_URL },
}

export default async function RussiaPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>
}) {
  const resolvedSearchParams = await searchParams
  const page = normalizePositivePage(resolvedSearchParams.page)
  const { articles, total } = await getArticlesByCategoryPage('ai-russia', page, CATEGORY_PAGE_SIZE)
  const pagination = getPaginationMeta(total, page, CATEGORY_PAGE_SIZE)

  if (pagination.totalPages > 0 && page > pagination.totalPages) {
    redirect(pagination.totalPages === 1 ? '/russia' : `/russia?page=${pagination.totalPages}`)
  }

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <div className="mx-auto max-w-6xl px-4 py-8 md:py-10">

        {/* Hero с wireframe-иллюстрацией */}
        <div className="relative mb-8 overflow-hidden rounded border border-line bg-surface" style={{ minHeight: 200 }}>
          {/* SVG: схема «центр → регионы» */}
          <svg viewBox="0 0 640 200" className="absolute inset-0 h-full w-full opacity-60" aria-hidden>
            <circle cx={320} cy={100} r={32} fill="none" stroke="var(--ink)" strokeWidth="1.2"/>
            <text x={320} y={104} textAnchor="middle" fontSize="9" fill="var(--muted)" fontFamily="var(--font-mono)">RU</text>
            {[
              { cx: 160, cy: 50 }, { cx: 480, cy: 50 },
              { cx: 140, cy: 155 }, { cx: 500, cy: 155 },
              { cx: 320, cy: 30 },
            ].map(({ cx, cy }, i) => (
              <g key={i}>
                <line x1={320} y1={100} x2={cx} y2={cy} stroke="var(--ink)" strokeWidth="0.7" strokeDasharray="4 4"/>
                <circle cx={cx} cy={cy} r={18} fill="none" stroke="var(--ink)" strokeWidth="0.8"/>
              </g>
            ))}
            <circle cx={320} cy={100} r={32} fill="var(--accent)" fillOpacity="0.06" stroke="var(--accent)" strokeWidth="1"/>
          </svg>
          {/* Градиент: левые 45% непрозрачны (текст), правые — иллюстрация */}
          <div className="absolute inset-0 z-[5]" style={{
            background: 'linear-gradient(to right, var(--surface) 45%, color-mix(in srgb, var(--surface) 60%, transparent) 65%, transparent 100%)'
          }} />
          <div className="relative z-10 px-8 py-10">
            <p className="mb-2 font-serif text-[10px] font-semibold uppercase tracking-[0.22em] text-accent">
              Раздел
            </p>
            <h1 className="font-serif text-4xl font-extrabold leading-[1.1] tracking-tight text-ink md:text-[48px]">
              🇷🇺 Россия
            </h1>
            <p className="mt-3 max-w-xl text-[14px] leading-relaxed text-muted">
              Российский рынок ИИ: государственная политика, отечественные модели, кейсы компаний и академические достижения.
            </p>
          </div>
        </div>

        <TopicTabs activeHref="/russia" className="mb-8" />

        <CategoryArticleList
          category="ai-russia"
          basePath="/russia"
          initialArticles={articles}
          total={total}
          initialPage={page}
          perPage={CATEGORY_PAGE_SIZE}
        />

      </div>
    </>
  )
}
