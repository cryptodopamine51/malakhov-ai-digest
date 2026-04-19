import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
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
    openGraph: {
      title: meta.seoTitle,
      description: meta.seoDescription,
      type: 'website',
    },
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
    publisher: {
      '@type': 'Organization',
      name: 'Malakhov AI Дайджест',
      url: SITE_URL,
    },
  }

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <div className="mx-auto max-w-6xl px-4 py-8">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-[#e5e5e5]">{meta.label}</h1>
          <p className="mt-2 max-w-2xl text-sm text-muted leading-relaxed">{meta.description}</p>
        </div>

        {articles.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-muted">
            <span className="text-4xl mb-3">📡</span>
            <p className="text-lg">Статьи появятся совсем скоро</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3">
            {articles.map((article) => (
              <ArticleCard key={article.id} article={article} variant="default" />
            ))}
          </div>
        )}
      </div>
    </>
  )
}
