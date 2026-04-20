import type { Metadata } from 'next'
import Link from 'next/link'
import { getLatestArticles } from '../../../lib/articles'
import type { Article } from '../../../lib/supabase'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Векторные обложки без текста',
  description: '30 SVG-изображений для статей без image API и без текста внутри картинки',
  robots: { index: false },
}

type CoverArticle = Pick<Article, 'slug' | 'ru_title' | 'original_title' | 'source_name' | 'topics'>

type CoverStyle = {
  id: string
  label: string
  fit: string
  note: string
}

type Palette = {
  bg: string
  bgAlt: string
  primary: string
  secondary: string
  accent: string
  ink: string
}

const COVER_STYLES: CoverStyle[] = [
  {
    id: 'aurora-grid',
    label: 'Aurora Grid',
    fit: 'research, frontier labs, benchmarks',
    note: 'Световые пятна на техно-сетке. Хорошо работает для lab-новостей и инструментов.',
  },
  {
    id: 'editorial-stripes',
    label: 'Editorial Stripes',
    fit: 'рынок, тезисные статьи, opinion',
    note: 'Жёсткий постерный ритм. Подходит для материалов с сильной позицией.',
  },
  {
    id: 'cell-atlas',
    label: 'Cell Atlas',
    fit: 'biology, science, mapping, cognition',
    note: 'Органические связи и слои. Для научных и биологических сюжетов.',
  },
  {
    id: 'terminal-scan',
    label: 'Terminal Scan',
    fit: 'agents, coding, devtools, infra',
    note: 'Экранный техно-стиль без буквального терминала. Для инженерных тем.',
  },
  {
    id: 'paper-orbs',
    label: 'Paper Orbs',
    fit: 'education, explainers, calmer topics',
    note: 'Мягкая журнальная подача. Для понятных и неагрессивных статей.',
  },
  {
    id: 'radar-web',
    label: 'Radar Web',
    fit: 'evals, scoring, measurement, comparison',
    note: 'Диаграммная геометрия без текста. Для сравнений и методик.',
  },
  {
    id: 'solar-orbit',
    label: 'Solar Orbit',
    fit: 'big picture, strategic pieces, essays',
    note: 'Крупная доминирующая форма и орбиты. Для больших смысловых материалов.',
  },
  {
    id: 'circuit-board',
    label: 'Circuit Board',
    fit: 'platforms, frameworks, architecture',
    note: 'Трассы и узлы без банальности. Для системных и инфраструктурных тем.',
  },
  {
    id: 'mosaic-blocks',
    label: 'Mosaic Blocks',
    fit: 'roundups, lists, multi-tool stories',
    note: 'Модульная картинка под подборки и обзорные статьи.',
  },
  {
    id: 'iso-blueprint',
    label: 'ISO Blueprint',
    fit: 'stacks, diagrams, model breakdowns',
    note: 'Инженерное ощущение чертежа. Для архитектурных материалов.',
  },
  {
    id: 'cutout-angles',
    label: 'Cutout Angles',
    fit: 'commentary, analysis, sharp headlines',
    note: 'Рваная композиция из крупных плоскостей. Для колонок и разборов.',
  },
  {
    id: 'liquid-currents',
    label: 'Liquid Currents',
    fit: 'mainstream AI, product stories, broad explainers',
    note: 'Текучие формы и плавный градиент. Более массовое ощущение.',
  },
  {
    id: 'pixel-matrix',
    label: 'Pixel Matrix',
    fit: 'hardware, local LLMs, performance tests',
    note: 'Пиксельный язык и вычислительный ритм. Для хардверных и локальных тем.',
  },
  {
    id: 'constellation',
    label: 'Constellation',
    fit: 'future-facing, science, scenario pieces',
    note: 'Тёмное поле со связями и ощущением масштаба.',
  },
  {
    id: 'folded-ribbons',
    label: 'Folded Ribbons',
    fit: 'provocative essays, op-eds, conflict stories',
    note: 'Складки и столкновение плоскостей. Для более напряжённых сюжетов.',
  },
]

const SITE_STYLES: CoverStyle[] = [
  {
    id: 'site-paper-frame',
    label: 'Paper Frame',
    fit: 'универсальные новости, главная лента, спокойные карточки',
    note: 'Бумажная рамка, тонкие линии и спокойный фокус. Самый безопасный вариант под текущий UI.',
  },
  {
    id: 'site-offset-panel',
    label: 'Offset Panel',
    fit: 'редакционные заметки, explainers, аккуратные аналитики',
    note: 'Смещённые панели и мягкий контраст. Хорошо сочетается с карточками и блоками сайта.',
  },
  {
    id: 'site-quiet-diagram',
    label: 'Quiet Diagram',
    fit: 'исследования, benchmark, методики',
    note: 'Спокойная диаграммная графика без крика. Для материалов, где важна интеллектуальная тональность.',
  },
  {
    id: 'site-newsprint-fold',
    label: 'Newsprint Fold',
    fit: 'колонки, разборы, общественные сюжеты',
    note: 'Эффект сложенной полосы и газетной бумаги. Ближе к медийному характеру сайта.',
  },
  {
    id: 'site-archive-window',
    label: 'Archive Window',
    fit: 'истории про документы, регуляцию, корпоративные процессы',
    note: 'Оконная композиция с архивным ощущением и большим количеством воздуха.',
  },
  {
    id: 'site-soft-network',
    label: 'Soft Network',
    fit: 'AI-инфраструктура, платформы, экосистемы',
    note: 'Если нужен network-мотив, но без неонового клише и тяжёлого sci-fi.',
  },
  {
    id: 'site-column-collage',
    label: 'Column Collage',
    fit: 'подборки, roundups, мультисюжетные материалы',
    note: 'Вертикальный ритм под editorial-feed и мозаичную подачу.',
  },
  {
    id: 'site-stapled-card',
    label: 'Stapled Card',
    fit: 'объясняющие статьи, how-to, практические материалы',
    note: 'Похоже на аккуратную карточку из редакционного архива, а не на генеративную заглушку.',
  },
  {
    id: 'site-editorial-arc',
    label: 'Editorial Arc',
    fit: 'крупные тренды, индустрия, большие shifts',
    note: 'Один большой жест и спокойная асимметрия. Хорошо ложится в hero-блоки.',
  },
  {
    id: 'site-document-fold',
    label: 'Document Fold',
    fit: 'policy, compliance, enterprise, regulation',
    note: 'Документная пластика и folded-paper язык, совместимый с общей палитрой сайта.',
  },
  {
    id: 'site-wireframe-field',
    label: 'Wireframe Field',
    fit: 'devtools, архитектуры, техразборы',
    note: 'Тонкий wireframe вместо тяжёлого техно-арта. Для инженерных статей без шума.',
  },
  {
    id: 'site-monograph-bands',
    label: 'Monograph Bands',
    fit: 'спокойные аналитики, академические и исследовательские темы',
    note: 'Почти книжная обложка. Сдержанный и публикационный вариант.',
  },
  {
    id: 'site-print-shadow',
    label: 'Print Shadow',
    fit: 'общая новостная лента, fallback по умолчанию',
    note: 'Минималистичный объём и печатное ощущение. Один из лучших кандидатов на универсальный fallback.',
  },
  {
    id: 'site-orbital-margin',
    label: 'Orbital Margin',
    fit: 'наука, длинные тексты, стратегические обзоры',
    note: 'Много полей и один акцентный объект. Хорошо живёт рядом с типографикой сайта.',
  },
  {
    id: 'site-halftone-cut',
    label: 'Halftone Cut',
    fit: 'жёсткие колонки, opinion, медиакритика',
    note: 'Редакционный halftone и вырезанные массы. Более смелый, но всё ещё в рамках бренда.',
  },
]

