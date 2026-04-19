import Link from 'next/link'

export default function Footer() {
  const tgUrl = process.env.NEXT_PUBLIC_TELEGRAM_CHANNEL_URL ?? 'https://t.me/malakhovai'

  return (
    <footer className="mt-auto border-t border-white/5 py-6">
      <div className="mx-auto max-w-6xl px-4">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 text-sm text-muted">
          <span>© 2026 Malakhov AI Дайджест</span>

          <nav className="flex items-center gap-4">
            <Link href="/sources" className="hover:text-accent transition-colors">
              Источники
            </Link>
            <a
              href={tgUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-accent transition-colors"
            >
              Telegram-канал
            </a>
          </nav>
        </div>
      </div>
    </footer>
  )
}
