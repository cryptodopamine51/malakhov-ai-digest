import type { Metadata } from 'next'
import Image from 'next/image'
import Link from 'next/link'
import { getArticlePath } from '../../../lib/article-slugs'
import { getLatestArticles } from '../../../lib/articles'
import type { Article } from '../../../lib/supabase'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Image Lab',
  description: 'Визуальный тест стратегий обложек для статей без картинки',
  robots: { index: false },
}

type LabArticle = Pick<
  Article,
  'slug' | 'ru_title' | 'original_title' | 'source_name' | 'topics' | 'cover_image_url' | 'card_teaser' | 'score'
>

type Palette = {
  paper: string
  surface: string
  ink: string
  muted: string
  accent: string
  accentTwo: string
  accentThree: string
}

type StockPhoto = {
  url: string
  credit: string
}

const SOURCES_WITH_TEXT_COVERS = new Set(['Habr AI', 'vc.ru', 'CNews'])

const FALLBACK_ARTICLES: LabArticle[] = [
  {
    slug: null,
    ru_title: 'OpenAI готовит новый режим агентной разработки для корпоративных команд',
    original_title: 'OpenAI prepares agentic development workflows for enterprise teams',
    source_name: 'OpenAI News',
    topics: ['ai-labs', 'coding'],
    cover_image_url: null,
    card_teaser: 'Агентные инструменты переходят от демо к рабочим процессам, где важны контроль, аудит и безопасность.',
    score: 8,
  },
  {
    slug: null,
    ru_title: 'Новый пакет регулирования ИИ усиливает требования к поставщикам моделей',
    original_title: 'New AI regulation package increases obligations for model providers',
    source_name: 'Reuters AI',
    topics: ['ai-industry'],
    cover_image_url: null,
    card_teaser: 'Регуляторы постепенно переводят AI-инфраструктуру в режим документируемой ответственности.',
    score: 7,
  },
  {
    slug: null,
    ru_title: 'Локальные LLM для кода становятся реальной альтернативой облачным ассистентам',
    original_title: 'Local coding LLMs become a practical alternative to cloud assistants',
    source_name: 'Habr AI',
    topics: ['coding', 'ai-russia'],
    cover_image_url: null,
    card_teaser: 'Команды снова считают стоимость, приватность и скорость, а не только качество benchmark.',
    score: 6,
  },
]

const STOCK_PHOTOS: Record<string, StockPhoto> = {
  coding: {
    url: 'https://images.unsplash.com/photo-1518770660439-4636190af475?auto=format&fit=crop&w=1400&q=80',
    credit: 'Unsplash / hardware detail',
  },
  'ai-labs': {
    url: 'https://images.unsplash.com/photo-1451187580459-43490279c0fa?auto=format&fit=crop&w=1400&q=80',
    credit: 'Unsplash / technology field',
  },
  'ai-industry': {
    url: 'https://images.unsplash.com/photo-1497366811353-6870744d04b2?auto=format&fit=crop&w=1400&q=80',
    credit: 'Unsplash / office systems',
  },
  'ai-investments': {
    url: 'https://images.unsplash.com/photo-1460925895917-afdab827c52f?auto=format&fit=crop&w=1400&q=80',
    credit: 'Unsplash / market screens',
  },
  'ai-startups': {
    url: 'https://images.unsplash.com/photo-1556761175-b413da4baf72?auto=format&fit=crop&w=1400&q=80',
    credit: 'Unsplash / startup work',
  },
  default: {
    url: 'https://images.unsplash.com/photo-1485827404703-89b55fcc595e?auto=format&fit=crop&w=1400&q=80',
    credit: 'Unsplash / robotics silhouette',
  },
}

