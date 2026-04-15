import { getLatestArticles } from '../lib/articles'
import ArticleCard from '../src/components/ArticleCard'

export const revalidate = 300

export default async function HomePage() {
  const articles = await getLatestArticles(20)
  const [featured, ...rest] = articles

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <h1 className="mb-6 text-2xl font-bold text-[#e5e5e5]">Последние новости</h1>

      {articles.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-muted">
          <span className="text-4xl mb-3">📡</span>
          <p className="text-lg">Статьи появятся совсем скоро</p>
        </div>
      ) : (
        <>
          {featured && (
            <div className="mb-6">
              <ArticleCard article={featured} variant="featured" />
            </div>
          )}
          {rest.length > 0 && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3">
              {rest.map((article) => (
                <ArticleCard key={article.id} article={article} variant="default" />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
