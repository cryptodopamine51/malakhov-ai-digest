import type { ReactNode } from 'react'
import { notFound } from 'next/navigation'
import Image from 'next/image'
import Link from 'next/link'
import type { Metadata } from 'next'
import { getArticleBySlug, getAllSlugs, getRelatedArticles, resolveAnchorLinks } from '../../../lib/articles'
import { formatRelativeTime } from '../../../lib/utils'
import TopicBadge from '../../../src/components/TopicBadge'
import ArticleCard from '../../../src/components/ArticleCard'
import TelegramCTA from '../../../src/components/TelegramCTA'

export const revalidate = 3600

type AnchorLink = { anchor: string; slug: string; title: string }

function renderBodyWithAnchors(body: string, anchors: AnchorLink[]): ReactNode[] {
  const paragraphs = body.split('\n\n').filter(Boolean)
  const usedAnchors = new Set<string>()

  return paragraphs.map((para, i) => {
    let assigned: AnchorLink | undefined
    for (const a of anchors) {
      if (!usedAnchors.has(a.anchor) && para.includes(a.anchor)) {
        assigned = a
        usedAnchors.add(a.anchor)
        break
      }
    }

    if (!assigned) {
      return <p key={i} className="mb-5">{para}</p>
    }

    const [before, after] = para.split(assigned.anchor)
    return (
      <p key={i} className="mb-5">
        {before}
        <Link href={`/articles/${assigned.slug}`} className="text-accent underline decoration-accent/40 hover:decoration-accent transition-colors">
          {assigned.anchor}
        </Link>
        {after}
      </p>
    )
  })
}

export async function generateStaticParams() {
  const slugs = await getAllSlugs()
  return slugs.map((slug) => ({ slug }))
}

export async function generateMetadata({
  params,
}: {
  params: { slug: string }
}): Promise<Metadata> {
  const article = await getArticleBySlug(params.slug)
  if (!article) return {}

  const title = article.ru_title ?? article.original_title
  const description = article.card_teaser ?? article.lead ?? undefined

  return {
    title,
    description,
    alternates: {
      canonical: `/articles/${params.slug}`,
    },
    openGraph: {
      title,
      description,
      type: 'article',
      publishedTime: article.pub_date ?? article.created_at,
      modifiedTime: article.updated_at,
      images: article.cover_image_url ? [article.cover_image_url] : ['/og-default.png'],
    },
  }
}

