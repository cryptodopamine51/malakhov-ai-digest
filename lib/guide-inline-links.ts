// Render-time inline links from news article bodies to evergreen guides.
//
// P3 of docs/task_seo_growth_x2_2026-06-10.md: instead of hand-editing
// articles.link_anchors in the production DB, we detect verbatim guide-relevant
// phrases in editorial_body at render time and linkify them. This covers every
// current and future article with zero DB writes; the anchor is always the
// exact substring found in the paragraph, so the paragraph renderer can do a
// plain `para.includes(anchor)` match (same contract as article link_anchors).

import { getGuideBySlug } from './guides'

export type GuideInlineLink = {
  anchor: string
  href: string
}

type GuideResolver = (slug: string) => { path: string; noindex: boolean } | null

type Rule = {
  pattern: RegExp
  guideSlug: string
}

// Priority order matters: more specific phrases first so «ИИ-агенты в продажах»
// wins over the generic agents hub, and cost phrasing wins over generic
// «внедрение ИИ». Patterns are matched per paragraph and must be verbatim
// substrings (no normalization) so the renderer can split on them.
const RULES: Rule[] = [
  // NB: JS `\w` не матчит кириллицу — для русских окончаний используем [а-яё]*
  // (флаги `iu` дают case folding и для класса символов).
  {
    pattern: /ИИ-агент[а-яё]*\s+(?:в|для)\s+продаж[а-яё]*/iu,
    guideSlug: 'ii-agenty-v-prodazhah',
  },
  {
    pattern: /ИИ-агент[а-яё]*/iu,
    guideSlug: 'ii-agenty-dlya-biznesa-chto-eto-i-gde-primenyat',
  },
  {
    pattern: /(?:стоимост[а-яё]+|затрат[а-яё]+|бюджет[а-яё]*)\s+(?:на\s+)?внедрени[а-яё]+\s+ИИ/iu,
    guideSlug: 'skolko-stoit-vnedrenie-ii-v-kompaniyu',
  },
  {
    pattern: /автоматизаци[а-яё]+\s+бизнес-процесс[а-яё]*/iu,
    guideSlug: 'kakie-biznes-processy-avtomatizirovat-s-pomoshyu-ii',
  },
  {
    pattern: /внедрени[а-яё]+\s+ИИ|внедр[а-яё]+\s+ИИ\s+в\s+бизнес/iu,
    guideSlug: 'kak-vnedrit-ii-v-biznes-2026',
  },
]

export const MAX_GUIDE_INLINE_LINKS = 2

function defaultResolveGuide(slug: string): { path: string; noindex: boolean } | null {
  const guide = getGuideBySlug(slug)
  if (!guide) return null
  return { path: guide.path, noindex: guide.noindex === true }
}

// Returns up to MAX_GUIDE_INLINE_LINKS links whose anchors are verbatim
// substrings of `body`. One link per guide, one guide per anchor text;
// noindex guides are never linked. Paragraphs that look like headings or
// blockquotes are skipped to keep anchors inside running text.
export function findGuideInlineLinks(
  body: string,
  options: {
    max?: number
    resolveGuide?: GuideResolver
  } = {},
): GuideInlineLink[] {
  if (!body) return []
  const max = options.max ?? MAX_GUIDE_INLINE_LINKS
  const resolveGuide = options.resolveGuide ?? defaultResolveGuide

  const paragraphs = body
    .split('\n\n')
    .map((p) => p.trim())
    .filter((p) => p.length > 0 && !p.startsWith('#') && !p.startsWith('>'))

  const links: GuideInlineLink[] = []
  const usedGuides = new Set<string>()
  const usedAnchors = new Set<string>()

  for (const rule of RULES) {
    if (links.length >= max) break
    if (usedGuides.has(rule.guideSlug)) continue

    const guide = resolveGuide(rule.guideSlug)
    if (!guide || guide.noindex) continue

    for (const para of paragraphs) {
      const match = rule.pattern.exec(para)
      if (!match) continue
      const anchor = match[0]
      // The renderer assigns one link per paragraph by substring inclusion, so
      // an anchor that is a substring of an already-used anchor (or vice versa)
      // would double-link the same text run. Keep anchors disjoint.
      const collides = [...usedAnchors].some(
        (used) => used.includes(anchor) || anchor.includes(used),
      )
      if (collides) continue

      links.push({ anchor, href: guide.path })
      usedGuides.add(rule.guideSlug)
      usedAnchors.add(anchor)
      break
    }
  }

  return links
}
