/**
 * app/topics/[topic]/page.tsx
 *
 * Legacy URL `/topics/<slug>`. После волны 2.2 настоящая лента раздела живёт по
 * `/categories/<slug>`. Slug-и совпадают (волна 2.1), поэтому здесь достаточно
 * 1:1 редиректа.
 */

import { permanentRedirect } from 'next/navigation'
import { isKnownCategory } from '../../../lib/categories'

export const revalidate = 3600

export default async function LegacyTopicPage({
  params,
}: {
  params: Promise<{ topic: string }>
}) {
  const { topic } = await params
  if (topic === 'ai-russia') permanentRedirect('/russia')
  if (isKnownCategory(topic)) permanentRedirect(`/categories/${topic}`)
  permanentRedirect('/')
}