const FALLBACK_ARTICLES: CoverArticle[] = [
  {
    slug: null,
    ru_title: 'Google представила двух ИИ-агентов для академических иллюстраций и рецензирования',
    original_title: 'Google unveiled two agents for academic illustration and review',
    source_name: 'Google Research Blog',
    topics: ['ai-labs'],
  },
  {
    slug: null,
    ru_title: 'Контекстный слой: почему ИИ обесценивает SaaS и перераспределяет корпоративную ценность',
    original_title: 'Context layer and AI',
    source_name: 'Habr AI',
    topics: ['ai-russia', 'coding'],
  },
  {
    slug: null,
    ru_title: 'Локальные LLM для написания кода: как выбрать модель и запустить её на своём железе',
    original_title: 'Local LLMs for coding',
    source_name: 'Habr AI',
    topics: ['coding'],
  },
]

export default async function VectorCoversPage() {
  let articles: CoverArticle[] = []

  try {
    articles = await getLatestArticles(COVER_STYLES.length + SITE_STYLES.length)
  } catch (error) {
    console.error('vector-covers load error:', error)
  }

  const source = articles.length > 0 ? articles : FALLBACK_ARTICLES
  const items = COVER_STYLES.map((style, index) => ({
    style,
    article: source[index % source.length],
    index,
  }))
  const siteItems = SITE_STYLES.map((style, index) => ({
    style,
    article: source[(index + COVER_STYLES.length) % source.length],
    index: index + COVER_STYLES.length,
  }))

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 md:py-10">
      <section className="mb-8 overflow-hidden rounded border border-line bg-base">
        <div className="grid gap-6 px-6 py-7 md:grid-cols-[1.25fr_0.75fr] md:px-8 md:py-8">
          <div>
            <div className="mb-3 flex flex-wrap gap-2 text-[11px] uppercase tracking-[0.18em] text-muted">
              <span className="rounded-full border border-line px-3 py-1">30 SVG images</span>
              <span className="rounded-full border border-line px-3 py-1">15 site-aligned</span>
              <span className="rounded-full border border-line px-3 py-1">No text in image</span>
              <span className="rounded-full border border-line px-3 py-1">No image API</span>
            </div>
            <h1 className="max-w-3xl font-serif text-4xl font-extrabold leading-tight text-ink md:text-5xl">
              30 чистых векторных обложек без текста внутри картинки
            </h1>
            <p className="mt-4 max-w-3xl text-sm leading-7 text-muted md:text-base">
              Здесь только визуальные стили: ни заголовков, ни подзаголовков, ни букв внутри самих
              изображений. Это тест того, можно ли закрывать статьи без исходной картинки
              редакционным SVG-артом, который генерируется кодом прямо в проекте. Первый блок ниже
              более экспериментальный, второй уже заметно ближе к визуальному языку самого сайта.
            </p>
          </div>

          <div className="rounded border border-line bg-surface p-5">
            <h2 className="font-serif text-xl font-bold text-ink">Что смотреть</h2>
            <ul className="mt-4 space-y-3 text-sm leading-6 text-muted">
              <li>Оценивай, выглядит ли это как редакционная обложка, а не как заглушка.</li>
              <li>Сравнивай первый блок с новым: второй должен лучше сочетаться с текущим дизайном сайта.</li>
              <li>Под каждой карточкой я оставил только внешнюю рекомендацию, под что её ставить.</li>
            </ul>
          </div>
        </div>
      </section>

      <GallerySection
        title="Экспериментальные стили"
        description="Широкий разброс визуальных языков: от техничных и diagram-based до более постерных и абстрактных."
        items={items}
      />

      <GallerySection
        title="В стиле сайта"
        description="Второй набор ближе к текущему UI дайджеста: бумажные поверхности, тонкие границы, больше воздуха и спокойнее палитра."
        items={siteItems}
      />
    </div>
  )
}

function GallerySection({
  title,
  description,
  items,
}: {
  title: string
  description: string
  items: Array<{ style: CoverStyle; article: CoverArticle; index: number }>
}) {
  return (
    <section className="mb-10">
      <div className="mb-4 flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
        <div>
          <h2 className="font-serif text-3xl font-bold text-ink">{title}</h2>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-muted">{description}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        {items.map(({ style, article, index }) => (
          <article
            key={style.id}
            className="overflow-hidden rounded border border-line bg-base shadow-[0_8px_30px_rgba(17,17,17,0.04)]"
          >
            <div className="border-b border-line bg-[#f2f2f0] p-2">
              <div className="overflow-hidden rounded bg-white">
                <CoverArtwork styleId={style.id} article={article} index={index} />
              </div>
            </div>

            <div className="grid gap-4 px-5 py-5 md:grid-cols-[1fr_auto]">
              <div>
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <span className="rounded-full border border-line px-2.5 py-1 text-[11px] uppercase tracking-[0.16em] text-muted">
                    {style.label}
                  </span>
                  <span className="text-[12px] text-muted">Лучше для: {style.fit}</span>
                </div>

                <p className="text-sm leading-6 text-muted">{style.note}</p>
                <p className="mt-3 text-sm leading-6 text-ink">
                  <span className="font-medium text-muted">Можно ставить к статье:</span> {getTitle(article)}
                </p>

                <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs uppercase tracking-[0.14em] text-muted">
                  <span>{article.source_name}</span>
                  <span>{formatTopic(article)}</span>
                </div>
              </div>

              <div className="flex flex-col items-start gap-2 md:items-end">
                <div className="text-[11px] uppercase tracking-[0.16em] text-muted">
                  Вариант {index + 1}
                </div>
                {article.slug ? (
                  <Link
                    href={`/articles/${article.slug}`}
                    className="rounded border border-line px-3 py-2 text-sm text-ink transition-colors hover:bg-surface"
                  >
                    Статья
                  </Link>
                ) : (
                  <span className="rounded border border-line px-3 py-2 text-sm text-muted">
                    Demo
                  </span>
                )}
              </div>
            </div>
          </article>
        ))}
      </div>
    </section>
  )
}

