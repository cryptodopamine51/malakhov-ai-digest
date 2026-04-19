import type { ReactNode } from 'react'

interface StatItem {
  label: string
  value: string
  note: string
  trend?: 'up' | 'down' | 'neutral'
}

interface TimelineItem {
  year: string
  title: string
  description: string
}

interface EntityItem {
  name: string
  role: string
  note: string
}

interface ComparisonCol {
  label: string
  items: string[]
}

type SignalVariant = 'opportunity' | 'risk' | 'neutral'

// label/kicker typography — Onest (font-serif) для всех лейблов, font-mono только для больших чисел
const kicker = 'font-serif text-[10px] font-semibold uppercase tracking-[0.2em]'

// ─── EditorialStatGrid ───────────────────────────────────────────────────────

export function EditorialStatGrid({
  title,
  kicker: kickerText,
  items,
}: {
  title: string
  kicker?: string
  items: StatItem[]
}) {
  return (
    <section className="my-8 overflow-hidden rounded border border-line bg-surface">
      <div className="h-[3px] w-full bg-accent" />
      <div className="p-5">
        {kickerText && (
          <p className={`mb-1.5 ${kicker} text-accent`}>{kickerText}</p>
        )}
        <h2 className="font-serif text-xl font-bold leading-tight text-ink">{title}</h2>
        <div className="mt-4 grid gap-3 md:grid-cols-3">
          {items.map((item) => (
            <article key={item.label} className="rounded border border-line bg-base p-4">
              <p className={`${kicker} text-muted`}>{item.label}</p>
              {/* Числа — font-mono, это где он уместен */}
              <p className="mt-2 font-mono text-4xl font-bold leading-none tracking-tight text-ink">
                {item.value}
              </p>
              {item.trend && (
                <span className={`mt-1 inline-block font-mono text-[11px] font-semibold ${
                  item.trend === 'up' ? 'text-emerald-500' :
                  item.trend === 'down' ? 'text-red-500' :
                  'text-muted'
                }`}>
                  {item.trend === 'up' ? '↑' : item.trend === 'down' ? '↓' : '→'}
                </span>
              )}
              <p className="mt-2.5 text-[13px] leading-relaxed text-muted">{item.note}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  )
}

// ─── EditorialTimeline ───────────────────────────────────────────────────────

export function EditorialTimeline({
  title,
  items,
}: {
  title: string
  items: TimelineItem[]
}) {
  return (
    <section className="my-8 rounded border border-line bg-base p-5">
      <h2 className="font-serif text-xl font-bold leading-tight text-ink">{title}</h2>
      <div className="relative mt-5 pl-6">
        <div className="absolute left-[11px] top-0 h-full w-px bg-line" />
        {items.map((item, i) => (
          <div key={`${item.year}-${i}`} className="relative mb-6 last:mb-0">
            <div className="absolute -left-[19px] top-[3px] h-3 w-3 rounded-full border-2 border-accent bg-base" />
            <div className="flex flex-wrap items-baseline gap-2">
              <span className={`${kicker} text-accent`}>{item.year}</span>
              <h3 className="text-[15px] font-semibold text-ink">{item.title}</h3>
            </div>
            <p className="mt-1 text-sm leading-relaxed text-muted">{item.description}</p>
          </div>
        ))}
      </div>
    </section>
  )
}

// ─── EditorialEntityGrid ─────────────────────────────────────────────────────

export function EditorialEntityGrid({
  title,
  intro,
  items,
}: {
  title: string
  intro?: string
  items: EntityItem[]
}) {
  return (
    <section className="my-8 rounded border border-line bg-surface p-5">
      <h2 className="font-serif text-xl font-bold leading-tight text-ink">{title}</h2>
      {intro && <p className="mt-2 text-sm leading-relaxed text-muted">{intro}</p>}
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        {items.map((item) => (
          <article key={item.name} className="rounded border border-line bg-base p-4">
            <div className="flex items-start justify-between gap-3">
              <h3 className="text-[15px] font-semibold text-ink">{item.name}</h3>
              <span className={`shrink-0 rounded-sm bg-accent/10 px-2 py-0.5 ${kicker} text-accent`}>
                {item.role}
              </span>
            </div>
            <p className="mt-2.5 text-[13px] leading-relaxed text-muted">{item.note}</p>
          </article>
        ))}
      </div>
    </section>
  )
}

// ─── EditorialThesis ─────────────────────────────────────────────────────────

export function EditorialThesis({
  title,
  children,
}: {
  title: string
  children: ReactNode
}) {
  return (
    <aside className="my-8 border-l-[3px] border-accent bg-surface px-5 py-4">
      <p className={`${kicker} text-accent`}>Почему это важно</p>
      <h2 className="mt-2 font-serif text-lg font-bold leading-snug text-ink">{title}</h2>
      <div className="mt-3 text-[14px] leading-relaxed text-muted">{children}</div>
    </aside>
  )
}

// ─── EditorialPullQuote ──────────────────────────────────────────────────────

export function EditorialPullQuote({
  text,
  author,
}: {
  text: string
  author?: string
}) {
  return (
    <figure className="my-10 px-2">
      <div className="mb-6 h-px w-12 bg-accent" />
      <blockquote>
        <p className="font-serif text-[22px] font-bold leading-[1.35] tracking-[-0.01em] text-ink md:text-[26px]">
          {text}
        </p>
      </blockquote>
      {author && (
        <figcaption className={`mt-4 ${kicker} text-muted`}>{author}</figcaption>
      )}
      <div className="mt-6 h-px w-12 bg-line" />
    </figure>
  )
}

// ─── EditorialSignal ─────────────────────────────────────────────────────────

const signalConfig: Record<SignalVariant, { icon: string; label: string; css: string }> = {
  opportunity: { icon: '↑', label: 'Возможность', css: 'border-emerald-500/30 bg-emerald-500/5 text-emerald-600' },
  risk:        { icon: '↓', label: 'Риск',        css: 'border-red-500/30 bg-red-500/5 text-red-600' },
  neutral:     { icon: '→', label: 'Контекст',    css: 'border-accent/30 bg-accent/5 text-accent' },
}

export function EditorialSignal({
  variant = 'neutral',
  children,
}: {
  variant?: SignalVariant
  children: ReactNode
}) {
  const { icon, label, css } = signalConfig[variant]
  return (
    <div className={`my-5 flex items-start gap-4 rounded border p-4 ${css}`}>
      <span className="mt-0.5 shrink-0 text-lg font-bold leading-none">{icon}</span>
      <div>
        <p className={`mb-1 ${kicker}`}>{label}</p>
        <p className="text-[14px] leading-relaxed text-ink">{children}</p>
      </div>
    </div>
  )
}

// ─── EditorialComparison ─────────────────────────────────────────────────────

export function EditorialComparison({
  title,
  before,
  after,
}: {
  title: string
  before: ComparisonCol
  after: ComparisonCol
}) {
  return (
    <section className="my-8 overflow-hidden rounded border border-line">
      <div className="border-b border-line bg-surface px-5 py-3">
        <h2 className={`${kicker} text-muted`}>{title}</h2>
      </div>
      <div className="grid md:grid-cols-2">
        <div className="border-b border-line p-5 md:border-b-0 md:border-r">
          <h3 className={`mb-3 ${kicker} text-muted`}>{before.label}</h3>
          <ul className="space-y-2">
            {before.items.map((item, i) => (
              <li key={i} className="flex items-start gap-2 text-[14px] text-ink">
                <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-line" />
                {item}
              </li>
            ))}
          </ul>
        </div>
        <div className="p-5">
          <h3 className={`mb-3 ${kicker} text-accent`}>{after.label}</h3>
          <ul className="space-y-2">
            {after.items.map((item, i) => (
              <li key={i} className="flex items-start gap-2 text-[14px] text-ink">
                <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
                {item}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  )
}
