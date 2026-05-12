import type { Article } from '../../lib/supabase'
import ArticleCard from './ArticleCard'

interface ArticleRecommendationsProps {
  articles: Article[]
}

export default function ArticleRecommendations({ articles }: ArticleRecommendationsProps) {
  return (
    <div className="-mx-4 flex snap-x gap-4 overflow-x-auto px-4 pb-2 [scrollbar-width:none] sm:mx-0 sm:grid sm:grid-cols-2 sm:overflow-visible sm:px-0 sm:pb-0 xl:grid-cols-3 [&::-webkit-scrollbar]:hidden">
      {articles.map((article) => (
        <div key={article.id} className="w-[82vw] max-w-[340px] flex-none snap-start sm:w-auto sm:max-w-none">
          <ArticleCard article={article} variant="related" />
        </div>
      ))}
    </div>
  )
}
