import type { ReactNode } from 'react'
import { notFound } from 'next/navigation'
import Image from 'next/image'
import Link from 'next/link'
import type { Metadata } from 'next'
import { getArticleBySlug, getAllSlugs, getRelatedArticles, resolveAnchorLinks } from '../../../lib/articles'
import { formatRelativeTime } from '../../../lib/utils'
import TopicBadge from '../../../src/components/TopicBadge'
import ArticleCard from '../../../src/components/ArticleCard'
import ReadingProgress from '../../../src/components/ReadingProgress'
import StickyArticleTitle from '../../../src/components/StickyArticleTitle'
import TelegramCTA from '../../../src/components/TelegramCTA'
import {
  EditorialEntityGrid,
  EditorialStatGrid,
  EditorialThesis,
  EditorialTimeline,
  EditorialPullQuote,
} from '../../../src/components/EditorialBlocks'
import type { Article } from '../../../lib/supabase'

export const revalidate = 3600

type AnchorLink = { anchor: string; slug: string; title: string }
type InlineImage = { src: string; alt: string }
type InlineTable = { headers: string[]; rows: string[][] }
type InlineInsertions = Record<number, ReactNode[]>

const SHOWCASE_SLUG = 'sequoia-sobrala-7-mlrd-na-novyy-fond-pochti-vdvoe-bolshe-pre-0dd089'

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

function isMeaningfulCaption(text: string): boolean {
  const value = text.trim()
  if (!value) return false
  if (/^https?:\/\//i.test(value)) return false
  if (/^[\w.-]+\.(png|jpg|jpeg|webp|gif|svg)$/i.test(value)) return false
  return value.length >= 12
}

function selectInlineImages(images: InlineImage[] | null | undefined): InlineImage[] {
  return (images ?? []).filter((img) => isMeaningfulCaption(img.alt)).slice(0, 2)
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

    // Auto pull-quote from summary: after paragraph 2
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
  // Не дублируем для showcase-статьи, где pull-quote уже в блоках
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
    alternates: { canonical: `/articles/${params.slug}` },
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
  const bodyParagraphs = renderBodyWithAnchors(
    article.editorial_body ?? article.ru_text ?? '',
    anchorLinks
  )
  const inlineTables = selectInlineTables(article.article_tables)
  const inlineImages = selectInlineImages(article.article_images)
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

      <article className="mx-auto max-w-4xl px-4 py-8 md:py-10">

        {/* Breadcrumb */}
        <nav className="mb-6 flex items-center gap-2 text-sm text-muted">
          <Link href="/" className="transition-colors hover:text-ink">Главная</Link>
          <span>→</span>
          <span>{article.source_name}</span>
        </nav>

        {/* Cover image — полная ширина, вне сетки */}
        {article.cover_image_url && (
          <div className="relative mb-8 w-full overflow-hidden rounded border border-line" style={{ maxHeight: 420 }}>
            <Image
              src={article.cover_image_url}
              alt={title}
              width={1200}
              height={420}
              className="w-full object-cover"
              style={{ maxHeight: 420 }}
              priority
            />
          </div>
        )}

        {/* Двухколоночная сетка: sidebar + main */}
        <div className="md:grid md:grid-cols-[200px_1fr] md:gap-12">

          {/* Sidebar — только на десктопе */}
          <aside className="hidden md:block">
            <div className="sticky top-[88px] space-y-6 border-r border-line pr-8 pt-1">

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

          {/* Основной контент */}
          <div className="min-w-0">

            <h1 className="mb-4 font-serif text-[26px] font-extrabold leading-[1.15] tracking-[-0.02em] text-ink md:text-[32px]">
              {title}
            </h1>

            {/* Мета — только на мобайле */}
            <div className="mb-5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-muted md:hidden">
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
              <p className="mb-6 text-[18px] font-semibold leading-relaxed text-ink">
                {article.lead}
              </p>
            )}

            {article.summary && article.summary.length > 0 && (
              <section className="mb-4 rounded border border-line bg-surface p-5">
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

            {article.glossary && article.glossary.length > 0 && (
              <details className="group mb-8 rounded border border-line bg-surface">
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

            <div className="article-body mb-8">
              {bodyContent}
            </div>

            <TelegramCTA />

          </div>
        </div>

        {/* Related — вне сетки, полная ширина */}
        {related.length > 0 && (
          <section className="mt-10 border-t border-line pt-8">
            <p className="mb-1 font-serif text-[10px] font-semibold uppercase tracking-[0.2em] text-muted">
              По теме
            </p>
            <h3 className="mb-5 font-serif text-xl font-bold text-ink">Читать также</h3>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
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