export default async function ArticlePage({
  params,
}: {
  params: { slug: string }
}) {
  const article = await getArticleBySlug(params.slug)
  if (!article || article.quality_ok !== true) notFound()

  const [related, anchorLinks] = await Promise.all([
    getRelatedArticles(article.topics ?? [], article.id, 3),
    resolveAnchorLinks(article.link_anchors ?? [], article.id),
  ])

  const title = article.ru_title ?? article.original_title
  const time = formatRelativeTime(article.pub_date ?? article.created_at)

  // Примерное время чтения
  const bodyLength = (article.editorial_body ?? article.ru_text ?? '').length
  const readingMinutes = Math.max(1, Math.round(bodyLength / 1200))

  const SITE_URL = 'https://news.malakhovai.ru'
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'NewsArticle',
    headline: title,
    description: article.card_teaser ?? article.lead ?? undefined,
    datePublished: article.pub_date ?? article.created_at,
    dateModified: article.updated_at ?? article.pub_date ?? article.created_at,
    inLanguage: 'ru',
    url: `${SITE_URL}/articles/${article.slug}`,
    image: article.cover_image_url ?? `${SITE_URL}/og-default.png`,
    author: {
      '@type': 'Organization',
      name: 'Malakhov AI Дайджест',
      url: SITE_URL,
    },
    publisher: {
      '@type': 'Organization',
      name: 'Malakhov AI Дайджест',
      url: SITE_URL,
      logo: { '@type': 'ImageObject', url: `${SITE_URL}/og-default.png` },
    },
  }

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
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
      <div className="mb-6 flex flex-wrap items-center gap-2 text-sm text-muted">
        <span className="inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium bg-accent text-white">
          {article.source_name}
        </span>
        <span>{time}</span>
        <span>·</span>
        <span>{readingMinutes} мин</span>
        {(article.topics ?? []).map((t) => (
          <TopicBadge key={t} topic={t} />
        ))}
      </div>

      {/* Лид */}
      {article.lead && (
        <p className="article-lead mb-6 text-[20px] font-semibold leading-relaxed text-[#e5e5e5]">
          {article.lead}
        </p>
      )}

      {/* Кратко */}
      {article.summary && article.summary.length > 0 && (
        <section className="article-summary mb-8 rounded-xl border border-white/10 bg-surface p-5">
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">
            Кратко
          </h3>
          <ul className="space-y-2">
            {article.summary.map((bullet, i) => (
              <li key={i} className="flex gap-2 text-[15px] text-[#d4d4d4]">
                <span className="mt-0.5 flex-shrink-0 text-accent">—</span>
                <span>{bullet}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Основной текст */}
      <div className="article-body mb-8 max-w-prose leading-relaxed text-[17px] text-[#d4d4d4]">
        {renderBodyWithAnchors(
          article.editorial_body ?? article.ru_text ?? '',
          anchorLinks
        )}

        {/* SEO-перелинковка: текстовые ссылки на похожие статьи */}
        {related.length > 0 && (
          <p className="mb-5 text-[15px] text-muted">
            <span>Читать также: </span>
            {related.map((rel, i) => (
              <span key={rel.id}>
                {i > 0 && <span className="mx-1 opacity-50">·</span>}
                <Link href={`/articles/${rel.slug}`} className="text-accent hover:underline">
                  {rel.ru_title ?? rel.original_title}
                </Link>
              </span>
            ))}
          </p>
        )}
      </div>

      {/* Inline-картинки из источника */}
      {article.article_images && article.article_images.length > 0 && (
        <div className="mb-8 space-y-4">
          {article.article_images.map((img, i) => (
            <figure key={i} className="overflow-hidden rounded-xl border border-white/10">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={img.src}
                alt={img.alt || title}
                className="w-full object-cover"
                loading="lazy"
              />
              {img.alt && (
                <figcaption className="px-4 py-2 text-sm text-muted">
                  {img.alt} · <span className="opacity-60">Фото: {article.source_name}</span>
                </figcaption>
              )}
            </figure>
          ))}
        </div>
      )}

      {/* Таблицы из источника */}
      {article.article_tables && article.article_tables.length > 0 && (
        <div className="mb-8 space-y-6">
          {article.article_tables.map((table, ti) => (
            <div key={ti} className="overflow-x-auto rounded-xl border border-white/10">
              <table className="w-full text-sm text-[#d4d4d4]">
                {table.headers.length > 0 && (
                  <thead className="bg-surface">
                    <tr>
                      {table.headers.map((h, hi) => (
                        <th
                          key={hi}
                          className="px-4 py-3 text-left font-semibold text-[#e5e5e5] border-b border-white/10"
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                )}
                <tbody>
                  {table.rows.map((row, ri) => (
                    <tr key={ri} className={ri % 2 === 0 ? '' : 'bg-white/[0.02]'}>
                      {row.map((cell, ci) => (
                        <td key={ci} className="px-4 py-2.5 border-b border-white/5">
                          {cell}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}

      {/* Глоссарий */}
      {article.glossary && article.glossary.length > 0 && (
        <details className="mb-8 group rounded-xl border border-white/10 bg-surface">
          <summary className="flex cursor-pointer items-center justify-between px-5 py-4 text-sm font-semibold text-[#e5e5e5] select-none list-none [&::-webkit-details-marker]:hidden">
            <span>Глоссарий · {article.glossary.length} {article.glossary.length === 1 ? 'термин' : article.glossary.length < 5 ? 'термина' : 'терминов'}</span>
            <span className="text-muted transition-transform group-open:rotate-180">▾</span>
          </summary>
          <dl className="divide-y divide-white/5 px-5 pb-4">
            {article.glossary.map((entry, i) => (
              <div key={i} className="py-3">
                <dt className="font-semibold text-[15px] text-accent">{entry.term}</dt>
                <dd className="mt-1 text-[14px] text-[#b0b0b0]">{entry.definition}</dd>
              </div>
            ))}
          </dl>
        </details>
      )}

      {/* Telegram CTA */}
      <TelegramCTA />

      {/* Подвал */}
      <footer className="border-t border-white/10 pt-5 text-sm text-muted">
        <p>
          Источник:{' '}
          <a
            href={article.original_url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-accent hover:underline"
          >
            {article.source_name}
          </a>
          {' '}· Переработано редакцией Malakhov AI Дайджест.
        </p>
      </footer>

      {/* Читать также */}
      {related.length > 0 && (
        <section className="mt-10 border-t border-white/10 pt-8">
          <h3 className="mb-4 text-lg font-bold text-[#e5e5e5]">Читать также</h3>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            {related.map((rel) => (
              <ArticleCard key={rel.id} article={rel} variant="compact" />
            ))}
          </div>
        </section>
      )}
    </article>
    </>
  )
}