const PALETTES: Palette[] = [
  {
    paper: '#f4efe7',
    surface: '#fffaf2',
    ink: '#232323',
    muted: '#8b8175',
    accent: '#d96f53',
    accentTwo: '#1d7a78',
    accentThree: '#d2a637',
  },
  {
    paper: '#eef2ef',
    surface: '#fbfcfa',
    ink: '#1f2726',
    muted: '#75807d',
    accent: '#2f6f9f',
    accentTwo: '#d47a4d',
    accentThree: '#b8a44a',
  },
  {
    paper: '#f0ece4',
    surface: '#fffdfa',
    ink: '#25211d',
    muted: '#7d7468',
    accent: '#3f7f6f',
    accentTwo: '#bd5f4a',
    accentThree: '#4f6d96',
  },
]

export default async function ImageLabPage() {
  let articles: LabArticle[] = []

  try {
    articles = await getLatestArticles(8)
  } catch (error) {
    console.error('image-lab load error:', error)
  }

  const source = articles.length > 0 ? articles : FALLBACK_ARTICLES

  return (
    <div className="mx-auto max-w-7xl overflow-x-hidden px-4 py-8 md:py-10">
      <section className="mb-8 border-y border-line py-7">
        <div className="grid min-w-0 gap-6 md:grid-cols-[1.2fr_0.8fr] md:items-end">
          <div className="min-w-0">
            <div className="mb-3 flex max-w-full flex-wrap gap-2 text-[11px] uppercase tracking-[0.16em] text-muted">
              <span className="max-w-full border border-line px-2.5 py-1">Image Lab</span>
              <span className="max-w-full border border-line px-2.5 py-1">0 USD baseline</span>
              <span className="max-w-full border border-line px-2.5 py-1">0.50 USD/day cap</span>
            </div>
            <h1 className="max-w-4xl break-words font-serif text-3xl font-extrabold leading-tight text-ink sm:text-4xl md:text-5xl">
              Тест обложек для статей без картинки
            </h1>
            <p className="mt-4 max-w-3xl text-sm leading-7 text-muted md:text-base">
              Один материал показывается в пяти режимах: картинка источника, бесплатный stock-treatment,
              локальная редакционная графика, банк обложек и платная AI-обложка только для важных статей.
            </p>
          </div>

          <div className="border border-line bg-surface p-5">
            <h2 className="font-serif text-xl font-bold text-ink">Что смотрим</h2>
            <p className="mt-3 text-sm leading-6 text-muted">
              Выбираем систему, которая выглядит как медиа: не случайная картинка, не скучная заглушка
              и не дорогая ручная работа на каждую новость.
            </p>
          </div>
        </div>
      </section>

      <section className="mb-8 grid gap-3 md:grid-cols-5">
        {[
          ['Source', '0 USD', 'если исходник дал чистую обложку'],
          ['Stock edit', '0 USD', 'Pexels/Pixabay/Unsplash + наш слой'],
          ['Local SVG', '0 USD', 'генерируется кодом без API'],
          ['Cover bank', '0 USD', 'готовый пул фирменных обложек'],
          ['AI budget', '<= $0.50/day', 'только top score / hero'],
        ].map(([title, price, note]) => (
          <div key={title} className="border border-line bg-base p-4">
            <div className="text-[11px] uppercase tracking-[0.16em] text-muted">{price}</div>
            <div className="mt-2 font-serif text-lg font-bold text-ink">{title}</div>
            <p className="mt-2 text-xs leading-5 text-muted">{note}</p>
          </div>
        ))}
      </section>

      <div className="space-y-10">
        {source.slice(0, 6).map((article, index) => (
          <ArticleLab key={`${article.slug ?? article.original_title}-${index}`} article={article} index={index} />
        ))}
      </div>
    </div>
  )
}

