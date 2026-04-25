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

type ArtworkMode = 'system' | 'archive' | 'ai'

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

const STOCK_PHOTOS: Record<string, StockPhoto[]> = {
  coding: [
    {
      url: 'https://images.unsplash.com/photo-1518770660439-4636190af475?auto=format&fit=crop&w=1400&q=80',
      credit: 'Unsplash / hardware detail',
    },
    {
      url: 'https://images.unsplash.com/photo-1550745165-9bc0b252726f?auto=format&fit=crop&w=1400&q=80',
      credit: 'Unsplash / machine detail',
    },
    {
      url: 'https://images.unsplash.com/photo-1558494949-ef010cbdcc31?auto=format&fit=crop&w=1400&q=80',
      credit: 'Unsplash / server field',
    },
  ],
  'ai-labs': [
    {
      url: 'https://images.unsplash.com/photo-1451187580459-43490279c0fa?auto=format&fit=crop&w=1400&q=80',
      credit: 'Unsplash / technology field',
    },
    {
      url: 'https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=1400&q=80',
      credit: 'Unsplash / research landscape',
    },
    {
      url: 'https://images.unsplash.com/photo-1532187863486-abf9dbad1b69?auto=format&fit=crop&w=1400&q=80',
      credit: 'Unsplash / lab glass',
    },
  ],
  'ai-industry': [
    {
      url: 'https://images.unsplash.com/photo-1497366811353-6870744d04b2?auto=format&fit=crop&w=1400&q=80',
      credit: 'Unsplash / office systems',
    },
    {
      url: 'https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?auto=format&fit=crop&w=1400&q=80',
      credit: 'Unsplash / city stack',
    },
    {
      url: 'https://images.unsplash.com/photo-1504384308090-c894fdcc538d?auto=format&fit=crop&w=1400&q=80',
      credit: 'Unsplash / work floor',
    },
  ],
  'ai-investments': [
    {
      url: 'https://images.unsplash.com/photo-1460925895917-afdab827c52f?auto=format&fit=crop&w=1400&q=80',
      credit: 'Unsplash / market screens',
    },
    {
      url: 'https://images.unsplash.com/photo-1551288049-bebda4e38f71?auto=format&fit=crop&w=1400&q=80',
      credit: 'Unsplash / data wall',
    },
    {
      url: 'https://images.unsplash.com/photo-1642790106117-e829e14a795f?auto=format&fit=crop&w=1400&q=80',
      credit: 'Unsplash / market chart',
    },
  ],
  'ai-startups': [
    {
      url: 'https://images.unsplash.com/photo-1556761175-b413da4baf72?auto=format&fit=crop&w=1400&q=80',
      credit: 'Unsplash / startup work',
    },
    {
      url: 'https://images.unsplash.com/photo-1517048676732-d65bc937f952?auto=format&fit=crop&w=1400&q=80',
      credit: 'Unsplash / team table',
    },
    {
      url: 'https://images.unsplash.com/photo-1559136555-9303baea8ebd?auto=format&fit=crop&w=1400&q=80',
      credit: 'Unsplash / founder desk',
    },
  ],
  default: [
    {
      url: 'https://images.unsplash.com/photo-1485827404703-89b55fcc595e?auto=format&fit=crop&w=1400&q=80',
      credit: 'Unsplash / robotics silhouette',
    },
    {
      url: 'https://images.unsplash.com/photo-1518005020951-eccb494ad742?auto=format&fit=crop&w=1400&q=80',
      credit: 'Unsplash / abstract structure',
    },
    {
      url: 'https://images.unsplash.com/photo-1500534314209-a25ddb2bd429?auto=format&fit=crop&w=1400&q=80',
      credit: 'Unsplash / signal terrain',
    },
  ],
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
  const seed = getArticleSeed(article)
  const stock = getStockPhoto(article, seed)
  const overlay = getStockTreatment(seed)

  return (
    <div className="relative h-full w-full overflow-hidden">
      <Image
        src={stock.url}
        alt={title}
        fill
        sizes="20vw"
        className="object-cover saturate-[0.55]"
        style={{ objectPosition: overlay.objectPosition }}
        unoptimized
      />
      <div className="absolute inset-0 mix-blend-multiply" style={{ background: overlay.wash }} />
      <div className="absolute inset-0" style={{ background: overlay.gradient }} />
      <div className="absolute border border-white/55" style={overlay.frame} />
      <div className="absolute bottom-3 left-3 right-3 flex items-end justify-between gap-3">
        <div className="bg-white/78" style={overlay.paperBlock} />
        <div className="max-w-[58%] bg-black/55 px-2 py-1 text-[9px] uppercase tracking-[0.1em] text-white">
          {stock.credit}
        </div>
      </div>
    </div>
  )
}

