'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState } from 'react'
import { cn } from '../../lib/utils'

const NAV_LINKS = [
  { href: '/',                    label: 'Главная' },
  { href: '/russia',              label: 'Россия' },
  { href: '/topics/ai-research',  label: 'Исследования' },
  { href: '/topics/ai-labs',      label: 'Лаборатории' },
  { href: '/topics/coding',       label: 'Код' },
]

export default function Header() {
  const pathname = usePathname()
  const [menuOpen, setMenuOpen] = useState(false)

  return (
    <header className="sticky top-0 z-50 border-b border-white/5 bg-[#0f0f0f]/80 backdrop-blur-md">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
        {/* Логотип */}
        <Link href="/" className="flex items-center gap-1 text-lg">
          <span className="font-bold text-white">Malakhov AI</span>
          <span className="text-muted font-normal">Дайджест</span>
        </Link>

        {/* Десктопная навигация */}
        <nav className="hidden md:flex items-center gap-1">
          {NAV_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={cn(
                'rounded-md px-3 py-1.5 text-sm transition-colors',
                pathname === link.href
                  ? 'bg-accent/15 text-accent'
                  : 'text-muted hover:text-[#e5e5e5] hover:bg-white/5'
              )}
            >
              {link.label}
            </Link>
          ))}
        </nav>

        {/* Бургер-кнопка (мобильная) */}
        <button
          className="md:hidden p-2 text-muted hover:text-[#e5e5e5]"
          aria-label="Открыть меню"
          onClick={() => setMenuOpen((v) => !v)}
        >
          {menuOpen ? (
            <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
            </svg>
          ) : (
            <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M3 5a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 5a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm1 5a1 1 0 100 2h12a1 1 0 100-2H4z" clipRule="evenodd" />
            </svg>
          )}
        </button>
      </div>

      {/* Мобильное меню */}
      {menuOpen && (
        <nav className="md:hidden border-t border-white/5 bg-[#0f0f0f]/95 px-4 py-2">
          {NAV_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              onClick={() => setMenuOpen(false)}
              className={cn(
                'block rounded-md px-3 py-2 text-sm transition-colors',
                pathname === link.href
                  ? 'text-accent'
                  : 'text-muted hover:text-[#e5e5e5]'
              )}
            >
              {link.label}
            </Link>
          ))}
        </nav>
      )}
    </header>
  )
}
