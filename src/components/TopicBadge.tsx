import { cn } from '../../lib/utils'

export const TOPIC_LABELS: Record<string, string> = {
  'ai-industry':    'Индустрия',
  'ai-research':    'Исследования',
  'ai-labs':        'Лаборатории',
  'ai-russia':      'Россия',
  'coding':         'Код',
  'ai-investments': 'Инвестиции',
  'ai-startups':    'Стартапы',
}

interface TopicBadgeProps {
  topic: string
  className?: string
}

export default function TopicBadge({ topic, className }: TopicBadgeProps) {
  const label = TOPIC_LABELS[topic] ?? topic
  const isRussia = topic === 'ai-russia'

  return (
    <span
      className={cn(
        'inline-flex items-center px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.06em]',
        'border rounded-sm',
        isRussia
          ? 'border-russia/50 text-russia'
          : 'border-line text-muted',
        className
      )}
    >
      {label}
    </span>
  )
}
