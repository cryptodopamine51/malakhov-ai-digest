export default function TelegramCTA() {
  const url = process.env.NEXT_PUBLIC_TELEGRAM_CHANNEL_URL ?? 'https://t.me/malakhovai'

  return (
    <div className="my-8 flex items-center gap-4 rounded-xl border border-accent/30 bg-accent/10 px-5 py-4">
      <svg
        className="flex-shrink-0 text-accent"
        width="28"
        height="28"
        viewBox="0 0 24 24"
        fill="currentColor"
      >
        <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.894 8.221-1.97 9.28c-.145.658-.537.818-1.084.508l-3-2.21-1.447 1.394c-.16.16-.295.295-.605.295l.213-3.053 5.56-5.023c.242-.213-.054-.333-.373-.12l-6.871 4.326-2.962-.924c-.643-.204-.657-.643.136-.953l11.57-4.461c.537-.194 1.006.131.833.941z" />
      </svg>
      <div className="flex-1">
        <p className="text-sm font-semibold text-[#e5e5e5]">Получать анонсы в Telegram</p>
        <p className="text-xs text-muted mt-0.5">Ежедневный дайджест лучших материалов об ИИ</p>
      </div>
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="flex-shrink-0 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent/80 transition-colors"
      >
        Подписаться
      </a>
    </div>
  )
}