function ArticleLab({ article, index }: { article: LabArticle; index: number }) {
  const title = article.ru_title ?? article.original_title
  const href = article.slug ? getArticlePath(article.slug) : '#'

  return (
    <section className="border border-line bg-base">
      <div className="border-b border-line px-4 py-4 md:px-5">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <div className="mb-2 flex flex-wrap gap-2 text-[11px] uppercase tracking-[0.14em] text-muted">
              <span>{article.source_name}</span>
              <span>score {article.score ?? '-'}</span>
              <span>{(article.topics ?? []).slice(0, 2).join(' / ') || 'general'}</span>
            </div>
            <h2 className="max-w-4xl font-serif text-2xl font-bold leading-tight text-ink">{title}</h2>
            {article.card_teaser && (
              <p className="mt-2 max-w-3xl text-sm leading-6 text-muted">{article.card_teaser}</p>
            )}
          </div>
          {article.slug && (
            <Link href={href} className="shrink-0 border border-line px-3 py-2 text-sm text-ink transition-colors hover:bg-surface">
              Статья
            </Link>
          )}
        </div>
      </div>

      <div className="grid gap-4 p-4 md:grid-cols-2 xl:grid-cols-5">
        <CandidateCard label="Source" price="0 USD" verdict={getSourceImage(article) ? 'Самый релевантный вариант, если картинка чистая.' : 'Нет хорошей картинки или источник в denylist.'}>
          <SourceCandidate article={article} title={title} />
        </CandidateCard>
        <CandidateCard label="Stock edit" price="0 USD" verdict="Бесплатный фото-фон, но только с нашим editorial treatment.">
          <StockCandidate article={article} title={title} />
        </CandidateCard>
        <CandidateCard label="Local SVG" price="0 USD" verdict="Главный кандидат на бесплатный fallback для всех статей.">
          <LocalArtwork article={article} index={index} mode="system" />
        </CandidateCard>
        <CandidateCard label="Cover bank" price="0 USD" verdict="Готовый пул фирменных обложек по рубрикам; меньше риска, но возможны повторы.">
          <LocalArtwork article={article} index={index + 2} mode="archive" />
        </CandidateCard>
        <CandidateCard label="AI budget" price="~$0.016 low" verdict="Платно только для главных материалов; здесь показан целевой арт-дирекшен.">
          <LocalArtwork article={article} index={index + 4} mode="ai" />
        </CandidateCard>
      </div>
    </section>
  )
}

function CandidateCard({
  label,
  price,
  verdict,
  children,
}: {
  label: string
  price: string
  verdict: string
  children: React.ReactNode
}) {
  return (
    <article className="flex min-h-full flex-col border border-line bg-surface">
      <div className="aspect-[16/10] overflow-hidden bg-base">{children}</div>
      <div className="flex flex-1 flex-col gap-2 p-3">
        <div className="flex items-center justify-between gap-3">
          <h3 className="font-serif text-base font-bold text-ink">{label}</h3>
          <span className="shrink-0 border border-line bg-base px-2 py-1 text-[10px] uppercase tracking-[0.12em] text-muted">
            {price}
          </span>
        </div>
        <p className="text-xs leading-5 text-muted">{verdict}</p>
      </div>
    </article>
  )
}

function SourceCandidate({ article, title }: { article: LabArticle; title: string }) {
  const sourceImage = getSourceImage(article)

  if (!sourceImage) return <EmptyImage label="source missing" />

  return (
    <div className="relative h-full w-full">
      <Image src={sourceImage} alt={title} fill sizes="20vw" className="object-cover" unoptimized />
      <div className="absolute inset-0 bg-gradient-to-t from-black/35 via-transparent to-transparent" />
      <div className="absolute bottom-2 left-2 border border-white/30 bg-black/55 px-2 py-1 text-[10px] uppercase tracking-[0.12em] text-white">
        source image
      </div>
    </div>
  )
}

function StockCandidate({ article, title }: { article: LabArticle; title: string }) {
  const stock = getStockPhoto(article)

  return (
    <div className="relative h-full w-full overflow-hidden">
      <Image src={stock.url} alt={title} fill sizes="20vw" className="object-cover saturate-[0.55]" unoptimized />
      <div className="absolute inset-0 bg-[#1f2726]/35 mix-blend-multiply" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_28%_24%,rgba(217,111,83,0.62),transparent_32%),linear-gradient(135deg,rgba(244,239,231,0.72),transparent_42%)]" />
      <div className="absolute left-4 top-4 h-16 w-28 border border-white/55" />
      <div className="absolute bottom-3 left-3 right-3 flex items-end justify-between gap-3">
        <div className="h-14 w-24 bg-white/78" />
        <div className="max-w-[58%] bg-black/55 px-2 py-1 text-[9px] uppercase tracking-[0.1em] text-white">
          {stock.credit}
        </div>
      </div>
    </div>
  )
}

