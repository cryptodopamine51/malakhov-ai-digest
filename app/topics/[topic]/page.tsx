import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { getArticlesByTopic } from '../../../lib/articles'
import ArticleCard from '../../../src/components/ArticleCard'

export const revalidate = 300

const TOPIC_LABELS: Record<string, string> = {
  'ai-industry': 'Индустрия',
  'ai-research': 'Исследования',
  'ai-labs':     'Лаборатории',
  'ai-russia':   '🇷🇺 Россия',
  'coding':      'Код',
}

const ALL_TOPICS = Object.keys(TOPIC_LABELS)

export function generateStaticParams() {
  return ALL_TOPICS.map((topic) => ({ topic }))
}

export async function generateMetadata({
  params,
}: {
  params: { topic: string }
}): Promise<Metadata> {
  const label = TOPIC_LABELS[params.topic]
  if (!label) return {}
  return { title: label }
}

export default async function TopicPage({
  params,
}: {
  params: { topic: string }
}) {
  if (!ALL_TOPICS.includes(params.topic)) notFound()

  const label = TOPIC_LABELS[params.topic]
  const articles = await getArticlesByTopic(params.topic, 20)

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <h1 className="mb-6 text-2xl font-bold text-[#e5e5e5]">{label}</h1>

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
  )
}
