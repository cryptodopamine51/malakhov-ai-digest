'use client'

import { useEffect, useMemo, useState } from 'react'

const ABSOLUTE_FMT = new Intl.DateTimeFormat('ru-RU', {
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'Europe/Moscow',
})

const ABSOLUTE_WITH_DATE_FMT = new Intl.DateTimeFormat('ru-RU', {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'Europe/Moscow',
})

const RELATIVE_FMT = new Intl.RelativeTimeFormat('ru', { numeric: 'auto', style: 'long' })

function absoluteLabel(date: Date, now: Date): string {
  const sameDay =
    date.toLocaleDateString('ru-RU', { timeZone: 'Europe/Moscow' }) ===
    now.toLocaleDateString('ru-RU', { timeZone: 'Europe/Moscow' })
  return sameDay ? ABSOLUTE_FMT.format(date) : ABSOLUTE_WITH_DATE_FMT.format(date)
}

function relativeLabel(date: Date, now: Date): string {
  const diffMs = date.getTime() - now.getTime()
  const diffSec = Math.round(diffMs / 1000)
  const absSec = Math.abs(diffSec)

  if (absSec < 45) return 'только что'
  if (absSec < 3600) return RELATIVE_FMT.format(Math.round(diffSec / 60), 'minute')
  if (absSec < 24 * 3600) return RELATIVE_FMT.format(Math.round(diffSec / 3600), 'hour')
  if (absSec < 7 * 24 * 3600) return RELATIVE_FMT.format(Math.round(diffSec / (24 * 3600)), 'day')

  return absoluteLabel(date, now)
}

interface RelativeTimeProps {
  date: string | Date
  className?: string
}

export default function RelativeTime({ date, className }: RelativeTimeProps) {
  const target = useMemo(() => (typeof date === 'string' ? new Date(date) : date), [date])
  const isoForTitle = target.toISOString()

  const [label, setLabel] = useState<string>(() => absoluteLabel(target, target))
  const [hydrated, setHydrated] = useState(false)

  useEffect(() => {
    setHydrated(true)
    const tick = () => setLabel(relativeLabel(target, new Date()))
    tick()
    const interval = window.setInterval(tick, 60_000)
    return () => window.clearInterval(interval)
  }, [target])

  return (
    <time
      dateTime={isoForTitle}
      title={isoForTitle}
      suppressHydrationWarning
      className={className}
    >
      {hydrated ? label : absoluteLabel(target, target)}
    </time>
  )
}
