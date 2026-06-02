import { getGuideBySlug, type Guide } from './guides'

// Maps a news article's primary category to the most relevant evergreen guide
// for a «Разобраться глубже» bridge. All current guides belong to the
// "ИИ для бизнеса" cluster, so the pillar guide is the safe default; a few
// categories point at a more specific guide. Categories without a fitting
// guide (e.g. coding — the AI-coding cluster is not published yet) are omitted
// and fall back to related articles only.
const PILLAR = 'kak-vnedrit-ii-v-biznes-2026'

const GUIDE_BRIDGE_BY_CATEGORY: Record<string, string> = {
  'ai-industry': PILLAR,
  'ai-labs': PILLAR,
  'ai-russia': PILLAR,
  'ai-investments': PILLAR,
  'ai-startups': 'kak-vybrat-pervyj-ii-proekt-v-biznese',
  'ai-research': 'kakie-biznes-processy-avtomatizirovat-s-pomoshyu-ii',
}

export type GuideBridge = Pick<Guide, 'title' | 'path' | 'heroLead'>

// Returns an indexable guide to bridge to, or null when no relevant published
// guide exists for the category.
export function getGuideBridge(primaryCategory: string | null | undefined): GuideBridge | null {
  if (!primaryCategory) return null
  const slug = GUIDE_BRIDGE_BY_CATEGORY[primaryCategory]
  if (!slug) return null
  const guide = getGuideBySlug(slug)
  if (!guide || guide.noindex) return null
  return { title: guide.title, path: guide.path, heroLead: guide.heroLead }
}