function CoverArtwork({
  styleId,
  article,
  index,
}: {
  styleId: string
  article: CoverArticle
  index: number
}) {
  const palette = getPalette(article, index, styleId)

  return (
    <svg viewBox="0 0 1200 675" className="block h-auto w-full" role="img" aria-label={`${styleId} cover`}>
      {renderCover(styleId, palette, index)}
    </svg>
  )
}

function renderCover(styleId: string, palette: Palette, index: number) {
  const uid = `${styleId}-${index}`

  switch (styleId) {
    case 'aurora-grid':
      return (
        <>
          <defs>
            <linearGradient id={`${uid}-bg`} x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor={palette.bg} />
              <stop offset="100%" stopColor={palette.bgAlt} />
            </linearGradient>
            <radialGradient id={`${uid}-glow-a`} cx="30%" cy="30%" r="50%">
              <stop offset="0%" stopColor={palette.accent} stopOpacity="0.95" />
              <stop offset="100%" stopColor={palette.accent} stopOpacity="0" />
            </radialGradient>
            <radialGradient id={`${uid}-glow-b`} cx="78%" cy="42%" r="42%">
              <stop offset="0%" stopColor={palette.secondary} stopOpacity="0.8" />
              <stop offset="100%" stopColor={palette.secondary} stopOpacity="0" />
            </radialGradient>
          </defs>
          <rect width="1200" height="675" fill={`url(#${uid}-bg)`} />
          {Array.from({ length: 16 }).map((_, i) => (
            <line key={`v-${i}`} x1={i * 80} y1="0" x2={i * 80} y2="675" stroke={palette.ink} strokeOpacity="0.12" />
          ))}
          {Array.from({ length: 10 }).map((_, i) => (
            <line key={`h-${i}`} x1="0" y1={i * 75} x2="1200" y2={i * 75} stroke={palette.ink} strokeOpacity="0.1" />
          ))}
          <circle cx="320" cy="240" r="220" fill={`url(#${uid}-glow-a)`} />
          <circle cx="888" cy="302" r="180" fill={`url(#${uid}-glow-b)`} />
          <rect x="666" y="110" width="312" height="182" rx="30" fill={palette.primary} fillOpacity="0.18" stroke={palette.accent} strokeOpacity="0.55" />
          <rect x="764" y="334" width="190" height="166" rx="26" fill={palette.secondary} fillOpacity="0.14" />
          <circle cx="976" cy="488" r="48" fill={palette.accent} fillOpacity="0.22" />
        </>
      )

    case 'editorial-stripes':
      return (
        <>
          <rect width="1200" height="675" fill={palette.bgAlt} />
          <rect x="0" y="0" width="164" height="675" fill={palette.ink} />
          <rect x="164" y="0" width="128" height="675" fill={palette.primary} />
          <rect x="292" y="0" width="58" height="675" fill={palette.secondary} />
          <rect x="432" y="84" width="628" height="210" fill={palette.ink} />
          <rect x="430" y="370" width="516" height="162" fill="#f9f5ee" stroke={palette.ink} strokeWidth="3" />
          <rect x="1002" y="84" width="60" height="448" fill={palette.accent} />
          <rect x="734" y="416" width="170" height="74" fill={palette.primary} fillOpacity="0.18" />
        </>
      )

    case 'cell-atlas':
      return (
        <>
          <defs>
            <linearGradient id={`${uid}-cell`} x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor={palette.bgAlt} />
              <stop offset="100%" stopColor={palette.bg} />
            </linearGradient>
          </defs>
          <rect width="1200" height="675" fill={`url(#${uid}-cell)`} />
          {Array.from({ length: 8 }).map((_, i) => (
            <path
              key={i}
              d={`M 0 ${150 + i * 45} C 220 ${36 + i * 28}, 430 ${308 - i * 16}, 650 ${168 + i * 16} S 980 ${132 + i * 8}, 1200 ${222 + i * 18}`}
              fill="none"
              stroke={i % 2 === 0 ? palette.primary : palette.secondary}
              strokeOpacity={0.24 + i * 0.05}
              strokeWidth={2 + (i % 3)}
            />
          ))}
          {[
            [220, 216, 80],
            [378, 302, 124],
            [608, 244, 96],
            [844, 186, 140],
            [930, 382, 110],
            [726, 424, 132],
          ].map(([x, y, r], i) => (
            <g key={i}>
              <circle cx={x} cy={y} r={r} fill={i % 2 === 0 ? palette.primary : palette.secondary} fillOpacity="0.14" />
              <circle cx={x} cy={y} r={r * 0.22} fill={palette.accent} />
            </g>
          ))}
          <line x1="220" y1="216" x2="378" y2="302" stroke={palette.ink} strokeOpacity="0.24" />
          <line x1="378" y1="302" x2="608" y2="244" stroke={palette.ink} strokeOpacity="0.24" />
          <line x1="608" y1="244" x2="844" y2="186" stroke={palette.ink} strokeOpacity="0.24" />
          <line x1="844" y1="186" x2="930" y2="382" stroke={palette.ink} strokeOpacity="0.24" />
          <line x1="930" y1="382" x2="726" y2="424" stroke={palette.ink} strokeOpacity="0.24" />
        </>
      )

    case 'terminal-scan':
      return (
        <>
          <rect width="1200" height="675" fill={palette.bg} />
          <rect x="60" y="58" width="1080" height="560" rx="28" fill={palette.bgAlt} stroke={palette.accent} strokeOpacity="0.4" />
          <rect x="60" y="58" width="1080" height="48" rx="28" fill={palette.ink} fillOpacity="0.15" />
          <circle cx="96" cy="82" r="8" fill={palette.primary} />
          <circle cx="122" cy="82" r="8" fill={palette.secondary} />
          <circle cx="148" cy="82" r="8" fill={palette.accent} />
          {Array.from({ length: 14 }).map((_, i) => (
            <line key={i} x1="88" y1={134 + i * 32} x2="1110" y2={134 + i * 32} stroke={palette.accent} strokeOpacity="0.08" />
          ))}
          {Array.from({ length: 18 }).map((_, i) => (
            <rect
              key={i}
              x={88 + (i % 6) * 172}
              y={154 + Math.floor(i / 6) * 96}
              width={78 + (i % 3) * 28}
              height="10"
              rx="5"
              fill={i % 4 === 0 ? palette.accent : palette.secondary}
              fillOpacity={i % 4 === 0 ? 0.82 : 0.28}
            />
          ))}
          <rect x="684" y="156" width="384" height="228" rx="18" fill="#000000" fillOpacity="0.16" stroke={palette.accent} strokeOpacity="0.26" />
        </>
      )

    case 'paper-orbs':
      return (
        <>
          <rect width="1200" height="675" fill={palette.bgAlt} />
          <ellipse cx="232" cy="196" rx="210" ry="150" fill={palette.accent} fillOpacity="0.72" />
          <ellipse cx="424" cy="312" rx="256" ry="192" fill={palette.primary} fillOpacity="0.82" />
          <ellipse cx="740" cy="216" rx="248" ry="168" fill={palette.secondary} fillOpacity="0.82" />
          <ellipse cx="946" cy="396" rx="228" ry="178" fill={palette.ink} fillOpacity="0.82" />
          <ellipse cx="250" cy="506" rx="206" ry="142" fill="#ffffff" fillOpacity="0.4" />
          <rect x="82" y="388" width="624" height="198" rx="36" fill="#fffaf4" fillOpacity="0.78" />
        </>
      )

    case 'radar-web':
      return (
        <>
          <rect width="1200" height="675" fill={palette.bg} />
          <g transform="translate(828 338)">
            {Array.from({ length: 5 }).map((_, i) => (
              <circle key={i} cx="0" cy="0" r={70 + i * 52} fill="none" stroke={palette.secondary} strokeOpacity="0.24" />
            ))}
            {Array.from({ length: 8 }).map((_, i) => (
              <line
                key={i}
                x1="0"
                y1="0"
                x2={Math.cos((Math.PI * 2 * i) / 8) * 272}
                y2={Math.sin((Math.PI * 2 * i) / 8) * 272}
                stroke={palette.secondary}
                strokeOpacity="0.22"
              />
            ))}
            <polygon points="0,-196 156,-68 118,142 -76,170 -192,30 -122,-124" fill={palette.accent} fillOpacity="0.22" stroke={palette.accent} strokeWidth="4" />
            {[
              [0, -196],
              [156, -68],
              [118, 142],
              [-76, 170],
              [-192, 30],
              [-122, -124],
            ].map(([x, y], i) => (
              <circle key={i} cx={x} cy={y} r="8" fill="#ffffff" />
            ))}
          </g>
          <rect x="88" y="88" width="432" height="504" rx="40" fill="#ffffff" fillOpacity="0.06" />
        </>
      )

    case 'solar-orbit':
      return (
        <>
          <rect width="1200" height="675" fill={palette.bg} />
          <circle cx="876" cy="214" r="146" fill={palette.accent} />
          <circle cx="876" cy="214" r="204" fill="none" stroke={palette.secondary} strokeOpacity="0.32" strokeWidth="2" />
          <circle cx="876" cy="214" r="266" fill="none" stroke={palette.secondary} strokeOpacity="0.2" strokeWidth="2" />
          <path d="M 0 548 C 214 494, 352 612, 586 558 S 936 468, 1200 544" fill="none" stroke={palette.secondary} strokeWidth="3" strokeOpacity="0.55" />
          <path d="M 0 584 C 180 536, 412 646, 656 586 S 966 498, 1200 580" fill="none" stroke={palette.secondary} strokeWidth="2" strokeOpacity="0.4" />
          <path d="M 0 616 C 226 572, 394 674, 640 626 S 952 536, 1200 614" fill="none" stroke={palette.secondary} strokeWidth="2" strokeOpacity="0.3" />
          <rect x="82" y="84" width="480" height="264" rx="32" fill="#fff8f0" fillOpacity="0.84" />
        </>
      )

    case 'circuit-board':
      return (
        <>
          <rect width="1200" height="675" fill={palette.bgAlt} />
          {[
            'M 160 132 H 344 V 218 H 524 V 156 H 698',
            'M 202 340 H 432 V 420 H 648 V 312 H 950',
            'M 148 508 H 308 V 448 H 486 V 566 H 916',
            'M 720 132 H 934 V 248 H 1082',
          ].map((d, i) => (
            <path key={i} d={d} fill="none" stroke={palette.ink} strokeWidth="12" strokeLinecap="round" strokeLinejoin="round" />
          ))}
          {[
            [156, 132],
            [344, 218],
            [524, 156],
            [950, 312],
            [308, 448],
            [486, 566],
            [934, 248],
          ].map(([x, y], i) => (
            <circle key={i} cx={x} cy={y} r="18" fill={i % 2 === 0 ? palette.accent : palette.primary} />
          ))}
          <rect x="690" y="350" width="320" height="196" rx="30" fill={palette.ink} fillOpacity="0.88" />
          <rect x="738" y="396" width="78" height="78" rx="16" fill={palette.accent} fillOpacity="0.84" />
          <rect x="840" y="394" width="124" height="20" rx="10" fill="#ffffff" fillOpacity="0.9" />
          <rect x="840" y="432" width="92" height="20" rx="10" fill="#ffffff" fillOpacity="0.66" />
          <rect x="840" y="470" width="108" height="20" rx="10" fill="#ffffff" fillOpacity="0.66" />
        </>
      )

    case 'mosaic-blocks':
      return (
        <>
          <rect width="1200" height="675" fill={palette.bgAlt} />
          {[
            [80, 84, 112, 448, palette.ink],
            [216, 132, 96, 388, palette.primary],
            [338, 96, 126, 456, palette.secondary],
            [494, 148, 114, 336, palette.accent],
            [632, 98, 98, 420, palette.primary],
            [760, 124, 122, 374, palette.ink],
            [908, 84, 140, 446, palette.secondary],
          ].map(([x, y, w, h, fill], i) => (
            <g key={i}>
              <rect x={Number(x)} y={Number(y)} width={Number(w)} height={Number(h)} fill={String(fill)} rx="18" />
              <rect x={Number(x)} y={Number(y) + Number(h) + 16} width={Number(w)} height="28" fill={String(fill)} fillOpacity="0.28" rx="14" />
            </g>
          ))}
          <rect x="72" y="458" width="1056" height="148" fill="#ffffff" fillOpacity="0.78" />
        </>
      )

    case 'iso-blueprint':
      return (
        <>
          <rect width="1200" height="675" fill={palette.bg} />
          {Array.from({ length: 18 }).map((_, i) => (
            <line key={`v-${i}`} x1={i * 70} y1="0" x2={i * 70} y2="675" stroke={palette.secondary} strokeOpacity="0.14" />
          ))}
          {Array.from({ length: 11 }).map((_, i) => (
            <line key={`h-${i}`} x1="0" y1={i * 68} x2="1200" y2={i * 68} stroke={palette.secondary} strokeOpacity="0.14" />
          ))}
          <polygon points="760,188 902,108 1044,188 902,268" fill="none" stroke={palette.accent} strokeWidth="4" />
          <polygon points="760,188 760,358 902,438 902,268" fill="none" stroke={palette.accent} strokeWidth="4" />
          <polygon points="1044,188 1044,358 902,438 902,268" fill="none" stroke={palette.accent} strokeWidth="4" />
          <polygon points="866,286 980,222 1096,286 980,350" fill={palette.accent} fillOpacity="0.12" stroke={palette.accent} strokeWidth="3" />
          <rect x="84" y="86" width="476" height="276" rx="32" fill="#000000" fillOpacity="0.18" stroke={palette.accent} strokeOpacity="0.45" />
        </>
      )

    case 'cutout-angles':
      return (
        <>
          <rect width="1200" height="675" fill={palette.bgAlt} />
          <polygon points="0,0 668,0 464,320 0,408" fill={palette.ink} />
          <polygon points="1200,0 1200,340 840,256 668,0" fill={palette.primary} />
          <polygon points="0,675 0,408 464,320 716,675" fill={palette.accent} />
          <polygon points="716,675 464,320 840,256 1200,340 1200,675" fill={palette.secondary} />
          <line x1="464" y1="320" x2="668" y2="0" stroke="#ffffff" strokeOpacity="0.36" strokeWidth="2" />
          <line x1="464" y1="320" x2="0" y2="408" stroke="#ffffff" strokeOpacity="0.36" strokeWidth="2" />
          <line x1="464" y1="320" x2="716" y2="675" stroke="#ffffff" strokeOpacity="0.36" strokeWidth="2" />
          <circle cx="1010" cy="116" r="84" fill="#fff8ee" />
        </>
      )

    case 'liquid-currents':
      return (
        <>
          <defs>
            <linearGradient id={`${uid}-liquid`} x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor={palette.primary} />
              <stop offset="52%" stopColor={palette.secondary} />
              <stop offset="100%" stopColor={palette.bgAlt} />
            </linearGradient>
          </defs>
          <rect width="1200" height="675" fill={`url(#${uid}-liquid)`} />
          <path d="M 0 450 C 188 366, 374 494, 572 426 S 900 294, 1200 416 L 1200 675 L 0 675 Z" fill="#ffffff" fillOpacity="0.18" />
          <path d="M 0 512 C 196 438, 386 586, 626 500 S 960 380, 1200 482" fill="none" stroke="#f7fbff" strokeOpacity="0.58" strokeWidth="3" />
          <path d="M 0 546 C 210 476, 418 612, 666 536 S 994 420, 1200 522" fill="none" stroke="#f7fbff" strokeOpacity="0.42" strokeWidth="2" />
          <rect x="84" y="90" width="548" height="256" rx="40" fill="#ffffff" fillOpacity="0.18" />
        </>
      )

    case 'pixel-matrix':
      return (
        <>
          <rect width="1200" height="675" fill={palette.bg} />
          {Array.from({ length: 12 }).map((_, row) =>
            Array.from({ length: 18 }).map((__, col) => {
              const fill = [palette.ink, palette.primary, palette.secondary, palette.accent][(row + col + index) % 4]
              return (
                <rect
                  key={`${row}-${col}`}
                  x={72 + col * 52}
                  y={76 + row * 34}
                  width="34"
                  height="22"
                  rx="4"
                  fill={fill}
                  fillOpacity={(row + col) % 3 === 0 ? 0.9 : 0.28}
                />
              )
            })
          )}
          <path d="M 110 560 H 230 V 490 H 354 V 426 H 488 V 362 H 614 V 296 H 748 V 244 H 886 V 198 H 1044" fill="none" stroke={palette.accent} strokeWidth="16" strokeLinejoin="round" />
          <rect x="84" y="402" width="468" height="178" fill="#0d1116" fillOpacity="0.58" stroke={palette.secondary} strokeOpacity="0.3" />
        </>
      )

    case 'constellation':
      return (
        <>
          <defs>
            <radialGradient id={`${uid}-spot`} cx="70%" cy="30%" r="55%">
              <stop offset="0%" stopColor={palette.primary} stopOpacity="0.84" />
              <stop offset="100%" stopColor={palette.bg} stopOpacity="0" />
            </radialGradient>
          </defs>
          <rect width="1200" height="675" fill={palette.bg} />
          <rect width="1200" height="675" fill={`url(#${uid}-spot)`} />
          {[
            [178, 164],
            [342, 108],
            [426, 262],
            [610, 188],
            [760, 282],
            [872, 202],
            [1032, 318],
            [940, 492],
            [712, 548],
            [412, 478],
          ].map(([x, y], i, arr) => (
            <g key={i}>
              {i < arr.length - 1 && <line x1={x} y1={y} x2={arr[i + 1][0]} y2={arr[i + 1][1]} stroke={palette.secondary} strokeOpacity="0.42" />}
              <circle cx={x} cy={y} r="6" fill="#ffffff" />
              <circle cx={x} cy={y} r="22" fill={palette.secondary} fillOpacity="0.12" />
            </g>
          ))}
          {Array.from({ length: 30 }).map((_, i) => (
            <circle
              key={i}
              cx={60 + ((i * 137) % 1080)}
              cy={50 + ((i * 83) % 560)}
              r={(i % 3) + 1}
              fill="#ffffff"
              fillOpacity={0.55 + (i % 4) * 0.1}
            />
          ))}
        </>
      )

    case 'folded-ribbons':
      return (
        <>
          <rect width="1200" height="675" fill={palette.bgAlt} />
          <path d="M 0 96 C 164 64, 266 156, 410 120 S 642 20, 824 78 S 1076 240, 1200 198 V 0 H 0 Z" fill={palette.primary} />
          <path d="M 0 614 C 190 650, 358 532, 536 564 S 828 680, 1000 620 S 1128 490, 1200 520 V 675 H 0 Z" fill={palette.secondary} />
          <path d="M 104 540 L 336 186 L 602 494 L 872 122 L 1112 422" fill="none" stroke={palette.ink} strokeWidth="72" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M 104 540 L 336 186 L 602 494 L 872 122 L 1112 422" fill="none" stroke={palette.accent} strokeWidth="34" strokeLinecap="round" strokeLinejoin="round" />
          <circle cx="948" cy="134" r="78" fill="#fff7ed" />
        </>
      )

    case 'site-paper-frame':
      return (
        <>
          <rect width="1200" height="675" fill={palette.bgAlt} />
          <rect x="84" y="70" width="1032" height="535" rx="28" fill="#fbf8f2" stroke={palette.ink} strokeOpacity="0.18" strokeWidth="2" />
          <rect x="132" y="118" width="420" height="438" rx="22" fill={palette.primary} fillOpacity="0.14" />
          <circle cx="856" cy="250" r="148" fill={palette.accent} fillOpacity="0.18" />
          <circle cx="856" cy="250" r="210" fill="none" stroke={palette.secondary} strokeOpacity="0.24" />
          <line x1="640" y1="150" x2="1038" y2="150" stroke={palette.ink} strokeOpacity="0.18" />
          <line x1="640" y1="198" x2="1020" y2="198" stroke={palette.ink} strokeOpacity="0.1" />
          <line x1="640" y1="246" x2="998" y2="246" stroke={palette.ink} strokeOpacity="0.1" />
          <line x1="640" y1="294" x2="976" y2="294" stroke={palette.ink} strokeOpacity="0.1" />
        </>
      )

    case 'site-offset-panel':
      return (
        <>
          <rect width="1200" height="675" fill={palette.bgAlt} />
          <rect x="152" y="98" width="512" height="390" rx="28" fill="#fffdf8" stroke={palette.ink} strokeOpacity="0.16" />
          <rect x="578" y="166" width="386" height="296" rx="28" fill={palette.primary} fillOpacity="0.14" />
          <rect x="760" y="100" width="190" height="90" rx="22" fill={palette.accent} fillOpacity="0.2" />
          <path d="M 140 560 C 286 512, 412 596, 574 544 S 860 470, 1064 546" fill="none" stroke={palette.secondary} strokeWidth="3" strokeOpacity="0.44" />
          <path d="M 150 594 C 322 548, 432 628, 618 588 S 858 536, 1040 594" fill="none" stroke={palette.secondary} strokeWidth="2" strokeOpacity="0.26" />
        </>
      )

    case 'site-quiet-diagram':
      return (
        <>
          <rect width="1200" height="675" fill={palette.bgAlt} />
          <rect x="94" y="90" width="1012" height="494" rx="32" fill="#fbf9f4" />
          <g transform="translate(730 336)">
            {Array.from({ length: 4 }).map((_, i) => (
              <circle key={i} cx="0" cy="0" r={74 + i * 54} fill="none" stroke={palette.secondary} strokeOpacity="0.16" />
            ))}
            {Array.from({ length: 6 }).map((_, i) => (
              <line
                key={i}
                x1="0"
                y1="0"
                x2={Math.cos((Math.PI * 2 * i) / 6) * 220}
                y2={Math.sin((Math.PI * 2 * i) / 6) * 220}
                stroke={palette.ink}
                strokeOpacity="0.16"
              />
            ))}
            <polygon points="0,-170 136,-52 116,128 -88,146 -186,18 -108,-118" fill={palette.primary} fillOpacity="0.12" stroke={palette.primary} strokeOpacity="0.55" strokeWidth="3" />
          </g>
          <rect x="154" y="166" width="314" height="216" rx="24" fill={palette.accent} fillOpacity="0.12" />
        </>
      )

    case 'site-newsprint-fold':
      return (
        <>
          <rect width="1200" height="675" fill="#f4f0e7" />
          <polygon points="0,0 1200,0 1200,102 862,158 0,76" fill={palette.ink} fillOpacity="0.08" />
          <polygon points="102,108 1090,88 1048,558 144,586" fill="#fbf8f2" stroke={palette.ink} strokeOpacity="0.16" />
          <line x1="582" y1="92" x2="620" y2="586" stroke={palette.ink} strokeOpacity="0.12" strokeDasharray="6 6" />
          <rect x="190" y="180" width="280" height="188" fill={palette.primary} fillOpacity="0.12" />
          <rect x="694" y="196" width="238" height="146" fill={palette.accent} fillOpacity="0.15" />
          {Array.from({ length: 8 }).map((_, i) => (
            <line key={i} x1="694" y1={388 + i * 22} x2="978" y2={388 + i * 22} stroke={palette.ink} strokeOpacity="0.14" />
          ))}
        </>
      )

    case 'site-archive-window':
      return (
        <>
          <rect width="1200" height="675" fill={palette.bgAlt} />
          <rect x="96" y="82" width="1008" height="512" rx="26" fill="#faf7f1" stroke={palette.ink} strokeOpacity="0.14" />
          <rect x="156" y="136" width="272" height="376" rx="18" fill={palette.primary} fillOpacity="0.13" />
          <rect x="466" y="136" width="560" height="166" rx="18" fill="#ffffff" stroke={palette.ink} strokeOpacity="0.12" />
          <rect x="466" y="328" width="264" height="184" rx="18" fill={palette.accent} fillOpacity="0.14" />
          <rect x="762" y="328" width="264" height="184" rx="18" fill={palette.secondary} fillOpacity="0.14" />
          <circle cx="862" cy="220" r="60" fill={palette.ink} fillOpacity="0.06" />
        </>
      )

    case 'site-soft-network':
      return (
        <>
          <rect width="1200" height="675" fill={palette.bgAlt} />
          <path d="M 0 186 C 182 132, 330 232, 504 194 S 812 104, 1200 206" fill="none" stroke={palette.secondary} strokeOpacity="0.22" strokeWidth="3" />
          <path d="M 0 318 C 202 260, 332 356, 572 324 S 878 232, 1200 332" fill="none" stroke={palette.secondary} strokeOpacity="0.18" strokeWidth="2" />
          <path d="M 0 460 C 226 404, 422 486, 616 452 S 942 378, 1200 466" fill="none" stroke={palette.secondary} strokeOpacity="0.16" strokeWidth="2" />
          {[
            [210, 208, 16],
            [402, 182, 24],
            [584, 322, 18],
            [756, 248, 28],
            [924, 408, 20],
            [1058, 310, 14],
          ].map(([x, y, r], i) => (
            <g key={i}>
              <circle cx={x} cy={y} r={r} fill={i % 2 === 0 ? palette.primary : palette.accent} fillOpacity="0.7" />
              <circle cx={x} cy={y} r={r * 2.8} fill={i % 2 === 0 ? palette.primary : palette.accent} fillOpacity="0.08" />
            </g>
          ))}
          <rect x="108" y="116" width="312" height="420" rx="36" fill="#ffffff" fillOpacity="0.56" />
        </>
      )

    case 'site-column-collage':
      return (
        <>
          <rect width="1200" height="675" fill={palette.bgAlt} />
          <rect x="90" y="88" width="186" height="500" rx="18" fill={palette.ink} fillOpacity="0.9" />
          <rect x="302" y="126" width="154" height="420" rx="18" fill={palette.primary} fillOpacity="0.16" />
          <rect x="482" y="92" width="198" height="468" rx="18" fill="#fbf9f4" stroke={palette.ink} strokeOpacity="0.12" />
          <rect x="706" y="146" width="132" height="336" rx="18" fill={palette.accent} fillOpacity="0.16" />
          <rect x="866" y="102" width="246" height="428" rx="18" fill={palette.secondary} fillOpacity="0.14" />
          <rect x="906" y="448" width="166" height="42" rx="21" fill="#ffffff" fillOpacity="0.54" />
        </>
      )

    case 'site-stapled-card':
      return (
        <>
          <rect width="1200" height="675" fill={palette.bgAlt} />
          <rect x="184" y="98" width="760" height="478" rx="24" fill="#fbf8f1" stroke={palette.ink} strokeOpacity="0.16" />
          <circle cx="252" cy="148" r="9" fill={palette.ink} fillOpacity="0.28" />
          <circle cx="880" cy="148" r="9" fill={palette.ink} fillOpacity="0.28" />
          <rect x="248" y="188" width="248" height="256" rx="18" fill={palette.primary} fillOpacity="0.12" />
          <circle cx="736" cy="278" r="118" fill={palette.accent} fillOpacity="0.16" />
          {Array.from({ length: 6 }).map((_, i) => (
            <line key={i} x1="584" y1={218 + i * 44} x2="850" y2={218 + i * 44} stroke={palette.ink} strokeOpacity="0.14" />
          ))}
          <rect x="584" y="476" width="220" height="34" rx="17" fill={palette.secondary} fillOpacity="0.18" />
        </>
      )

    case 'site-editorial-arc':
      return (
        <>
          <rect width="1200" height="675" fill={palette.bgAlt} />
          <path d="M -84 602 C 186 346, 484 206, 770 180 S 1140 240, 1286 402 L 1286 675 L -84 675 Z" fill={palette.primary} fillOpacity="0.14" />
          <path d="M 70 608 C 270 394, 488 276, 728 262 S 1042 310, 1182 430" fill="none" stroke={palette.secondary} strokeOpacity="0.34" strokeWidth="3" />
          <circle cx="860" cy="220" r="136" fill={palette.accent} fillOpacity="0.16" />
          <circle cx="860" cy="220" r="208" fill="none" stroke={palette.ink} strokeOpacity="0.1" />
          <rect x="120" y="116" width="370" height="364" rx="34" fill="#ffffff" fillOpacity="0.66" />
        </>
      )

    case 'site-document-fold':
      return (
        <>
          <rect width="1200" height="675" fill={palette.bgAlt} />
          <polygon points="206,84 860,84 1000,220 1000,592 206,592" fill="#fbf8f2" stroke={palette.ink} strokeOpacity="0.14" />
          <polygon points="860,84 860,220 1000,220" fill={palette.accent} fillOpacity="0.18" />
          <rect x="292" y="176" width="232" height="254" rx="18" fill={palette.primary} fillOpacity="0.14" />
          {Array.from({ length: 8 }).map((_, i) => (
            <line key={i} x1="566" y1={190 + i * 42} x2="878" y2={190 + i * 42} stroke={palette.ink} strokeOpacity={i === 0 ? '0.18' : '0.12'} />
          ))}
          <rect x="566" y="478" width="210" height="38" rx="19" fill={palette.secondary} fillOpacity="0.18" />
        </>
      )

    case 'site-wireframe-field':
      return (
        <>
          <rect width="1200" height="675" fill={palette.bgAlt} />
          <rect x="86" y="86" width="1028" height="504" rx="30" fill="#fbf8f3" />
          {Array.from({ length: 11 }).map((_, i) => (
            <line key={`h-${i}`} x1="136" y1={132 + i * 40} x2="1064" y2={132 + i * 40} stroke={palette.ink} strokeOpacity="0.08" />
          ))}
          {Array.from({ length: 15 }).map((_, i) => (
            <line key={`v-${i}`} x1={136 + i * 62} y1="132" x2={136 + i * 62} y2="532" stroke={palette.ink} strokeOpacity="0.06" />
          ))}
          {[
            [258, 214],
            [418, 186],
            [590, 264],
            [744, 212],
            [910, 322],
            [804, 452],
            [560, 412],
          ].map(([x, y], i, arr) => (
            <g key={i}>
              {i < arr.length - 1 && <line x1={x} y1={y} x2={arr[i + 1][0]} y2={arr[i + 1][1]} stroke={palette.secondary} strokeOpacity="0.28" />}
              <circle cx={x} cy={y} r="12" fill={i % 2 === 0 ? palette.primary : palette.accent} fillOpacity="0.72" />
            </g>
          ))}
        </>
      )

    case 'site-monograph-bands':
      return (
        <>
          <rect width="1200" height="675" fill="#f6f1e8" />
          <rect x="0" y="0" width="1200" height="124" fill={palette.ink} fillOpacity="0.96" />
          <rect x="0" y="124" width="1200" height="168" fill={palette.primary} fillOpacity="0.18" />
          <rect x="0" y="292" width="1200" height="126" fill="#fbf8f2" />
          <rect x="0" y="418" width="1200" height="130" fill={palette.secondary} fillOpacity="0.16" />
          <rect x="0" y="548" width="1200" height="127" fill={palette.accent} fillOpacity="0.18" />
          <circle cx="966" cy="216" r="82" fill={palette.accent} fillOpacity="0.22" />
          <rect x="126" y="198" width="326" height="274" rx="24" fill="#ffffff" fillOpacity="0.74" />
        </>
      )

    case 'site-print-shadow':
      return (
        <>
          <rect width="1200" height="675" fill={palette.bgAlt} />
          <rect x="220" y="134" width="620" height="370" rx="22" fill={palette.ink} fillOpacity="0.08" />
          <rect x="182" y="108" width="620" height="370" rx="22" fill="#fbf8f2" stroke={palette.ink} strokeOpacity="0.14" />
          <rect x="714" y="182" width="286" height="214" rx="20" fill={palette.primary} fillOpacity="0.12" />
          <circle cx="842" cy="420" r="118" fill={palette.accent} fillOpacity="0.14" />
          <path d="M 254 472 C 352 420, 448 408, 560 430 S 734 478, 804 454" fill="none" stroke={palette.secondary} strokeOpacity="0.3" strokeWidth="3" />
        </>
      )

    case 'site-orbital-margin':
      return (
        <>
          <rect width="1200" height="675" fill={palette.bgAlt} />
          <rect x="92" y="92" width="1016" height="492" rx="30" fill="#faf7f2" />
          <circle cx="904" cy="242" r="132" fill={palette.accent} fillOpacity="0.18" />
          <circle cx="904" cy="242" r="196" fill="none" stroke={palette.secondary} strokeOpacity="0.24" />
          <circle cx="904" cy="242" r="248" fill="none" stroke={palette.secondary} strokeOpacity="0.14" />
          <rect x="156" y="144" width="318" height="332" rx="28" fill={palette.primary} fillOpacity="0.12" />
          <line x1="584" y1="474" x2="1042" y2="474" stroke={palette.ink} strokeOpacity="0.14" />
          <line x1="584" y1="514" x2="986" y2="514" stroke={palette.ink} strokeOpacity="0.1" />
        </>
      )

    case 'site-halftone-cut':
      return (
        <>
          <defs>
            <pattern id={`${uid}-dots`} width="16" height="16" patternUnits="userSpaceOnUse">
              <circle cx="4" cy="4" r="2" fill={palette.ink} fillOpacity="0.16" />
              <circle cx="12" cy="12" r="2" fill={palette.ink} fillOpacity="0.16" />
            </pattern>
          </defs>
          <rect width="1200" height="675" fill="#f5f1e8" />
          <polygon points="0,0 690,0 504,320 0,412" fill={palette.ink} />
          <polygon points="1200,0 1200,278 854,234 690,0" fill={palette.primary} />
          <polygon points="0,675 0,412 504,320 712,675" fill={palette.accent} />
          <polygon points="712,675 504,320 854,234 1200,278 1200,675" fill={`url(#${uid}-dots)`} />
          <circle cx="988" cy="128" r="86" fill="#fff8f0" />
          <rect x="786" y="392" width="248" height="120" fill={palette.secondary} fillOpacity="0.16" />
        </>
      )

    default:
      return (
        <>
          <rect width="1200" height="675" fill={palette.bgAlt} />
        </>
      )
  }
}