function LocalArtwork({ article, index, mode }: { article: LabArticle; index: number; mode: ArtworkMode }) {
  const title = article.ru_title ?? article.original_title
  const topic = (article.topics ?? [])[0] ?? 'general'
  const seed = hashString(`${mode}|${index}|${title}|${article.source_name}|${topic}`)
  const palette = PALETTES[seed % PALETTES.length]
  const variant = seed % 5
  const uid = `${mode}-${seed}-${topic}`.replace(/[^a-z0-9-]/gi, '-')
  const glow = getArtworkGlow(seed)
  const titleWords = getTitleWords(title)

  return (
    <svg viewBox="0 0 1200 750" className="block h-full w-full" role="img" aria-label={`${mode} cover for ${title}`}>
      <defs>
        <linearGradient id={`${uid}-paper`} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor={palette.surface} />
          <stop offset="100%" stopColor={palette.paper} />
        </linearGradient>
        <radialGradient id={`${uid}-glow`} cx={`${glow.cx}%`} cy={`${glow.cy}%`} r={`${glow.r}%`}>
          <stop offset="0%" stopColor={palette.accent} stopOpacity="0.38" />
          <stop offset="100%" stopColor={palette.accent} stopOpacity="0" />
        </radialGradient>
        <pattern id={`${uid}-grain`} width="18" height="18" patternUnits="userSpaceOnUse">
          <path d="M 0 9 H 18 M 9 0 V 18" stroke={palette.ink} strokeOpacity="0.035" />
        </pattern>
      </defs>
      <rect width="1200" height="750" fill={`url(#${uid}-paper)`} />
      <rect width="1200" height="750" fill={`url(#${uid}-grain)`} />
      <rect width="1200" height="750" fill={`url(#${uid}-glow)`} />
      <ArtworkMotif mode={mode} palette={palette} topic={topic} seed={seed} variant={variant} titleWords={titleWords} />
      <rect x="58" y="58" width="1084" height="634" fill="none" stroke={palette.ink} strokeOpacity="0.18" />
      <text x="78" y="102" fill={palette.muted} fontSize="22" fontFamily="Arial, sans-serif" letterSpacing="5">
        {topic.toUpperCase().slice(0, 22)}
      </text>
      <text x="78" y="590" fill={palette.ink} fontSize="32" fontFamily="Arial, sans-serif" fontWeight="700">
        {titleWords[0]}
      </text>
      <text x="78" y="626" fill={palette.muted} fontSize="22" fontFamily="Arial, sans-serif" letterSpacing="3">
        {titleWords[1]}
      </text>
      <text x="78" y="650" fill={palette.ink} fontSize="24" fontFamily="Arial, sans-serif" letterSpacing="4">
        MALAKHOV AI DIGEST
      </text>
    </svg>
  )
}

function ArtworkMotif({
  mode,
  palette,
  topic,
  seed,
  variant,
  titleWords,
}: {
  mode: ArtworkMode
  palette: Palette
  topic: string
  seed: number
  variant: number
  titleWords: [string, string]
}) {
  if (mode === 'system') {
    return <SystemMotif palette={palette} seed={seed} variant={variant} titleWords={titleWords} />
  }
  if (mode === 'archive') {
    return <ArchiveMotif palette={palette} topic={topic} seed={seed} variant={variant} />
  }
  return <AIMotif palette={palette} topic={topic} seed={seed} variant={variant} />
}

