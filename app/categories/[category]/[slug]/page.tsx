import type { ReactNode } from 'react'
import { notFound, permanentRedirect } from 'next/navigation'
import Image from 'next/image'
import Link from 'next/link'
import type { Metadata } from 'next'
import { getArticleBySlug, getRelatedArticles, resolveAnchorLinks } from '../../../../lib/articles'
import { getArticlePath, toPublicArticleSlug } from '../../../../lib/article-slugs'
import { getCategoryMeta } from '../../../../lib/category-meta'
import { isKnownCategory, DEFAULT_CATEGORY } from '../../../../lib/categories'
import { SITE_URL, absoluteUrl } from '../../../../lib/site'
import { formatRelativeTime } from '../../../../lib/utils'
import TopicBadge from '../../../../src/components/TopicBadge'
import ArticleCard from '../../../../src/components/ArticleCard'
import ReadingProgress from '../../../../src/components/ReadingProgress'
import StickyArticleTitle from '../../../../src/components/StickyArticleTitle'
import TelegramCTA from '../../../../src/components/TelegramCTA'
import {
  EditorialEntityGrid,
  EditorialStatGrid,
  EditorialThesis,
  EditorialTimeline,
  EditorialPullQuote,
} from '../../../../src/components/EditorialBlocks'
import { getPublicReadClient, type Article } from '../../../../lib/supabase'
import { sanitizeArticleImagesForRender, sanitizeArticleMedia } from '../../../../lib/media-sanitizer'

export const revalidate = 3600

type AnchorLink = { anchor: string; slug: string; primaryCategory: string; title: string }
type InlineImage = { src: string; alt: string }
type InlineTable = { headers: string[]; rows: string[][] }
type InlineInsertions = Record<number, ReactNode[]>
type ExtractedVideo = NonNullable<Article['article_videos']>[number]

const SHOWCASE_SLUG = 'sequoia-sobrala-7-mlrd-na-novyy-fond-pochti-vdvoe-bolshe-pre-0dd089'

const SOURCES_WITH_TEXT_COVERS = new Set(['Habr AI', 'vc.ru', 'CNews'])

function isArticleImagesStorageUrl(value: string | null): boolean {
  if (!value) return false
  try {
    const url = new URL(value)
    return url.pathname.includes('/storage/v1/object/public/article-images/')
  } catch {
    return false
  }
}

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
        <Link
          href={getArticlePath(assigned.slug, assigned.primaryCategory)}
          className="text-accent underline decoration-accent/40 hover:decoration-accent transition-colors"
        >
          {assigned.anchor}
        </Link>
        {after}
      </p>
    )
  })
}

function sanitizeArticleForRender(article: Article): { coverImageUrl: string | null; inlineImages: InlineImage[] } {
  const context = {
    sourceName: article.source_name,
    originalUrl: article.original_url,
    originalTitle: article.original_title,
    ruTitle: article.ru_title,
    lead: article.lead,
    summary: article.summary,
    originalText: article.original_text ?? article.editorial_body,
  }
  const media = sanitizeArticleMedia({
    coverImageUrl: article.cover_image_url,
    articleImages: article.article_images,
    context,
  })

  return {
    coverImageUrl: media.coverImageUrl,
    inlineImages: sanitizeArticleImagesForRender(article.article_images, context, 2),
  }
}

function selectInlineTables(tables: InlineTable[] | null | undefined): InlineTable[] {
  return (tables ?? []).filter((table) => table.rows.length > 0).slice(0, 1)
}

