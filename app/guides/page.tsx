import type { Metadata } from 'next'
import Image from 'next/image'
import Link from 'next/link'
import { getAllGuides, getGuideAbsoluteUrl } from '../../lib/guides'

export const revalidate = 86400

export const metadata: Metadata = {
  title: 'Гайды по ИИ для бизнеса',
  description:
    'Evergreen-гайды Malakhov AI Дайджест: внедрение ИИ, выбор AI-проектов, экономика, данные и автоматизация бизнес-процессов.',
  alternates: { canonical: '/guides' },
  openGraph: {
    title: 'Гайды по ИИ для бизнеса',
    description:
      'Практические evergreen-материалы о внедрении ИИ, автоматизации и AI-проектах для бизнеса.',
    type: 'website',
    url: '/guides',
  },
}

export default function GuidesPage() {
  const guides = getAllGuides()

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 md:py-10 lg:py-12">
      <header className="mb-10 max-w-3xl">
        <p className="mb-3 text-[12px] font-semibold uppercase text-accent">Evergreen</p>
        <h1 className="font-serif text-[36px] font-extrabold leading-tight text-ink md:text-[52px]">
          Гайды по ИИ для бизнеса
        </h1>
        <p className="mt-4 text-[18px] leading-relaxed text-hero-muted">
          Опорные материалы, которые помогают перейти от новостей и пилотов к рабочим AI-процессам:
          выбор проекта, данные, экономика, риски и контроль.
        </p>
      </header>

      <section className="grid gap-6 md:grid-cols-2">
        {guides.map((guide) => (
          <Link
            key={guide.slug}
            href={guide.path}
            className="group overflow-hidden rounded border border-line bg-base transition-colors hover:border-accent"
          >
            <Image
              src={guide.cover.src}
              alt={guide.cover.alt}
              width={guide.cover.width}
              height={guide.cover.height}
              sizes="(max-width: 768px) 100vw, 560px"
              className="h-auto w-full border-b border-line"
            />
            <div className="p-5">
              <p className="mb-2 text-[12px] font-semibold uppercase text-accent">{guide.category}</p>
              <h2 className="font-serif text-2xl font-bold leading-tight text-ink group-hover:text-accent">
                {guide.title}
              </h2>
              <p className="mt-3 text-sm leading-relaxed text-muted">{guide.description}</p>
              <div className="mt-4 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted">
                <span>{guide.readingMinutes} мин чтения</span>
                <span>{new URL(getGuideAbsoluteUrl(guide)).pathname}</span>
              </div>
            </div>
          </Link>
        ))}
      </section>
    </div>
  )
}