function SystemMotif({
  palette,
  seed,
  variant,
  titleWords,
}: {
  palette: Palette
  seed: number
  variant: number
  titleWords: [string, string]
}) {
  const offset = seed % 70
  if (variant === 0) {
    return (
      <g>
        <rect x={126 + offset} y="150" width="330" height="350" fill={palette.ink} fillOpacity="0.9" />
        {[0, 1, 2, 3].map((i) => (
          <rect key={i} x={170 + offset} y={210 + i * 58} width={240 - i * 28} height={24} fill={i % 2 ? palette.accentTwo : palette.accent} fillOpacity="0.78" />
        ))}
        <rect x="560" y="138" width="390" height="330" fill={palette.accentTwo} fillOpacity="0.16" stroke={palette.ink} strokeOpacity="0.24" />
        {Array.from({ length: 9 }).map((_, i) => (
          <line key={i} x1={575 + i * 38} y1="160" x2={600 + i * 28} y2="448" stroke={i % 2 ? palette.accentThree : palette.accent} strokeWidth="7" strokeOpacity="0.42" />
        ))}
      </g>
    )
  }
  if (variant === 1) {
    return (
      <g>
        <rect x="132" y="146" width="830" height="310" fill={palette.surface} stroke={palette.ink} strokeOpacity="0.18" />
        {Array.from({ length: 7 }).map((_, i) => (
          <g key={i}>
            <circle cx={210 + i * 118} cy={238 + ((seed + i * 31) % 120)} r={i % 2 ? 22 : 34} fill={i % 3 ? palette.accentTwo : palette.accent} fillOpacity="0.78" />
            {i > 0 && <line x1={210 + (i - 1) * 118} y1={238 + ((seed + (i - 1) * 31) % 120)} x2={210 + i * 118} y2={238 + ((seed + i * 31) % 120)} stroke={palette.ink} strokeWidth="8" strokeOpacity="0.18" />}
          </g>
        ))}
        <text x="172" y="520" fill={palette.muted} fontSize="18" fontFamily="Arial, sans-serif" letterSpacing="4">
          SIGNAL MAP / {titleWords[0].slice(0, 14)}
        </text>
      </g>
    )
  }
  if (variant === 2) {
    return (
      <g>
        <rect x="130" y="150" width="500" height="336" fill={palette.ink} fillOpacity="0.88" />
        <rect x="165" y="190" width="140" height="18" fill={palette.accent} />
        {Array.from({ length: 6 }).map((_, i) => (
          <rect key={i} x="165" y={242 + i * 36} width={190 + ((seed + i * 19) % 170)} height="14" fill={i % 2 ? palette.surface : palette.accentTwo} fillOpacity={i % 2 ? '0.75' : '0.86'} />
        ))}
        <rect x="704" y="166" width="260" height="260" fill={palette.accentThree} fillOpacity="0.2" stroke={palette.ink} strokeOpacity="0.22" />
        <circle cx="834" cy="296" r="82" fill={palette.accent} fillOpacity="0.84" />
      </g>
    )
  }
  if (variant === 3) {
    return (
      <g>
        {Array.from({ length: 5 }).map((_, i) => (
          <rect key={i} x={130 + i * 150} y={150 + ((seed + i * 17) % 90)} width="112" height={220 - i * 12} fill={i % 2 ? palette.accentTwo : palette.accent} fillOpacity="0.72" />
        ))}
        <path d="M 160 512 C 330 420, 496 534, 670 392 S 912 292, 1038 420" fill="none" stroke={palette.ink} strokeWidth="14" strokeOpacity="0.24" />
        <circle cx="1000" cy="404" r="52" fill={palette.ink} fillOpacity="0.88" />
      </g>
    )
  }
  return (
    <g>
      <rect x="132" y="148" width="880" height="410" fill={palette.surface} stroke={palette.ink} strokeOpacity="0.16" />
      {Array.from({ length: 42 }).map((_, i) => {
        const x = 172 + (i % 7) * 118
        const y = 188 + Math.floor(i / 7) * 54
        return <rect key={i} x={x} y={y} width="62" height="24" fill={i % 4 === 0 ? palette.ink : i % 2 ? palette.accentTwo : palette.accent} fillOpacity={i % 4 === 0 ? '0.82' : '0.62'} />
      })}
    </g>
  )
}

