import Link from 'next/link'
import { cn } from '../../lib/utils'

export interface TopicTabItem {
  href: string
  label: string
}

export const TOPIC_TABS: TopicTabItem[] = [
  { href: '/categories/ai-industry',    label: 'Индустрия' },
  { href: '/categories/ai-research',    label: 'Исследования' },
  { href: '/categories/ai-labs',        label: 'Лаборатории' },
  { href: '/categories/ai-investments', label: 'Инвестиции' },
  { href: '/categories/ai-startups',    label: 'Стартапы' },
  { href: '/russia',                    label: 'Россия' },
  { href: '/categories/coding',         label: 'Код' },
]

interface TopicTabsProps {
  activeHref?: string
  className?: string
}

export default function TopicTabs({ activeHref, className }: TopicTabsProps) {
  return (
    <nav
      aria-label="Разделы"
      className={cn(
        '-mx-4 overflow-x-auto px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
        className
      )}
    >
      <ul className="flex min-w-max items-center gap-2">
        {TOPIC_TABS.map((tab) => {
          const isActive = tab.href === activeHref
          return (
            <li key={tab.href}>
              <Link
                href={tab.href}
                aria-current={isActive ? 'page' : undefined}
                className={cn(
                  'inline-flex items-center rounded-sm border px-2 py-[3px] text-[11px] font-medium uppercase tracking-[0.06em] transition-colors',
                  isActive
                    ? 'border-ink bg-ink text-base'
                    : 'border-line text-muted hover:border-ink hover:text-ink'
                )}
              >
                {tab.label}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
