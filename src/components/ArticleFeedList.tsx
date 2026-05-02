import type { Article } from '../../lib/supabase'
import ArticleCard from './ArticleCard'

interface ArticleFeedListProps {
  articles: Article[]
  featuredFirst?: boolean
}

export default function ArticleFeedList({
  articles,
  featuredFirst = true,
}: ArticleFeedListProps) {
  const firstArticle = featuredFirst ? articles[0] : null
  const gridArticles = featuredFirst ? articles.slice(1) : articles

  return (
    <>
      {firstArticle && (
        <div className="mb-4">
          <ArticleCard article={firstArticle} variant="featured" />
        </div>
      )}

      {gridArticles.length > 0 && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {gridArticles.map((article) => (
            <ArticleCard key={article.id} article={article} variant="default" />
          ))}
        </div>
      )}
    </>
  )
}
