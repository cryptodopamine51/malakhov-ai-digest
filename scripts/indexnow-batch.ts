/**
 * scripts/indexnow-batch.ts
 *
 * Post-deploy IndexNow batch ping for the SEO improvements wave 2026-05-21.
 *
 * After the wave is deployed (BreadcrumbList JSON-LD, NewsArticle wordCount /
 * abstract / articleSection, og:image cover 1200x630, SITE_LOGO_URL fallback)
 * the canonical URLs themselves do not change — but the structured data and
 * rendered HTML do. IndexNow nudges Yandex/Bing/Naver/Seznam to re-crawl
 * sooner than the natural sitemap revisit window.
 *
 * Default scope:
 *   - home, /russia, /about, all /categories/<cat>;
 *   - all evergreen guide URLs;
 *   - the last N live articles (default 50).
 *
 * Usage:
 *   npx tsx scripts/indexnow-batch.ts              # dry-run, prints the URL list
 *   npx tsx scripts/indexnow-batch.ts --apply      # actually call pingIndexNow
 *   npx tsx scripts/indexnow-batch.ts --apply --limit=100
 *
 * Requires `INDEXNOW_KEY` in env (loaded by Vercel/Production or .env.local).
 * Pings are batched 100 URLs per request (IndexNow soft cap).
 */

import { getArticleUrl } from '../lib/article-slugs'
import { getAllArticlesForSitemap } from '../lib/articles'
import { getAllGuides, getGuideAbsoluteUrl } from '../lib/guides'
import { pingIndexNow } from '../lib/indexnow'
import { SITE_URL } from '../lib/site'

const CATEGORIES = [
  '/categories/ai-industry',
  '/categories/ai-research',
  '/categories/ai-labs',
  '/categories/ai-investments',
  '/categories/ai-startups',
  '/categories/ai-russia',
  '/categories/coding',
]

const STATIC_PATHS = ['/', '/russia', '/about', '/guides', '/sources', ...CATEGORIES]

function parseLimit(): number {
  const arg = process.argv.find((value) => value.startsWith('--limit='))
  if (!arg) return 50
  const parsed = Number.parseInt(arg.slice('--limit='.length), 10)
  if (!Number.isFinite(parsed) || parsed < 1) return 50
  return Math.min(parsed, 200)
}

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply')
  const limit = parseLimit()

  const staticUrls = STATIC_PATHS.map((path) => `${SITE_URL}${path}`)

  const guides = getAllGuides()
  const guideUrls = guides.map((guide) => getGuideAbsoluteUrl(guide))

  const sitemapArticles = await getAllArticlesForSitemap()
  // sitemapArticles is sorted by updated_at desc inside the helper.
  const recentArticleUrls = sitemapArticles
    .slice(0, limit)
    .map((article) => getArticleUrl(SITE_URL, article.slug, article.primaryCategory))

  const all = Array.from(new Set([...staticUrls, ...guideUrls, ...recentArticleUrls]))

  console.log(`[indexnow-batch] dry=${!apply}, limit=${limit}`)
  console.log(`[indexnow-batch] static=${staticUrls.length} guides=${guideUrls.length} articles=${recentArticleUrls.length} total_unique=${all.length}`)

  if (!apply) {
    for (const url of all) console.log(url)
    console.log('[indexnow-batch] dry-run done; pass --apply to actually ping')
    return
  }

  // IndexNow caps at 100 URLs per request — batch.
  const BATCH = 100
  let pinged = 0
  let failed = 0
  for (let i = 0; i < all.length; i += BATCH) {
    const chunk = all.slice(i, i + BATCH)
    const result = await pingIndexNow(chunk)
    if (result.ok) {
      pinged += result.pinged
      console.log(`[indexnow-batch] batch ${i / BATCH + 1}: pinged ${result.pinged} status=${result.status}`)
    } else {
      failed += chunk.length
      console.error(`[indexnow-batch] batch ${i / BATCH + 1} FAILED status=${result.status} skipped=${result.skipped ?? ''} error=${result.errorMessage ?? ''}`)
    }
  }

  console.log(`[indexnow-batch] done: pinged=${pinged} failed=${failed}`)
}

main().catch((error) => {
  console.error('[indexnow-batch] fatal:', error)
  process.exit(1)
})
