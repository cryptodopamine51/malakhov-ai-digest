import Link from 'next/link'
import { cn } from '../../lib/utils'
import { TOPIC_TABS, type TopicTabItem } from './TopicTabs'

interface ArticleSectionNavProps {
  currentCategory: string
  className?: string
}

function hrefForCategory(category: string): string {
  return category === 'ai-russia' ? '/russia' : `/categories/${category}`
}

function orderedTabs(activeHref: string): TopicTabItem[] {
  const active = TOPIC_TABS.find((tab) => tab.href === activeHref)
  if (!active) return TOPIC_TABS
  return [active, ...TOPIC_TABS.filter((tab) => tab.href !== activeHref)]
}

export default function ArticleSectionNav({ currentCategory, className }: ArticleSectionNavProps) {
  const activeHref = hrefForCategory(currentCategory)

  return (
    <section className={cn('border-t border-line pt-6', className)}>
      <p className="mb-3 font-serif text-[10px] font-semibold uppercase tracking-[0.2em] text-muted">
        Продолжить по разделам
      </p>
      <nav
        aria-label="Продолжить по разделам"
        className="-mx-4 overflow-x-auto px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        <ul className="flex min-w-max items-center gap-2">
          {orderedTabs(activeHref).map((tab) => {
            const isActive = tab.href === activeHref
            return (
              <li key={tab.href}>
                <Link
                  href={tab.href}
                  aria-current={isActive ? 'page' : undefined}
                  className={cn(
                    'inline-flex items-center rounded-sm border px-2 py-[3px] text-[11px] font-medium uppercase tracking-[0.06em] transition-colors',
                    isActive
                      ? 'border-ink bg-ink text-page'
                      : 'border-line text-muted hover:border-ink hover:text-ink',
                  )}
                >
                  {tab.label}
                </Link>
              </li>
            )
          })}
        </ul>
      </nav>
    </section>
  )
}
