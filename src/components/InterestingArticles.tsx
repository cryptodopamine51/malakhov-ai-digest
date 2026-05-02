import type { Article } from '../../lib/supabase'
import ArticleCard from './ArticleCard'

interface InterestingArticlesProps {
  articles: Article[]
}

export default function InterestingArticles({ articles }: InterestingArticlesProps) {
  if (articles.length < 3) return null

  return (
    <section className="mb-10 border-b border-line pb-10">
      <div className="mb-5 flex items-baseline justify-between gap-3">
        <h2 className="font-serif text-2xl font-bold text-ink">Самое интересное</h2>
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        {articles.slice(0, 4).map((article) => (
          <ArticleCard key={article.id} article={article} variant="related" />
        ))}
      </div>
    </section>
  )
}
