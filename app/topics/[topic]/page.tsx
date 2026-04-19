import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { getArticlesByTopic } from '../../../lib/articles'
import ArticleCard from '../../../src/components/ArticleCard'

export const revalidate = 300

interface TopicMeta {
  label: string
  description: string
  seoTitle: string
  seoDescription: string
}

const TOPICS: Record<string, TopicMeta> = {
  'ai-industry': {
    label: 'Индустрия',
    description: 'Бизнес-новости об искусственном интеллекте: продукты, партнёрства, рыночные тренды и релизы компаний со всего мира.',
    seoTitle: 'ИИ-Индустрия — бизнес и продукты',
    seoDescription: 'Свежие новости о бизнесе в области искусственного интеллекта: релизы продуктов, сделки, партнёрства и рыночные тренды.',
  },
  'ai-research': {
    label: 'Исследования',
    description: 'Академические прорывы, технические разборы и новые работы в области ИИ — от ведущих лабораторий и университетов.',
    seoTitle: 'ИИ-Исследования — наука и технологии',
    seoDescription: 'Академические статьи, разборы новых архитектур и прорывы в исследованиях искусственного интеллекта.',
  },
  'ai-labs': {
    label: 'Лаборатории',
    description: 'Официальные анонсы от ведущих AI-компаний: новые модели, API, инструменты и исследовательские публикации.',
    seoTitle: 'ИИ-Лаборатории — анонсы OpenAI, Google, Anthropic',
    seoDescription: 'Официальные новости от OpenAI, Google DeepMind, Anthropic и других ведущих AI-лабораторий.',
  },
  'ai-russia': {
    label: '🇷🇺 Россия',
    description: 'Российский рынок ИИ: государственная политика, отечественные модели, кейсы компаний и академические достижения.',
    seoTitle: 'ИИ в России — новости и тренды',
    seoDescription: 'Новости о развитии искусственного интеллекта в России: YandexGPT, GigaChat, господдержка и российские AI-стартапы.',
  },
  'coding': {
    label: 'Код',
    description: 'Практические материалы для разработчиков: туториалы, библиотеки, фреймворки и кейсы применения ИИ в разработке.',
    seoTitle: 'ИИ и разработка — туториалы и инструменты',
    seoDescription: 'Практические материалы для разработчиков: AI-инструменты, библиотеки и туториалы по применению ИИ в коде.',
  },
  'ai-investments': {
    label: 'Инвестиции',
    description: 'Крупные раунды финансирования, M&A-сделки и движение венчурного капитала в AI-индустрии — куда течут деньги.',
    seoTitle: 'Инвестиции в ИИ — раунды и сделки',
    seoDescription: 'Крупные инвестиционные раунды, поглощения и венчурный капитал в сфере искусственного интеллекта.',
  },
  'ai-startups': {
    label: 'Стартапы',
    description: 'Интересные AI-стартапы — зарубежные и российские. Идеи, продукты и подходы, которые можно взять на вооружение.',
    seoTitle: 'ИИ-Стартапы — лучшие проекты и идеи',
    seoDescription: 'Обзоры интересных AI-стартапов: зарубежные и российские проекты, новые продукты и подходы.',
  },
}

// ─── Wireframe SVG иллюстрации ──────────────────────────────────────────────

