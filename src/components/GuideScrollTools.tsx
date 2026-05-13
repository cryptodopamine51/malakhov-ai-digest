'use client'

import { useEffect, useState } from 'react'

export interface GuideTocHeading {
  id: string
  text: string
}

function useActiveHeading(headings: GuideTocHeading[]): string {
  const [activeId, setActiveId] = useState(headings[0]?.id ?? '')

  useEffect(() => {
    if (headings.length === 0) return undefined

    const elements = headings
      .map((heading) => document.getElementById(heading.id))
      .filter((element): element is HTMLElement => Boolean(element))

    if (elements.length === 0) return undefined

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0]

        if (visible?.target.id) {
          setActiveId(visible.target.id)
        }
      },
      {
        rootMargin: '-20% 0px -65% 0px',
        threshold: [0.1, 0.25, 0.5],
      },
    )

    elements.forEach((element) => observer.observe(element))
    return () => observer.disconnect()
  }, [headings])

  return activeId
}

export function GuideMobileToc({ headings }: { headings: GuideTocHeading[] }) {
  const activeId = useActiveHeading(headings)
  if (headings.length === 0) return null

  return (
    <div className="sticky top-14 z-40 -mx-4 mb-8 border-y border-line bg-base/95 px-4 py-3 backdrop-blur lg:hidden">
      <p className="mb-2 text-[11px] font-semibold uppercase text-muted">Содержание</p>
      <nav className="tags-scroll flex gap-2 overflow-x-auto pb-0.5" aria-label="Содержание гайда">
        {headings.map((heading) => {
          const active = heading.id === activeId
          return (
            <a
              key={heading.id}
              href={`#${heading.id}`}
              aria-current={active ? 'location' : undefined}
              className={
                active
                  ? 'shrink-0 rounded border border-ink bg-ink px-3 py-1.5 text-[12px] font-medium text-[var(--base)]'
                  : 'shrink-0 rounded border border-line px-3 py-1.5 text-[12px] font-medium text-muted transition-colors hover:border-ink hover:text-ink'
              }
            >
              {heading.text}
            </a>
          )
        })}
      </nav>
    </div>
  )
}

export function GuideDesktopToc({ headings }: { headings: GuideTocHeading[] }) {
  const activeId = useActiveHeading(headings)
  if (headings.length === 0) return null

  return (
    <aside className="hidden lg:block">
      <div className="sticky top-[88px] max-h-[calc(100vh-7rem)] overflow-y-auto border-l border-line pl-6">
        <p className="mb-3 text-[11px] font-semibold uppercase text-muted">В статье</p>
        <nav className="space-y-2 text-sm" aria-label="Содержание гайда">
          {headings.map((heading) => {
            const active = heading.id === activeId
            return (
              <a
                key={heading.id}
                href={`#${heading.id}`}
                aria-current={active ? 'location' : undefined}
                className={
                  active
                    ? 'block border-l-2 border-accent pl-3 font-semibold text-ink'
                    : 'block border-l-2 border-transparent pl-3 text-muted transition-colors hover:text-ink'
                }
              >
                {heading.text}
              </a>
            )
          })}
        </nav>
      </div>
    </aside>
  )
}

export function GuideBackToTop() {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const updateVisibility = () => setVisible(window.scrollY > 600)
    updateVisibility()
    window.addEventListener('scroll', updateVisibility, { passive: true })
    return () => window.removeEventListener('scroll', updateVisibility)
  }, [])

  return (
    <button
      type="button"
      aria-label="Наверх"
      onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
      className={
        visible
          ? 'fixed bottom-5 right-4 z-50 flex h-11 w-11 items-center justify-center rounded border border-line bg-base text-xl font-semibold text-ink shadow-sm transition hover:border-ink md:bottom-6 md:right-6'
          : 'pointer-events-none fixed bottom-5 right-4 z-50 flex h-11 w-11 translate-y-3 items-center justify-center rounded border border-line bg-base text-xl font-semibold text-ink opacity-0 shadow-sm transition md:bottom-6 md:right-6'
      }
    >
      ↑
    </button>
  )
}
