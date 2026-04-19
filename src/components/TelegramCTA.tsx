export default function TelegramCTA() {
  const url = process.env.NEXT_PUBLIC_TELEGRAM_CHANNEL_URL ?? 'https://t.me/malakhovai'

  return (
    <div className="my-8 flex flex-col sm:flex-row items-start sm:items-center gap-4 rounded border border-line bg-surface px-5 py-5">
      <svg
        className="flex-shrink-0"
        style={{ color: '#26A5E4' }}
        width="24"
        height="24"
        viewBox="0 0 24 24"
        fill="currentColor"
      >
        <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.894 8.221-1.97 9.28c-.145.658-.537.818-1.084.508l-3-2.21-1.447 1.394c-.16.16-.295.295-.605.295l.213-3.053 5.56-5.023c.242-.213-.054-.333-.373-.12l-6.871 4.326-2.962-.924c-.643-.204-.657-.643.136-.953l11.57-4.461c.537-.194 1.006.131.833.941z" />
      </svg>
      <div className="flex-1">
        <p className="text-sm font-semibold text-ink">Получать анонсы в Telegram</p>
        <p className="text-xs text-muted mt-0.5">Ежедневный дайджест лучших материалов об ИИ</p>
      </div>
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="flex-shrink-0 rounded border border-ink px-4 py-2 text-sm font-medium text-ink transition-colors hover:bg-ink hover:text-[var(--base)]"
      >
        Подписаться
      </a>
    </div>
  )
}
