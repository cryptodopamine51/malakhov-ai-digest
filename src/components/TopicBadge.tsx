import { cn } from '../../lib/utils'

const TOPIC_LABELS: Record<string, string> = {
  'ai-industry':  'Индустрия',
  'ai-research':  'Исследования',
  'ai-labs':      'Лаборатории',
  'ai-russia':    '🇷🇺 Россия',
  'coding':       'Код',
}

const TOPIC_CLASSES: Record<string, string> = {
  'ai-russia': 'bg-russia/20 text-red-400 border border-russia/30',
}

const DEFAULT_CLASS = 'bg-accent/20 text-indigo-300 border border-accent/30'

interface TopicBadgeProps {
  topic: string
  className?: string
}

export default function TopicBadge({ topic, className }: TopicBadgeProps) {
  const label = TOPIC_LABELS[topic] ?? topic
  const colorClass = TOPIC_CLASSES[topic] ?? DEFAULT_CLASS

  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
        colorClass,
        className
      )}
    >
      {label}
    </span>
  )
}
