import Link from 'next/link'

export default function Footer() {
  return (
    <footer className="mt-auto border-t border-white/5 py-6">
      <div className="mx-auto max-w-6xl px-4 flex flex-col sm:flex-row items-center justify-between gap-2 text-sm text-muted">
        <span>© 2025 Malakhov AI Дайджест · Все права защищены</span>
        <Link
          href="#"
          className="hover:text-accent transition-colors"
          aria-label="Telegram-канал"
        >
          Telegram-канал
        </Link>
      </div>
    </footer>
  )
}