function LocalArtwork({ article, index, mode }: { article: LabArticle; index: number; mode: 'system' | 'archive' | 'ai' }) {
  const palette = PALETTES[index % PALETTES.length]
  const title = article.ru_title ?? article.original_title
  const topic = (article.topics ?? [])[0] ?? 'general'
  const uid = `${mode}-${index}-${topic}`.replace(/[^a-z0-9-]/gi, '-')

  return (
    <svg viewBox="0 0 1200 750" className="block h-full w-full" role="img" aria-label={`${mode} cover for ${title}`}>
      <defs>
        <linearGradient id={`${uid}-paper`} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor={palette.surface} />
          <stop offset="100%" stopColor={palette.paper} />
        </linearGradient>
        <radialGradient id={`${uid}-glow`} cx="72%" cy="28%" r="48%">
          <stop offset="0%" stopColor={palette.accent} stopOpacity="0.38" />
          <stop offset="100%" stopColor={palette.accent} stopOpacity="0" />
        </radialGradient>
        <pattern id={`${uid}-grain`} width="18" height="18" patternUnits="userSpaceOnUse">
          <path d="M 0 9 H 18 M 9 0 V 18" stroke={palette.ink} strokeOpacity="0.035" />
        </pattern>
      </defs>
      <rect width="1200" height="750" fill={`url(#${uid}-paper)`} />
      <rect width="1200" height="750" fill={`url(#${uid}-grain)`} />
      <circle cx="850" cy="210" r="285" fill={`url(#${uid}-glow)`} />
      {mode === 'system' && <SystemMotif palette={palette} topic={topic} />}
      {mode === 'archive' && <ArchiveMotif palette={palette} topic={topic} />}
      {mode === 'ai' && <AIMotif palette={palette} topic={topic} />}
      <rect x="58" y="58" width="1084" height="634" fill="none" stroke={palette.ink} strokeOpacity="0.18" />
      <text x="78" y="102" fill={palette.muted} fontSize="22" fontFamily="Arial, sans-serif" letterSpacing="5">
        {topic.toUpperCase().slice(0, 22)}
      </text>
      <text x="78" y="650" fill={palette.ink} fontSize="24" fontFamily="Arial, sans-serif" letterSpacing="4">
        MALAKHOV AI DIGEST
      </text>
    </svg>
  )
}

function SystemMotif({ palette, topic }: { palette: Palette; topic: string }) {
  return (
    <g>
      <rect x="120" y="170" width="360" height="310" fill={palette.ink} fillOpacity="0.9" />
      <rect x="172" y="220" width="256" height="36" fill={palette.surface} fillOpacity="0.92" />
      <rect x="172" y="286" width="186" height="24" fill={palette.accent} fillOpacity="0.82" />
      <rect x="172" y="336" width="236" height="24" fill={palette.accentTwo} fillOpacity="0.74" />
      <rect x="560" y="145" width="360" height="360" fill={palette.accentTwo} fillOpacity="0.18" stroke={palette.ink} strokeOpacity="0.22" />
      {Array.from({ length: 8 }).map((_, i) => (
        <line key={i} x1="560" y1={170 + i * 42} x2="920" y2={145 + i * 48} stroke={i % 2 === 0 ? palette.accent : palette.accentThree} strokeWidth="8" strokeOpacity="0.46" />
      ))}
      <circle cx="854" cy="458" r="74" fill={palette.accent} fillOpacity="0.88" />
      <text x="645" y="596" fill={palette.muted} fontSize="18" fontFamily="Arial, sans-serif" letterSpacing="3">
        {topic === 'coding' ? 'LOCAL SYSTEM' : 'SIGNAL SYSTEM'}
      </text>
    </g>
  )
}