function TopicIllustration({ topic }: { topic: string }): ReactNode {
  const shared = 'absolute inset-0 h-full w-full opacity-60'

  if (topic === 'ai-industry') return (
    <svg viewBox="0 0 640 200" className={shared} aria-hidden>
      {/* Circuit board / бизнес-процесс */}
      {[80, 200, 320, 440, 560].map((x, i) => (
        <g key={x}>
          <rect x={x - 24} y={76} width={48} height={48} rx={2} fill="none" stroke="var(--ink)" strokeWidth="1"/>
          <line x1={x} y1={76} x2={x} y2={44} stroke="var(--ink)" strokeWidth="0.8"/>
          <circle cx={x} cy={40} r={4} fill="none" stroke="var(--ink)" strokeWidth="1"/>
          {i < 4 && <line x1={x + 24} y1={100} x2={x + 56} y2={100} stroke="var(--ink)" strokeWidth="0.8" strokeDasharray="3 3"/>}
          <line x1={x} y1={124} x2={x} y2={156} stroke="var(--ink)" strokeWidth="0.8"/>
          <circle cx={x} cy={160} r={4} fill="none" stroke="var(--ink)" strokeWidth="1"/>
        </g>
      ))}
      <line x1={80} y1={100} x2={80} y2={100} stroke="var(--accent)" strokeWidth="1.5"/>
      <rect x={280} y={80} width={80} height={40} rx={2} fill="var(--accent)" fillOpacity="0.06" stroke="var(--accent)" strokeWidth="1"/>
    </svg>
  )

  if (topic === 'ai-research') return (
    <svg viewBox="0 0 640 200" className={shared} aria-hidden>
      {/* Граф нейронной сети */}
      {[
        { cx: 100, cy: 100 },
        { cx: 240, cy: 50 }, { cx: 240, cy: 100 }, { cx: 240, cy: 150 },
        { cx: 400, cy: 70 }, { cx: 400, cy: 130 },
        { cx: 540, cy: 100 },
      ].map(({ cx, cy }, i) => (
        <circle key={i} cx={cx} cy={cy} r={i === 0 || i === 6 ? 16 : 12} fill="none" stroke="var(--ink)" strokeWidth="1"/>
      ))}
      {[[100,100,240,50],[100,100,240,100],[100,100,240,150],[240,50,400,70],[240,50,400,130],[240,100,400,70],[240,100,400,130],[240,150,400,70],[240,150,400,130],[400,70,540,100],[400,130,540,100]].map(([x1,y1,x2,y2], i) => (
        <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke="var(--ink)" strokeWidth="0.7" strokeDasharray="4 3"/>
      ))}
      <circle cx={400} cy={70} r={12} fill="var(--accent)" fillOpacity="0.08" stroke="var(--accent)" strokeWidth="1.2"/>
    </svg>
  )

  if (topic === 'ai-labs') return (
    <svg viewBox="0 0 640 200" className={shared} aria-hidden>
      {/* Схема модели: слои трансформера */}
      {[0,1,2,3,4].map((i) => (
        <g key={i}>
          <rect x={140 + i * 76} y={60} width={56} height={80} rx={2} fill="none" stroke="var(--ink)" strokeWidth="0.9"/>
          {[0,1,2,3].map((j) => (
            <line key={j} x1={140 + i * 76 + 8} y1={80 + j * 16} x2={140 + i * 76 + 48} y2={80 + j * 16} stroke="var(--ink)" strokeWidth="0.6" strokeDasharray="2 4"/>
          ))}
          {i < 4 && <line x1={196 + i * 76} y1={100} x2={216 + i * 76} y2={100} stroke="var(--accent)" strokeWidth="1" strokeDasharray="3 2"/>}
        </g>
      ))}
      <rect x={216} y={60} width={56} height={80} rx={2} fill="var(--accent)" fillOpacity="0.07" stroke="var(--accent)" strokeWidth="1.2"/>
      <text x={320} y={172} textAnchor="middle" fontSize="9" fill="var(--muted)" fontFamily="var(--font-mono)" letterSpacing="0.12em">TRANSFORMER LAYERS</text>
    </svg>
  )

  if (topic === 'ai-investments') return (
    <svg viewBox="0 0 640 200" className={shared} aria-hidden>
      {/* Bar chart — рост раундов */}
      {[
        { x: 80,  h: 40, label: '2021' },
        { x: 170, h: 65, label: '2022' },
        { x: 260, h: 55, label: '2023' },
        { x: 350, h: 100, label: '2024' },
        { x: 440, h: 140, label: '2025' },
        { x: 530, h: 160, label: '2026' },
      ].map(({ x, h, label }, i) => (
        <g key={x}>
          <rect
            x={x} y={170 - h} width={60} height={h} rx={1}
            fill={i === 5 ? 'var(--accent)' : 'none'}
            fillOpacity={i === 5 ? 0.12 : 0}
            stroke={i === 5 ? 'var(--accent)' : 'var(--ink)'}
            strokeWidth={i === 5 ? 1.2 : 0.8}
          />
          <text x={x + 30} y={184} textAnchor="middle" fontSize="8" fill="var(--muted)" fontFamily="var(--font-mono)">{label}</text>
        </g>
      ))}
      <line x1={60} y1={170} x2={610} y2={170} stroke="var(--line)" strokeWidth="0.8"/>
    </svg>
  )

  if (topic === 'ai-startups') return (
    <svg viewBox="0 0 640 200" className={shared} aria-hidden>
      {/* Рост: экспоненциальная кривая + точки-стартапы */}
      <path d="M 60 170 C 160 168, 260 140, 360 100 C 420 76, 480 44, 580 20" fill="none" stroke="var(--accent)" strokeWidth="1.5" strokeDasharray="5 3"/>
      {[
        { cx: 120, cy: 165 }, { cx: 200, cy: 155 }, { cx: 280, cy: 132 },
        { cx: 360, cy: 100 }, { cx: 440, cy: 68 }, { cx: 520, cy: 36 },
      ].map(({ cx, cy }, i) => (
        <g key={cx}>
          <circle cx={cx} cy={cy} r={i < 3 ? 6 : 8} fill="none" stroke="var(--ink)" strokeWidth="0.9"/>
          {i >= 3 && <circle cx={cx} cy={cy} r={3} fill="var(--accent)" fillOpacity="0.5"/>}
        </g>
      ))}
      <line x1={60} y1={170} x2={600} y2={170} stroke="var(--line)" strokeWidth="0.8"/>
      <line x1={60} y1={170} x2={60} y2={10} stroke="var(--line)" strokeWidth="0.8"/>
    </svg>
  )

  if (topic === 'ai-russia') return (
    <svg viewBox="0 0 640 200" className={shared} aria-hidden>
      {/* Схема: центральный узел → регионы */}
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
  )

  if (topic === 'coding') return (
    <svg viewBox="0 0 640 200" className={shared} aria-hidden>
      {/* Терминал */}
      <rect x={80} y={30} width={480} height={140} rx={3} fill="none" stroke="var(--ink)" strokeWidth="1"/>
      <line x1={80} y1={56} x2={560} y2={56} stroke="var(--ink)" strokeWidth="0.8"/>
      {[96, 108, 120].map((cx) => (
        <circle key={cx} cx={cx} cy={43} r={5} fill="none" stroke="var(--ink)" strokeWidth="0.8"/>
      ))}
      {[
        { y: 78,  w: 220, accent: false },
        { y: 94,  w: 140, accent: true  },
        { y: 110, w: 300, accent: false },
        { y: 126, w: 180, accent: true  },
        { y: 142, w: 260, accent: false },
        { y: 158, w: 100, accent: false },
      ].map(({ y, w, accent }, i) => (
        <line key={i} x1={104} y1={y} x2={104 + w} y2={y} stroke={accent ? 'var(--accent)' : 'var(--ink)'} strokeWidth={accent ? 1.2 : 0.7} strokeDasharray={accent ? '' : '0'}/>
      ))}
      <rect x={104} y={158} width={8} height={12} rx={1} fill="var(--accent)" fillOpacity="0.8"/>
    </svg>
  )

  return null
}

