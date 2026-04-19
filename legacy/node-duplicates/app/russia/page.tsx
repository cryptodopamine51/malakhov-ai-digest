import type { Metadata } from 'next'
import { getRussiaArticles } from '../../../lib/articles'
import ArticleCard from '../../components/ArticleCard'

export const revalidate = 300

export const metadata: Metadata = {
  title: 'ИИ в России',
  description: 'Новости об искусственном интеллекте в российских компаниях и медиа',
}

export default async function RussiaPage() {
  const articles = await getRussiaArticles(30)

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      {/* Заголовок секции с красной полосой */}
      <div className="mb-6 border-l-4 border-russia pl-4">
        <h1 className="text-2xl font-bold text-[#e5e5e5]">🇷🇺 ИИ в России</h1>
        <p className="mt-1 text-sm text-muted">
          Новости об искусственном интеллекте в российских компаниях и медиа
        </p>
      </div>

      {articles.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-muted">
          <span className="text-4xl mb-3">📡</span>
          <p className="text-lg">Статьи появятся совсем скоро</p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {articles.map((article) => (
            <ArticleCard key={article.id} article={article} variant="compact" />
          ))}
        </div>
      )}
    </div>
  )
}