function getPalette(article: CoverArticle, index: number, styleId: string): Palette {
  const topic = article.topics?.[0]
  const sitePalette = styleId.startsWith('site-')
  const palettes: Record<string, Palette[]> = {
    'ai-labs': [
      { bg: '#07131f', bgAlt: '#15395d', primary: '#102b44', secondary: '#7bd7f0', accent: '#4ff6c5', ink: '#d6ebff' },
      { bg: '#10273c', bgAlt: '#224c68', primary: '#234c87', secondary: '#8ee1f6', accent: '#f5a54b', ink: '#eef7ff' },
    ],
    'ai-russia': [
      { bg: '#221817', bgAlt: '#f2e4d6', primary: '#d85845', secondary: '#4665f0', accent: '#f1b459', ink: '#111111' },
      { bg: '#162033', bgAlt: '#efe4d6', primary: '#b84336', secondary: '#6a82ff', accent: '#e8a24b', ink: '#151515' },
    ],
    coding: [
      { bg: '#090d10', bgAlt: '#0f1a20', primary: '#3851ff', secondary: '#37cfa0', accent: '#f5b44a', ink: '#d6f6ec' },
      { bg: '#101318', bgAlt: '#18202b', primary: '#2d56e0', secondary: '#7ed8c5', accent: '#e2ff5d', ink: '#e8f0ff' },
    ],
    default: [
      { bg: '#12263f', bgAlt: '#f3efdf', primary: '#305a78', secondary: '#8fc4b4', accent: '#ffcc89', ink: '#173952' },
      { bg: '#161922', bgAlt: '#f5f2eb', primary: '#4d78f0', secondary: '#7fc1b8', accent: '#f0b44b', ink: '#1b2230' },
    ],
  }

  const sitePalettes: Record<string, Palette[]> = {
    'ai-labs': [
      { bg: '#f6f1e8', bgAlt: '#efe7da', primary: '#9d6c61', secondary: '#68889a', accent: '#d3a463', ink: '#2e2b2a' },
      { bg: '#f5efe4', bgAlt: '#ece4d7', primary: '#7f8ea3', secondary: '#7aa39a', accent: '#d1a25f', ink: '#292728' },
    ],
    'ai-russia': [
      { bg: '#f5efe5', bgAlt: '#ede3d5', primary: '#a46b5d', secondary: '#6f7d92', accent: '#c69558', ink: '#262324' },
      { bg: '#f3eee5', bgAlt: '#e8dfd2', primary: '#8d5d52', secondary: '#7e9a97', accent: '#d0a366', ink: '#2b2726' },
    ],
    coding: [
      { bg: '#f4efe6', bgAlt: '#ebe4d9', primary: '#61748c', secondary: '#73908d', accent: '#c49c60', ink: '#232629' },
      { bg: '#f3ede4', bgAlt: '#e9e2d7', primary: '#5f6d82', secondary: '#7b958d', accent: '#c89b56', ink: '#25282c' },
    ],
    default: [
      { bg: '#f5f0e8', bgAlt: '#ebe4d8', primary: '#7c8ca0', secondary: '#8aa79f', accent: '#d2a46a', ink: '#2a2a2a' },
      { bg: '#f4efe6', bgAlt: '#ece5da', primary: '#8f7761', secondary: '#73879c', accent: '#c99d61', ink: '#2d2b2a' },
    ],
  }

  const familySource = sitePalette ? sitePalettes : palettes
  const family = familySource[topic ?? 'default'] ?? familySource.default
  return family[index % family.length]
}

function getTitle(article: CoverArticle) {
  return article.ru_title ?? article.original_title
}

function formatTopic(article: CoverArticle) {
  const topic = article.topics?.[0]

  if (topic === 'ai-labs') return 'AI LABS'
  if (topic === 'ai-russia') return 'AI RUSSIA'
  if (topic === 'coding') return 'CODING'

  return article.source_name.toUpperCase().slice(0, 18)
}
