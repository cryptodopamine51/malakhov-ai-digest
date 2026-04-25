'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState, useEffect } from 'react'
import { cn } from '../../lib/utils'
import ThemeToggle from './ThemeToggle'

const NAV_LINKS = [
  { href: '/',                          label: 'Главная' },
  { href: '/categories/ai-industry',    label: 'Индустрия' },
  { href: '/categories/ai-research',    label: 'Исследования' },
  { href: '/categories/ai-labs',        label: 'Лаборатории' },
  { href: '/categories/ai-investments', label: 'Инвестиции' },
  { href: '/categories/ai-startups',    label: 'Стартапы' },
  { href: '/russia',                    label: 'Россия' },
  { href: '/categories/coding',         label: 'Код' },
]

export default function Header() {
  const pathname = usePathname()
  const [menuOpen, setMenuOpen] = useState(false)
  const [scrolled, setScrolled] = useState(false)

  useEffect(() => {
    const handler = () => setScrolled(window.scrollY > 8)
    window.addEventListener('scroll', handler, { passive: true })
    return () => window.removeEventListener('scroll', handler)
  }, [])

  return (
    <header className={cn(
      'sticky top-0 z-50 bg-base/90 backdrop-blur-md border-b transition-colors duration-150',
      scrolled ? 'border-line' : 'border-transparent'
    )}>
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-4 px-4">

        {/* Логотип */}
        <Link href="/" className="flex items-center gap-1.5 flex-shrink-0">
          <span className="font-serif font-bold text-[16px] text-ink tracking-tight lg:text-[17px]">
            Malakhov AI
          </span>
          <span className="text-muted text-[13px] font-sans hidden sm:inline">
            Дайджест
          </span>
        </Link>

        {/* Десктопная навигация */}
        <nav className="hidden min-w-0 flex-1 items-center justify-center gap-0.5 lg:flex">
          {NAV_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={cn(
                'rounded px-2 py-1.5 text-[10px] font-sans font-medium uppercase tracking-[0.06em] transition-colors xl:px-3 xl:text-[11px]',
                pathname === link.href
                  ? 'text-ink font-semibold'
                  : 'text-muted hover:text-ink'
              )}
            >
              {link.label}
            </Link>
          ))}
        </nav>

        {/* Правые иконки */}
        <div className="flex flex-shrink-0 items-center gap-1">
          <ThemeToggle />

          {/* Бургер */}
          <button
            className="lg:hidden flex h-8 w-8 items-center justify-center text-muted hover:text-ink transition-colors"
            aria-label="Открыть меню"
            onClick={() => setMenuOpen((v) => !v)}
          >
            {menuOpen ? (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="3" y1="6" x2="21" y2="6" />
                <line x1="3" y1="12" x2="21" y2="12" />
                <line x1="3" y1="18" x2="21" y2="18" />
              </svg>
            )}
          </button>
        </div>
      </div>

      {/* Мобильное меню */}
      {menuOpen && (
        <nav className="border-t border-line bg-base px-4 py-3 lg:hidden">
          <div className="grid grid-cols-2 gap-x-4 gap-y-0.5">
            {NAV_LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setMenuOpen(false)}
                className={cn(
                  'block py-2 text-[12px] font-medium uppercase tracking-[0.07em] transition-colors',
                  pathname === link.href ? 'text-ink font-semibold' : 'text-muted hover:text-ink'
                )}
              >
                {link.label}
              </Link>
            ))}
          </div>
        </nav>
      )}
    </header>
  )
}
