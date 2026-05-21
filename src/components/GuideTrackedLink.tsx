'use client'

import type { ReactNode } from 'react'

declare global {
  interface Window {
    ym?: (counterId: number, method: string, goal: string, params?: Record<string, string>) => void
  }
}

interface GuideTrackedLinkProps {
  href: string
  children: ReactNode
  className?: string
  target?: string
  rel?: string
  goal: string
  metrikaId?: string
  params: Record<string, string>
}

export default function GuideTrackedLink({
  href,
  children,
  className,
  target,
  rel,
  goal,
  metrikaId,
  params,
}: GuideTrackedLinkProps) {
  const handleClick = () => {
    const id = Number(metrikaId)
    if (!Number.isFinite(id) || !window.ym) return

    window.ym(id, 'reachGoal', goal, params)
  }

  return (
    <a href={href} target={target} rel={rel} className={className} onClick={handleClick}>
      {children}
    </a>
  )
}