function ArchiveMotif({ palette, topic, seed, variant }: { palette: Palette; topic: string; seed: number; variant: number }) {
  if (variant === 0) {
    return (
      <g>
        {[0, 1, 2].map((i) => (
          <rect key={i} x={118 + i * 180} y={150 + i * 24} width="270" height="330" fill={i === 0 ? palette.surface : palette.paper} stroke={palette.ink} strokeOpacity="0.22" />
        ))}
        <rect x="184" y="222" width="220" height="24" fill={palette.ink} fillOpacity="0.72" />
        <rect x="184" y="286" width="170" height="16" fill={palette.accent} fillOpacity="0.72" />
        <rect x="700" y="142" width="240" height="380" fill={palette.accentThree} fillOpacity="0.22" />
        <path d="M 728 470 C 780 332, 858 360, 902 202" fill="none" stroke={palette.accent} strokeWidth="22" strokeLinecap="round" />
      </g>
    )
  }
  if (variant === 1) {
    return (
      <g>
        <rect x="130" y="150" width="820" height="350" fill={palette.surface} stroke={palette.ink} strokeOpacity="0.18" />
        {Array.from({ length: 8 }).map((_, i) => (
          <line key={i} x1="160" y1={190 + i * 38} x2="918" y2={190 + i * 38} stroke={palette.ink} strokeOpacity={i % 2 ? '0.10' : '0.2'} strokeWidth="4" />
        ))}
        {Array.from({ length: 5 }).map((_, i) => (
          <circle key={i} cx={220 + i * 150} cy={248 + ((seed + i * 53) % 140)} r={24 + (i % 2) * 16} fill={i % 2 ? palette.accentTwo : palette.accent} fillOpacity="0.78" />
        ))}
        <text x="780" y="548" fill={palette.muted} fontSize="18" fontFamily="Arial, sans-serif" letterSpacing="4">
          ARCHIVE / {topic.toUpperCase().slice(0, 12)}
        </text>
      </g>
    )
  }
  if (variant === 2) {
    return (
      <g>
        {Array.from({ length: 6 }).map((_, i) => (
          <rect key={i} x={122 + i * 138} y={150 + ((seed + i * 29) % 60)} width="100" height={280 + ((seed + i * 11) % 90)} fill={i % 3 === 0 ? palette.ink : i % 2 ? palette.accentTwo : palette.accent} fillOpacity={i % 3 === 0 ? '0.86' : '0.68'} />
        ))}
        <rect x="970" y="148" width="78" height="390" fill={palette.surface} stroke={palette.ink} strokeOpacity="0.2" />
        <text x="996" y="492" fill={palette.ink} fontSize="18" fontFamily="Arial, sans-serif" letterSpacing="4" transform="rotate(-90 996 492)">
          COVER BANK
        </text>
      </g>
    )
  }
  if (variant === 3) {
    return (
      <g>
        <rect x="126" y="146" width="390" height="390" fill={palette.ink} fillOpacity="0.88" />
        <rect x="168" y="188" width="306" height="306" fill={palette.surface} fillOpacity="0.9" />
        <circle cx="321" cy="341" r="104" fill={palette.accent} fillOpacity="0.72" />
        <rect x="620" y="144" width="300" height="392" fill={palette.accentTwo} fillOpacity="0.22" stroke={palette.ink} strokeOpacity="0.2" />
        <path d="M 650 462 L 720 262 L 804 390 L 886 202" fill="none" stroke={palette.ink} strokeWidth="16" strokeOpacity="0.3" />
      </g>
    )
  }
  return (
    <g>
      <rect x="130" y="150" width="842" height="370" fill={palette.surface} stroke={palette.ink} strokeOpacity="0.18" />
      {Array.from({ length: 12 }).map((_, i) => (
        <rect key={i} x={166 + (i % 4) * 190} y={188 + Math.floor(i / 4) * 92} width="124" height="54" fill={i % 2 ? palette.accentThree : palette.ink} fillOpacity={i % 2 ? '0.5' : '0.8'} />
      ))}
      <path d="M 150 552 H 1040" stroke={palette.ink} strokeWidth="8" strokeOpacity="0.16" />
    </g>
  )
}

