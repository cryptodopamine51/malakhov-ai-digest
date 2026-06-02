import Link from 'next/link'
import {
  CONTACTS_URL,
  EDITOR_IMAGE_PATH,
  EDITOR_NAME,
  EDITOR_PATH,
  PERSONAL_TELEGRAM_URL,
  SERVICES_PATH,
} from '../../lib/site'

const EDITOR_ROLE = 'AI-архитектор · внедряю ИИ в бизнес'

// Single author card shared by guides and news. Two CTAs that must stay
// distinct: personal Telegram (@malakhovai, brand/sales) and a consultation
// link. The consultation target is the internal /services page by default so
// the news domain keeps the visit and /services accrues SEO weight; pass
// `consultationHref="contacts"` to link straight to malakhovai.ru/contacts.
export default function AuthorCard({
  consultationHref = 'services',
  className = '',
}: {
  consultationHref?: 'services' | 'contacts'
  className?: string
}) {
  const consultUrl = consultationHref === 'contacts' ? CONTACTS_URL : SERVICES_PATH
  const consultIsExternal = consultUrl.startsWith('http')

  return (
    <aside
      className={`flex flex-col gap-4 rounded border border-line bg-surface p-5 sm:flex-row sm:items-center ${className}`}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={EDITOR_IMAGE_PATH}
        alt={EDITOR_NAME}
        width={72}
        height={72}
        loading="lazy"
        className="h-[72px] w-[72px] flex-shrink-0 rounded-full border border-line object-cover"
      />
      <div className="flex-1">
        <Link href={EDITOR_PATH} className="text-sm font-semibold text-ink hover:text-accent">
          {EDITOR_NAME}
        </Link>
        <p className="mt-0.5 text-xs text-muted">{EDITOR_ROLE}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <a
            href={PERSONAL_TELEGRAM_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex rounded border border-line px-3 py-1.5 text-sm font-medium text-ink transition-colors hover:border-accent hover:text-accent"
          >
            Личный Telegram
          </a>
          {consultIsExternal ? (
            <a
              href={consultUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex rounded border border-ink px-3 py-1.5 text-sm font-semibold text-ink transition-colors hover:bg-ink hover:text-[var(--base)]"
            >
              Консультация
            </a>
          ) : (
            <Link
              href={consultUrl}
              className="inline-flex rounded border border-ink px-3 py-1.5 text-sm font-semibold text-ink transition-colors hover:bg-ink hover:text-[var(--base)]"
            >
              Консультация
            </Link>
          )}
        </div>
      </div>
    </aside>
  )
}
