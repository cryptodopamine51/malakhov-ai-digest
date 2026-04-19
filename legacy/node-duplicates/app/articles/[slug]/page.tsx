import { notFound } from 'next/navigation'
import Image from 'next/image'
import Link from 'next/link'
import type { Metadata } from 'next'
import { getArticleBySlug, getAllSlugs } from '../../../../lib/articles'
import { formatRelativeTime } from '../../../../lib/utils'
import TopicBadge from '../../../components/TopicBadge'

export const revalidate = 3600

// ── Статические пути ──────────────────────────────────────────────────────────

export async function generateStaticParams() {
  const slugs = await getAllSlugs()
  return slugs.map((slug) => ({ slug }))
}

// ── Метаданные ────────────────────────────────────────────────────────────────

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>
}): Promise<Metadata> {
  const { slug } = await params
  const article = await getArticleBySlug(slug)
  if (!article) return {}

  return {
    title: article.ru_title ?? article.original_title,
    description:
      article.why_it_matters ??
      article.ru_text?.slice(0, 160) ??
      undefined,
    openGraph: {
      images: article.cover_image_url ? [article.cover_image_url] : [],
    },
  }
}

// ── Страница ──────────────────────────────────────────────────────────────────

export default async function ArticlePage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const article = await getArticleBySlug(slug)

  if (!article) notFound()

  const title = article.ru_title ?? article.original_title
  const time = formatRelativeTime(article.pub_date ?? article.created_at)

  return (
    <article className="mx-auto max-w-3xl px-4 py-8">
      {/* Хлебные крошки */}
      <nav className="mb-6 flex items-center gap-2 text-sm text-muted">
        <Link href="/" className="hover:text-accent transition-colors">
          Главная
        </Link>
        <span>→</span>
        <span>{article.source_name}</span>
      </nav>

      {/* Обложка */}
      {article.cover_image_url && (
        <div className="relative mb-6 w-full overflow-hidden rounded-xl" style={{ maxHeight: 400 }}>
          <Image
            src={article.cover_image_url}
            alt={title}
            width={1200}
            height={400}
            className="w-full object-cover"
            style={{ maxHeight: 400 }}
            priority
          />
        </div>
      )}

      {/* Заголовок */}
      <h1 className="mb-4 text-2xl font-bold leading-snug text-[#e5e5e5] md:text-3xl">
        {title}
      </h1>

      {/* Мета */}
      <div className="mb-5 flex flex-wrap items-center gap-2 text-sm text-muted">
        <span className="inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium bg-accent text-white">
          {article.source_name}
        </span>
        <span>{time}</span>
        {(article.topics ?? []).map((t) => (
          <TopicBadge key={t} topic={t} />
        ))}
      </div>

      {/* Блок "Почему важно" */}
      {article.why_it_matters && (
        <div className="mb-6 border-l-4 border-accent pl-4 py-2">
          <p className="text-sm text-[#e5e5e5]">
            <span className="font-semibold">💡 Почему это важно: </span>
            {article.why_it_matters}
          </p>
        </div>
      )}

      {/* Основной текст */}
      {article.ru_text && (
        <div className="mb-8 max-w-2xl leading-relaxed text-[#d4d4d4] text-base">
          {article.ru_text.split('\n').filter(Boolean).map((para, i) => (
            <p key={i} className="mb-4">
              {para}
            </p>
          ))}
        </div>
      )}

      {/* Кнопка оригинала */}
      <a
        href={article.original_url}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-2 rounded-lg border border-accent/50 px-4 py-2 text-sm text-accent hover:bg-accent hover:text-white transition-colors"
      >
        Читать оригинал →
      </a>
    </article>
  )
}
