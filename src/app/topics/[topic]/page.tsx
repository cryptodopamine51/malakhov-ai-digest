import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { getArticlesByTopic } from '../../../../lib/articles'
import ArticleCard from '../../../components/ArticleCard'

export const revalidate = 300

// ── Маппинг топиков ───────────────────────────────────────────────────────────

const TOPIC_LABELS: Record<string, string> = {
  'ai-industry': 'Индустрия',
  'ai-research': 'Исследования',
  'ai-labs':     'Лаборатории',
  'ai-russia':   '🇷🇺 Россия',
  'coding':      'Код',
}

const ALL_TOPICS = Object.keys(TOPIC_LABELS)

// ── Статические пути ──────────────────────────────────────────────────────────

export function generateStaticParams() {
  return ALL_TOPICS.map((topic) => ({ topic }))
}

// ── Метаданные ────────────────────────────────────────────────────────────────

export async function generateMetadata({
  params,
}: {
  params: Promise<{ topic: string }>
}): Promise<Metadata> {
  const { topic } = await params
  const label = TOPIC_LABELS[topic]
  if (!label) return {}
  return { title: label }
}

// ── Страница ──────────────────────────────────────────────────────────────────

export default async function TopicPage({
  params,
}: {
  params: Promise<{ topic: string }>
}) {
  const { topic } = await params

  if (!ALL_TOPICS.includes(topic)) notFound()

  const label = TOPIC_LABELS[topic]
  const articles = await getArticlesByTopic(topic, 20)

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