const ALL_TOPICS = Object.keys(TOPICS)

export function generateStaticParams() {
  return ALL_TOPICS.map((topic) => ({ topic }))
}

export async function generateMetadata({
  params,
}: {
  params: { topic: string }
}): Promise<Metadata> {
  const meta = TOPICS[params.topic]
  if (!meta) return {}
  return {
    title: meta.seoTitle,
    description: meta.seoDescription,
    alternates: { canonical: `/topics/${params.topic}` },
    openGraph: { title: meta.seoTitle, description: meta.seoDescription, type: 'website' },
  }
}

export default async function TopicPage({
  params,
}: {
  params: { topic: string }
}) {
  const meta = TOPICS[params.topic]
  if (!meta) notFound()

  const articles = await getArticlesByTopic(params.topic, 24)

  const SITE_URL = 'https://news.malakhovai.ru'
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: meta.seoTitle,
    description: meta.seoDescription,
    url: `${SITE_URL}/topics/${params.topic}`,
    publisher: { '@type': 'Organization', name: 'Malakhov AI Дайджест', url: SITE_URL },
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
          <TopicIllustration topic={params.topic} />
          <div className="relative z-10 px-8 py-10">
            <p className="mb-2 font-serif text-[10px] font-semibold uppercase tracking-[0.22em] text-accent">
              Раздел
            </p>
            <h1 className="font-serif text-3xl font-extrabold tracking-tight text-ink md:text-4xl">
              {meta.label}
            </h1>
            <p className="mt-3 max-w-xl text-[14px] leading-relaxed text-muted">
              {meta.description}
            </p>
          </div>
        </div>

        {articles.length === 0 ? (
          <div className="py-20 text-center text-muted">
            Статьи появятся совсем скоро
          </div>
        ) : (
          <>
            <div className="mb-4">
              <ArticleCard article={articles[0]} variant="featured" />
            </div>
            {articles.length > 1 && (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                {articles.slice(1).map((article) => (
                  <ArticleCard key={article.id} article={article} variant="default" />
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </>
  )
}