function ArchiveMotif({ palette, topic }: { palette: Palette; topic: string }) {
  return (
    <g>
      <rect x="122" y="142" width="340" height="430" fill={palette.surface} stroke={palette.ink} strokeOpacity="0.22" />
      <rect x="162" y="190" width="220" height="28" fill={palette.ink} fillOpacity="0.78" />
      <rect x="162" y="250" width="240" height="16" fill={palette.muted} fillOpacity="0.38" />
      <rect x="162" y="286" width="186" height="16" fill={palette.muted} fillOpacity="0.38" />
      <rect x="162" y="322" width="260" height="16" fill={palette.muted} fillOpacity="0.38" />
      <rect x="538" y="118" width="380" height="454" fill={palette.accentThree} fillOpacity="0.18" stroke={palette.ink} strokeOpacity="0.2" />
      <path d="M 604 456 C 676 326, 754 360, 824 202" fill="none" stroke={palette.accent} strokeWidth="24" strokeLinecap="round" />
      <circle cx="604" cy="456" r="34" fill={palette.ink} />
      <circle cx="824" cy="202" r="46" fill={palette.accentTwo} />
      <path d="M 958 162 L 1088 162 L 1088 574 L 958 574 Z" fill={palette.ink} fillOpacity="0.86" />
      <text x="980" y="522" fill={palette.surface} fontSize="18" fontFamily="Arial, sans-serif" letterSpacing="4" transform="rotate(-90 980 522)">
        {topic.toUpperCase().slice(0, 16)}
      </text>
    </g>
  )
}

function AIMotif({ palette, topic }: { palette: Palette; topic: string }) {
  return (
    <g>
      <path d="M 166 520 L 332 170 L 512 530 Z" fill={palette.accent} fillOpacity="0.86" />
      <path d="M 430 154 L 780 132 L 650 548 Z" fill={palette.ink} fillOpacity="0.9" />
      <path d="M 728 244 L 1024 186 L 936 570 L 690 512 Z" fill={palette.accentTwo} fillOpacity="0.78" />
      <circle cx="574" cy="360" r="96" fill={palette.surface} fillOpacity="0.9" />
      <circle cx="574" cy="360" r="48" fill={palette.accentThree} fillOpacity="0.9" />
      <path d="M 246 606 C 438 546, 648 626, 942 586" fill="none" stroke={palette.ink} strokeOpacity="0.24" strokeWidth="12" />
      {Array.from({ length: 9 }).map((_, i) => (
        <circle key={i} cx={220 + i * 92} cy={198 + ((i * 53) % 260)} r={i % 3 === 0 ? 13 : 8} fill={i % 2 === 0 ? palette.surface : palette.accentThree} stroke={palette.ink} strokeOpacity="0.32" />
      ))}
      <text x="786" y="626" fill={palette.muted} fontSize="18" fontFamily="Arial, sans-serif" letterSpacing="3">
        AI COVER TARGET / {topic.toUpperCase().slice(0, 10)}
      </text>
    </g>
  )
}

function EmptyImage({ label }: { label: string }) {
  return (
    <div className="flex h-full w-full items-center justify-center bg-base">
      <div className="text-center">
        <div className="mx-auto h-16 w-24 border border-line" />
        <div className="mt-3 text-[10px] uppercase tracking-[0.16em] text-muted">{label}</div>
      </div>
    </div>
  )
}

function getSourceImage(article: LabArticle): string | null {
  if (SOURCES_WITH_TEXT_COVERS.has(article.source_name)) return null
  return article.cover_image_url ?? null
}

function getStockPhoto(article: LabArticle): StockPhoto {
  const topics = article.topics ?? []
  for (const topic of topics) {
    if (STOCK_PHOTOS[topic]) return STOCK_PHOTOS[topic]
  }
  return STOCK_PHOTOS.default
}