function renderInlineTable(table: InlineTable, key: string): ReactNode {
  return (
    <div key={key} className="my-8 overflow-x-auto rounded border border-line">
      <table className="w-full text-sm text-ink">
        {table.headers.length > 0 && (
          <thead className="bg-surface">
            <tr>
              {table.headers.map((h, hi) => (
                <th key={hi} className="border-b border-line px-4 py-3 text-left font-semibold text-ink">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
        )}
        <tbody>
          {table.rows.map((row, ri) => (
            <tr key={ri} className="border-b border-line last:border-b-0">
              {row.map((cell, ci) => (
                <td key={ci} className="px-4 py-2.5">{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function renderInlineImage(image: InlineImage, sourceName: string, fallbackAlt: string, key: string): ReactNode {
  return (
    <figure key={key} className="my-8 overflow-hidden rounded border border-line">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={image.src}
        alt={image.alt || fallbackAlt}
        className="w-full object-cover"
        loading="lazy"
      />
      <figcaption className="px-4 py-2 text-xs text-muted">
        {image.alt} · <span className="opacity-60">Источник: {sourceName}</span>
      </figcaption>
    </figure>
  )
}

function renderInlineVideo(video: ExtractedVideo, sourceName: string, key: string): ReactNode {
  const title = video.title || 'Видео по теме'

  if (video.provider === 'direct') {
    return (
      <figure key={key} className="mb-8 overflow-hidden rounded border border-line">
        <video
          className="w-full"
          controls
          preload="metadata"
          poster={video.poster ?? undefined}
        >
          <source src={video.embedUrl} />
        </video>
        <figcaption className="px-4 py-2 text-xs text-muted">
          {title} · <span className="opacity-60">Источник: {sourceName}</span>
        </figcaption>
      </figure>
    )
  }

  return (
    <figure key={key} className="mb-8">
      <div className="relative aspect-video overflow-hidden rounded border border-line bg-surface">
        <iframe
          src={video.embedUrl}
          title={title}
          className="absolute inset-0 h-full w-full"
          loading="lazy"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          referrerPolicy="strict-origin-when-cross-origin"
          allowFullScreen
        />
      </div>
      <figcaption className="px-1 pt-2 text-xs text-muted">
        {title} · <span className="opacity-60">Источник: {sourceName}</span>
      </figcaption>
    </figure>
  )
}

function interleaveBodyMedia(
  paragraphs: ReactNode[],
  tables: InlineTable[],
  images: InlineImage[],
  sourceName: string,
  title: string,
  insertions: InlineInsertions = {},
  pullQuote: string | null = null,
): ReactNode[] {
  const result: ReactNode[] = []
  let tableIndex = 0
  let imageIndex = 0

  paragraphs.forEach((paragraph, index) => {
    result.push(paragraph)

    if (insertions[index]) {
      result.push(...insertions[index])
    }

    if (pullQuote && index === 2) {
      result.push(
        <EditorialPullQuote key="auto-pullquote" text={pullQuote} />
      )
    }

    if (tableIndex < tables.length && index === 1) {
      result.push(renderInlineTable(tables[tableIndex], `table-${tableIndex}`))
      tableIndex++
    }

    if (imageIndex < images.length && index === 2) {
      result.push(renderInlineImage(images[imageIndex], sourceName, title, `image-${imageIndex}`))
      imageIndex++
    }
  })

  while (tableIndex < tables.length) {
    result.push(renderInlineTable(tables[tableIndex], `table-tail-${tableIndex}`))
    tableIndex++
  }

  while (imageIndex < images.length) {
    result.push(renderInlineImage(images[imageIndex], sourceName, title, `image-tail-${imageIndex}`))
    imageIndex++
  }

  return result
}

function getAutoPullQuote(article: Article): string | null {
  if (article.slug === SHOWCASE_SLUG) return null
  if (!article.summary || article.summary.length < 3) return null
  if (article.score < 3) return null
  const candidate = article.summary[1]
  if (!candidate || candidate.length < 50) return null
  return candidate
}

function getEditorialShowcase(slug: string): {
  preBody?: ReactNode
  inlineInsertions?: InlineInsertions
} {
  if (slug !== SHOWCASE_SLUG) return {}

  return {
    preBody: (
      <EditorialStatGrid
        kicker="Editorial Example"
        title="Сигнальная панель сделки"
        items={[
          {
            label: 'Новый фонд',
            value: '$7B',
            note: 'Новый expansion-фонд Sequoia почти вдвое крупнее аналогичного фонда 2022 года.',
          },
          {
            label: 'Предыдущий цикл',
            value: '$3.4B',
            note: 'Прошлый late-stage фонд был закрыт в 2022 году и задаёт понятную базу для сравнения.',
          },
          {
            label: 'IPO-окно',
            value: '2026',
            note: 'OpenAI и Anthropic рассматриваются как потенциальные бенефициары публичного рынка.',
          },
        ]}
      />
    ),
    inlineInsertions: {
      0: [
        <EditorialTimeline
          key="showcase-timeline"
          title="Как читать этот фонд по таймлайну"
          items={[
            {
              year: '2022',
              title: 'Предыдущий expansion-фонд на $3,4 млрд',
              description: 'Отправная точка: новый сбор позволяет измерить не просто рост аппетита Sequoia, а изменение масштаба late-stage рынка.',
            },
            {
              year: '2025',
              title: 'Смена управленческого ядра',
              description: 'Альфред Лин и Пэт Грейди берут на себя совместное руководство фирмой, и рынок оценивает их первый крупный raise уже как отдельный сигнал.',
            },
            {
              year: '2026',
              title: 'Фонд на $7 млрд под зрелый AI-цикл',
              description: 'Фокус смещается в поздние стадии, где чеки крупнее, компании ближе к IPO, а выигрыш определяется качеством позиций.',
            },
          ]}
        />,
      ],
      2: [
        <EditorialEntityGrid
          key="showcase-entities"
          title="На какие активы этот фонд похож по профилю"
          intro="Редакционная схема, которая помогает быстро понять, где именно Sequoia видит upside в AI-цикле."
          items={[
            {
              name: 'OpenAI',
              role: 'Core model',
              note: 'Ставка на лидера foundation-model рынка и на потенциальный выход в публичный статус при максимальной ликвидности.',
            },
            {
              name: 'Anthropic',
              role: 'Second pole',
              note: 'Второй системный игрок LLM-рынка, который усиливает позицию Sequoia не одной ставкой, а парой доминирующих платформ.',
            },
            {
              name: 'Physical Intelligence',
              role: 'Robotics',
              note: 'Выход за пределы pure software: ставка на соединение foundation-моделей с физическим миром.',
            },
            {
              name: 'Factory',
              role: 'AI agents',
              note: 'Экспозиция на корпоративных агентов и инженерную автоматизацию, где late-stage капитал масштабирует уже работающий продукт.',
            },
          ]}
        />,
        <EditorialThesis key="showcase-thesis" title="Почему здесь уместен именно свой блок, а не чужая картинка">
          Здесь важнее не иллюстрация офиса Sequoia, а быстрая раскладка по капиталу, этапам и типам активов.
          Такой блок работает как редакционная навигация: читатель за 20 секунд понимает масштаб фонда,
          контекст смены руководства и то, куда именно фирма ставит деньги в AI-цикле.
        </EditorialThesis>,
      ],
    },
  }
}

export async function generateStaticParams() {
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
  const supabase = getPublicReadClient()
  const { data, error } = await supabase
    .from('articles')
    .select('slug, primary_category')
    .eq('publish_status', 'live')
    .eq('verified_live', true)
    .not('slug', 'is', null)
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(300)

  if (error) {
    console.error('generateStaticParams categories/[category]/[slug] error:', error.message)
    return []
  }

  const params: { category: string; slug: string }[] = []
  for (const row of data ?? []) {
    if (!row.slug) continue
    const category = row.primary_category && isKnownCategory(row.primary_category)
      ? row.primary_category
      : DEFAULT_CATEGORY
    params.push({ category, slug: toPublicArticleSlug(row.slug) })
  }
  return params
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ category: string; slug: string }>
}): Promise<Metadata> {
  const { slug } = await params
  const article = await getArticleBySlug(slug)
  if (!article) return {}

  const title = article.ru_title ?? article.original_title
  const description = article.card_teaser ?? article.lead ?? undefined
  const publicSlug = article.slug ? toPublicArticleSlug(article.slug) : slug
  const canonicalPath = getArticlePath(publicSlug, article.primary_category)
  const { coverImageUrl } = sanitizeArticleForRender(article)

  return {
    title,
    description,
    alternates: { canonical: canonicalPath },
    openGraph: {
      title,
      description,
      type: 'article',
      url: absoluteUrl(canonicalPath),
      publishedTime: article.pub_date ?? article.created_at,
      modifiedTime: article.updated_at,
      images: coverImageUrl ? [coverImageUrl] : ['/og-default.png'],
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: coverImageUrl ? [coverImageUrl] : ['/og-default.png'],
    },
    other: {
      'twitter:url': absoluteUrl(canonicalPath),
    },
  }
}

export default async function CategoryArticlePage({
  params,
}: {
  params: Promise<{ category: string; slug: string }>
}) {
  const { category, slug } = await params
  const article = await getArticleBySlug(slug)
  if (!article || article.quality_ok !== true) notFound()

  const publicSlug = article.slug ? toPublicArticleSlug(article.slug) : slug
  const canonicalPath = getArticlePath(publicSlug, article.primary_category)

  // Если URL пришёл с legacy hex-хвостом или с неверной категорией — редиректим на canonical
  if (slug !== publicSlug || category !== article.primary_category) {
    permanentRedirect(canonicalPath)
  }

  const inlineVideos = article.article_videos ?? []

  const [related, anchorLinks] = await Promise.all([
    getRelatedArticles(article.primary_category, article.id, 3),
    resolveAnchorLinks(article.link_anchors ?? [], article.id),
  ])

  const title = article.ru_title ?? article.original_title
  const sanitizedMedia = sanitizeArticleForRender(article)
  const time = formatRelativeTime(article.pub_date ?? article.created_at)
  const bodyParagraphs = renderBodyWithAnchors(
    article.editorial_body ?? article.ru_text ?? '',
    anchorLinks
  )
  const inlineTables = selectInlineTables(article.article_tables)
  const inlineImages = sanitizedMedia.inlineImages
  const primaryVideo = inlineVideos[0] ?? null
  const showcase = getEditorialShowcase(article.slug ?? '')
  const autoPullQuote = getAutoPullQuote(article)
  const bodyContent = interleaveBodyMedia(
    bodyParagraphs,
    inlineTables,
    inlineImages,
    article.source_name,
    title,
    showcase.inlineInsertions,
    autoPullQuote,
  )

  const bodyLength = (article.editorial_body ?? article.ru_text ?? '').length
  const readingMinutes = Math.max(1, Math.round(bodyLength / 1200))
  const readingText = bodyLength < 600 ? '~1 мин' : `${readingMinutes} мин`

  const categoryMeta = getCategoryMeta(article.primary_category)
  const categoryLabel = categoryMeta?.shortLabel ?? article.primary_category

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'NewsArticle',
    headline: title,
    description: article.card_teaser ?? article.lead ?? undefined,
    datePublished: article.pub_date ?? article.created_at,
    dateModified: article.updated_at ?? article.pub_date ?? article.created_at,
    inLanguage: 'ru',
    url: `${SITE_URL}${canonicalPath}`,
    image: sanitizedMedia.coverImageUrl ?? `${SITE_URL}/og-default.png`,
    video: primaryVideo ? {
      '@type': 'VideoObject',
      name: primaryVideo.title || title,
      embedUrl: primaryVideo.embedUrl,
      contentUrl: primaryVideo.sourceUrl,
      thumbnailUrl: primaryVideo.poster ?? sanitizedMedia.coverImageUrl ?? undefined,
    } : undefined,
    author: { '@type': 'Organization', name: 'Malakhov AI Дайджест', url: SITE_URL },
    publisher: {
      '@type': 'Organization',
      name: 'Malakhov AI Дайджест',
      url: SITE_URL,
      logo: { '@type': 'ImageObject', url: `${SITE_URL}/og-default.png` },
    },
  }

  return (
    <>
      <ReadingProgress />
      <StickyArticleTitle title={title} />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      <article className="mx-auto max-w-5xl px-4 py-8 md:py-10 lg:py-12">

        {/* Breadcrumb: Главная → Категория → Статья */}
        <nav className="mb-6 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted" aria-label="Хлебные крошки">
          <Link href="/" className="transition-colors hover:text-ink">Главная</Link>
          <span aria-hidden>→</span>
          <Link
            href={`/categories/${article.primary_category}`}
            className="transition-colors hover:text-ink"
          >
            {categoryLabel}
          </Link>
          <span aria-hidden>→</span>
          <span>{article.source_name}</span>
        </nav>

        {/* Cover image */}
        {sanitizedMedia.coverImageUrl && (!SOURCES_WITH_TEXT_COVERS.has(article.source_name) || isArticleImagesStorageUrl(sanitizedMedia.coverImageUrl)) && (
          <div className="relative mb-10 w-full overflow-hidden rounded border border-line" style={{ maxHeight: 460 }}>
            <Image
              src={sanitizedMedia.coverImageUrl}
              alt={title}
              width={1200}
              height={460}
              className="w-full object-cover"
              style={{ maxHeight: 460 }}
              priority
            />
          </div>
        )}

        <div className="lg:grid lg:grid-cols-[220px_minmax(0,1fr)] lg:gap-14">

          <aside className="hidden lg:block">
            <div className="sticky top-[88px] space-y-7 border-r border-line pr-8 pt-1">

              <div>
                <p className="mb-1.5 font-serif text-[10px] font-semibold uppercase tracking-[0.2em] text-muted">
                  Источник
                </p>
                <a
                  href={article.original_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[13px] font-medium text-ink transition-colors hover:text-accent"
                >
                  {article.source_name}
                </a>
              </div>

              <div>
                <p className="mb-1.5 font-serif text-[10px] font-semibold uppercase tracking-[0.2em] text-muted">
                  Дата
                </p>
                <p className="text-[13px] text-ink">{time}</p>
              </div>

              <div>
                <p className="mb-1.5 font-serif text-[10px] font-semibold uppercase tracking-[0.2em] text-muted">
                  Чтение
                </p>
                <p className="text-[13px] text-ink">{readingText}</p>
              </div>

              {(article.topics ?? []).length > 0 && (
                <div>
                  <p className="mb-2 font-serif text-[10px] font-semibold uppercase tracking-[0.2em] text-muted">
                    Темы
                  </p>
                  <div className="flex flex-col gap-1.5">
                    {(article.topics ?? []).map((t) => (
                      <TopicBadge key={t} topic={t} />
                    ))}
                  </div>
                </div>
              )}

              {article.why_it_matters && (
                <div className="border-l-2 border-accent/30 pl-3">
                  <p className="text-[12px] italic leading-relaxed text-muted">
                    {article.why_it_matters}
                  </p>
                </div>
              )}

            </div>
          </aside>

          <div className="min-w-0">

            <h1 className="mb-4 font-serif text-[26px] font-extrabold leading-[1.15] tracking-[-0.02em] text-ink md:text-[32px]">
              {title}
            </h1>

            <div className="mb-6 flex flex-wrap items-center gap-x-2 gap-y-2 text-[13px] text-muted lg:hidden">
              <span>{article.source_name}</span>
              <span>·</span>
              <span>{time}</span>
              <span>·</span>
              <span>{readingText}</span>
              {(article.topics ?? []).map((t) => (
                <TopicBadge key={t} topic={t} />
              ))}
            </div>

            {article.lead && (
              <p className="mb-8 max-w-3xl text-[18px] font-semibold leading-relaxed text-ink md:text-[19px]">
                {article.lead}
              </p>
            )}

            {article.summary && article.summary.length > 0 && (
              <section className="mb-8 max-w-3xl rounded border border-line bg-surface p-5 md:p-6">
                <h3 className="mb-3 font-serif text-[10px] font-semibold uppercase tracking-[0.2em] text-muted">
                  Кратко
                </h3>
                <ul className="space-y-2">
                  {article.summary.map((bullet, i) => (
                    <li key={i} className="flex gap-2 text-[15px] text-ink">
                      <span className="mt-0.5 flex-shrink-0 text-accent">—</span>
                      <span>{bullet}</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {primaryVideo && (
              <section className="mb-8 max-w-3xl">
                <div className="mb-3 font-serif text-[10px] font-semibold uppercase tracking-[0.2em] text-muted">
                  Видео по теме
                </div>
                {renderInlineVideo(primaryVideo, article.source_name, 'primary-video')}
              </section>
            )}

            {article.glossary && article.glossary.length > 0 && (
              <details className="group mb-10 max-w-3xl rounded border border-line bg-surface">
                <summary className="flex cursor-pointer list-none items-center justify-between px-5 py-4 text-sm font-semibold text-ink select-none [&::-webkit-details-marker]:hidden">
                  <span>
                    Глоссарий · {article.glossary.length}{' '}
                    {article.glossary.length === 1 ? 'термин' : article.glossary.length < 5 ? 'термина' : 'терминов'}
                  </span>
                  <span className="text-muted transition-transform duration-200 group-open:rotate-180">▾</span>
                </summary>
                <div className="glossary-body">
                  <dl className="divide-y divide-line px-5 pb-4">
                    {article.glossary.map((entry, i) => (
                      <div key={i} className="py-3">
                        <dt className="text-[15px] font-semibold text-accent">{entry.term}</dt>
                        <dd className="mt-1 text-[14px] text-muted">{entry.definition}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              </details>
            )}

            {showcase.preBody}

            <div className="article-body mb-10">
              {bodyContent}
            </div>

            <TelegramCTA />

          </div>
        </div>

        {related.length > 0 && (
          <section className="mt-14 border-t border-line pt-10">
            <p className="mb-1 font-serif text-[10px] font-semibold uppercase tracking-[0.2em] text-muted">
              По теме
            </p>
            <h3 className="mb-5 font-serif text-xl font-bold text-ink">Читать также</h3>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {related.map((rel) => (
                <ArticleCard key={rel.id} article={rel} variant="related" />
              ))}
            </div>
          </section>
        )}

        <footer className="mt-8 border-t border-line pt-5 text-sm text-muted">
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

      </article>
    </>
  )
}