function AIMotif({ palette, topic, seed, variant }: { palette: Palette; topic: string; seed: number; variant: number }) {
  if (variant === 0) {
    return (
      <g>
        <path d="M 166 520 L 332 170 L 512 530 Z" fill={palette.accent} fillOpacity="0.86" />
        <path d="M 430 154 L 780 132 L 650 548 Z" fill={palette.ink} fillOpacity="0.9" />
        <path d="M 728 244 L 1024 186 L 936 570 L 690 512 Z" fill={palette.accentTwo} fillOpacity="0.78" />
        <circle cx="574" cy="360" r="96" fill={palette.surface} fillOpacity="0.9" />
        <circle cx="574" cy="360" r="48" fill={palette.accentThree} fillOpacity="0.9" />
      </g>
    )
  }
  if (variant === 1) {
    return (
      <g>
        {Array.from({ length: 11 }).map((_, i) => {
          const x = 190 + i * 76
          const y = 220 + ((seed + i * 47) % 210)
          return (
            <g key={i}>
              {i > 0 && <line x1={114 + i * 76} y1={220 + ((seed + (i - 1) * 47) % 210)} x2={x} y2={y} stroke={palette.ink} strokeOpacity="0.18" strokeWidth="8" />}
              <circle cx={x} cy={y} r={i % 3 === 0 ? 28 : 16} fill={i % 2 ? palette.accentTwo : palette.accent} fillOpacity="0.82" />
            </g>
          )
        })}
        <rect x="148" y="148" width="850" height="390" fill="none" stroke={palette.ink} strokeOpacity="0.16" />
      </g>
    )
  }
  if (variant === 2) {
    return (
      <g>
        <rect x="128" y="142" width="260" height="410" fill={palette.accent} fillOpacity="0.78" />
        <rect x="428" y="142" width="260" height="410" fill={palette.ink} fillOpacity="0.88" />
        <rect x="728" y="142" width="260" height="410" fill={palette.accentTwo} fillOpacity="0.72" />
        <circle cx="558" cy="348" r="96" fill={palette.surface} fillOpacity="0.92" />
        <path d="M 230 220 C 380 330, 704 250, 902 436" fill="none" stroke={palette.surface} strokeWidth="14" strokeOpacity="0.5" />
      </g>
    )
  }
  if (variant === 3) {
    return (
      <g>
        <path d="M 138 500 C 250 150, 538 126, 672 350 S 908 580, 1040 180" fill="none" stroke={palette.ink} strokeWidth="26" strokeOpacity="0.18" />
        {Array.from({ length: 7 }).map((_, i) => (
          <path key={i} d={`M ${164 + i * 115} ${510 - i * 42} L ${236 + i * 96} ${176 + ((seed + i * 13) % 180)} L ${320 + i * 92} ${520 - ((seed + i * 31) % 160)} Z`} fill={i % 2 ? palette.accentTwo : palette.accent} fillOpacity="0.62" />
        ))}
        <circle cx="910" cy="430" r="74" fill={palette.ink} fillOpacity="0.84" />
      </g>
    )
  }
  return (
    <g>
      <rect x="132" y="148" width="850" height="392" fill={palette.ink} fillOpacity="0.88" />
      <rect x="178" y="198" width="276" height="260" fill={palette.surface} fillOpacity="0.9" />
      <circle cx="316" cy="328" r="78" fill={palette.accent} fillOpacity="0.82" />
      {Array.from({ length: 8 }).map((_, i) => (
        <rect key={i} x={540 + (i % 2) * 190} y={196 + Math.floor(i / 2) * 54} width={120 + ((seed + i * 17) % 70)} height="18" fill={i % 2 ? palette.accentThree : palette.accentTwo} fillOpacity="0.84" />
      ))}
      <text x="610" y="486" fill={palette.surface} fontSize="18" fontFamily="Arial, sans-serif" letterSpacing="4">
        AI TARGET / {topic.toUpperCase().slice(0, 12)}
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

function getStockPhoto(article: LabArticle, seed: number): StockPhoto {
  const topics = article.topics ?? []
  for (const topic of topics) {
    const photos = STOCK_PHOTOS[topic]
    if (photos) return photos[seed % photos.length]
  }
  return STOCK_PHOTOS.default[seed % STOCK_PHOTOS.default.length]
}

function getStockTreatment(seed: number) {
  const objectPositions = ['50% 50%', '42% 44%', '58% 48%', '50% 64%', '64% 42%']
  const washes = ['rgba(31,39,38,0.38)', 'rgba(35,35,35,0.42)', 'rgba(52,42,34,0.34)', 'rgba(22,48,62,0.36)']
  const gradients = [
    'radial-gradient(circle at 28% 24%, rgba(217,111,83,0.62), transparent 32%), linear-gradient(135deg, rgba(244,239,231,0.72), transparent 42%)',
    'radial-gradient(circle at 72% 30%, rgba(47,111,159,0.58), transparent 34%), linear-gradient(45deg, rgba(255,250,242,0.7), transparent 48%)',
    'radial-gradient(circle at 44% 68%, rgba(29,122,120,0.56), transparent 36%), linear-gradient(120deg, rgba(240,236,228,0.74), transparent 45%)',
    'radial-gradient(circle at 20% 72%, rgba(210,166,55,0.48), transparent 32%), linear-gradient(150deg, rgba(31,39,38,0.1), rgba(255,255,255,0.44))',
  ]

  return {
    objectPosition: objectPositions[seed % objectPositions.length],
    wash: washes[seed % washes.length],
    gradient: gradients[seed % gradients.length],
    frame: {
      left: `${16 + (seed % 28)}px`,
      top: `${14 + (seed % 36)}px`,
      width: `${88 + (seed % 56)}px`,
      height: `${46 + (seed % 44)}px`,
    },
    paperBlock: {
      width: `${72 + (seed % 54)}px`,
      height: `${38 + (seed % 40)}px`,
    },
  }
}

function getArticleSeed(article: LabArticle): number {
  return hashString(`${article.slug ?? ''}|${article.ru_title ?? ''}|${article.original_title}|${article.source_name}`)
}

function hashString(value: string): number {
  let hash = 2166136261
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

function getArtworkGlow(seed: number) {
  return {
    cx: 24 + (seed % 56),
    cy: 18 + ((seed >> 3) % 48),
    r: 38 + ((seed >> 5) % 20),
  }
}

function getTitleWords(title: string): [string, string] {
  const words = title
    .replace(/[«»"“”.,:;!?()[\]{}]/g, ' ')
    .split(/\s+/)
    .filter((word) => word.length > 2)
    .slice(0, 5)

  return [
    (words.slice(0, 2).join(' ') || 'AI SIGNAL').toUpperCase().slice(0, 24),
    (words.slice(2, 5).join(' ') || 'EDITORIAL COVER').toUpperCase().slice(0, 26),
  ]
}
