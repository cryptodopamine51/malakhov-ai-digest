import Link from 'next/link'

const NAV_MAIN = [
  { href: '/',        label: 'Главная' },
  { href: '/sources', label: 'Источники' },
]

const NAV_LEGAL = [
  { href: '/privacy-policy', label: 'Политика персональных данных' },
  { href: '/cookie-policy',  label: 'Политика cookies' },
  { href: '/consent',        label: 'Отзыв согласия' },
]

const NAV_TOPICS = [
  { href: '/topics/ai-industry',    label: 'Индустрия' },
  { href: '/topics/ai-research',    label: 'Исследования' },
  { href: '/topics/ai-labs',        label: 'Лаборатории' },
  { href: '/topics/ai-investments', label: 'Инвестиции' },
  { href: '/topics/ai-startups',    label: 'Стартапы' },
  { href: '/russia',                label: 'Россия' },
  { href: '/topics/coding',         label: 'Код' },
]

export default function Footer() {
  const tgUrl = process.env.NEXT_PUBLIC_TELEGRAM_CHANNEL_URL ?? 'https://t.me/malakhovai'

  return (
    <footer className="bg-footer text-white/70 mt-16">
      <div className="mx-auto max-w-6xl px-4 py-12">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-10">

          {/* Подписка */}
          <div className="sm:col-span-1">
            <p className="text-white font-serif font-bold text-base mb-1">Malakhov AI Дайджест</p>
            <p className="text-white/50 text-sm mb-5 leading-relaxed">
              Лучшие новости об ИИ на русском языке каждый день
            </p>
            <a
              href={tgUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded border border-white/20 px-4 py-2 text-sm text-white hover:bg-white/10 transition-colors"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.894 8.221-1.97 9.28c-.145.658-.537.818-1.084.508l-3-2.21-1.447 1.394c-.16.16-.295.295-.605.295l.213-3.053 5.56-5.023c.242-.213-.054-.333-.373-.12l-6.871 4.326-2.962-.924c-.643-.204-.657-.643.136-.953l11.57-4.461c.537-.194 1.006.131.833.941z" />
              </svg>
              Telegram-канал
            </a>
          </div>

          {/* Навигация */}
          <div>
            <p className="text-white/40 text-[10px] uppercase tracking-[0.1em] mb-3">Разделы</p>
            <nav className="flex flex-col gap-2">
              {NAV_TOPICS.map((l) => (
                <Link
                  key={l.href}
                  href={l.href}
                  className="text-sm text-white/60 hover:text-white transition-colors"
                >
                  {l.label}
                </Link>
              ))}
            </nav>
          </div>

          {/* Прочие ссылки */}
          <div>
            <p className="text-white/40 text-[10px] uppercase tracking-[0.1em] mb-3">О проекте</p>
            <nav className="flex flex-col gap-2">
              {NAV_MAIN.map((l) => (
                <Link
                  key={l.href}
                  href={l.href}
                  className="text-sm text-white/60 hover:text-white transition-colors"
                >
                  {l.label}
                </Link>
              ))}
            </nav>
          </div>
        </div>

        <nav className="mt-10 border-t border-white/10 pt-6">
          <p className="text-white/40 text-[10px] uppercase tracking-[0.1em] mb-3">Документы</p>
          <ul className="flex flex-wrap gap-x-5 gap-y-2 text-xs">
            {NAV_LEGAL.map((l) => (
              <li key={l.href}>
                <Link href={l.href} className="text-white/60 hover:text-white transition-colors">
                  {l.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <div className="mt-6 border-t border-white/10 pt-6 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-white/30">
          <span>© 2024–2026 news.malakhovai.ru</span>
          <span>Все материалы переработаны редакцией</span>
        </div>
      </div>
    </footer>
  )
}
