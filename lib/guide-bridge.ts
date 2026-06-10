import { getGuideBySlug, type Guide } from './guides'

// Maps a news article's primary category to the most relevant evergreen guide
// for a «Разобраться глубже» bridge. All current guides belong to the
// "ИИ для бизнеса" cluster, so the pillar guide is the safe default; a few
// categories point at a more specific guide. Categories without a fitting
// guide (e.g. coding — the AI-coding cluster is not published yet) are omitted
// and fall back to related articles only.
const PILLAR = 'kak-vnedrit-ii-v-biznes-2026'
const AGENTS_BUSINESS = 'ii-agenty-dlya-biznesa-chto-eto-i-gde-primenyat'
const AGENTS_SALES = 'ii-agenty-v-prodazhah'

const GUIDE_BRIDGE_BY_CATEGORY: Record<string, string> = {
  'ai-industry': PILLAR,
  'ai-labs': PILLAR,
  'ai-russia': PILLAR,
  'ai-investments': PILLAR,
  'ai-startups': 'kak-vybrat-pervyj-ii-proekt-v-biznese',
  'ai-research': 'kakie-biznes-processy-avtomatizirovat-s-pomoshyu-ii',
}

export type GuideBridge = Pick<Guide, 'title' | 'path' | 'heroLead'>

type GuideBridgeArticleContext = {
  primary_category?: string | null
  ru_title?: string | null
  original_title?: string | null
  lead?: string | null
  card_teaser?: string | null
}

const AGENT_RE = /\b(?:ai agent|agentic ai|agents?)\b|(?:ии[-\s]?агент|агентск(?:ий|ие|их|ого)|агентн(?:ый|ые|ых|ого))/iu
const SALES_RE = /(?:продаж|лид(?:ы|ов|ам|ах)?|crm|воронк|сделк|follow[-\s]?up|sales|sdr|lead)/iu

function bridgeFromSlug(slug: string | null | undefined): GuideBridge | null {
  if (!slug) return null
  const guide = getGuideBySlug(slug)
  if (!guide || guide.noindex) return null
  return { title: guide.title, path: guide.path, heroLead: guide.heroLead }
}

// Returns an indexable guide to bridge to, or null when no relevant published
// guide exists for the category.
export function getGuideBridge(primaryCategory: string | null | undefined): GuideBridge | null {
  return bridgeFromSlug(primaryCategory ? GUIDE_BRIDGE_BY_CATEGORY[primaryCategory] : null)
}

export function getGuideBridgeForArticle(article: GuideBridgeArticleContext): GuideBridge | null {
  const text = [
    article.ru_title,
    article.original_title,
    article.lead,
    article.card_teaser,
  ].filter(Boolean).join('\n')

  if (AGENT_RE.test(text)) {
    const agentBridge = bridgeFromSlug(SALES_RE.test(text) ? AGENTS_SALES : AGENTS_BUSINESS)
    if (agentBridge) return agentBridge
  }

  return getGuideBridge(article.primary_category)
}
