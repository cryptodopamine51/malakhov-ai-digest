import type { MetadataRoute } from 'next'
import { SITE_HOST, SITE_URL } from '../lib/site'

// Explicit allow-rules for AI bots. The default `*` rule already allows
// crawling, but several LLM-side crawlers respect ONLY their named entry
// (or otherwise lower priority on `*`). Listing them explicitly maximises
// the chance that public articles end up in their indexes / RAG corpora.
//
// Not included on purpose: Bytespider, Amazonbot — pending owner decision.
const AI_BOT_ALLOW_LIST: string[] = [
  // Search / chat
  'OAI-SearchBot',
  'ChatGPT-User',
  'GPTBot',
  'Google-Extended',
  // Anthropic family
  'ClaudeBot',
  'anthropic-ai',
  'claude-web',
  // Other LLM crawlers
  'PerplexityBot',
  'CCBot',
  'Applebot-Extended',
  'DuckAssistBot',
  'MistralAI-User',
  'cohere-ai',
]

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: ['/demo/', '/internal/', '/api/', '/_next/'],
      },
      {
        userAgent: 'Googlebot',
        allow: '/',
      },
      {
        userAgent: 'Bingbot',
        allow: '/',
      },
      ...AI_BOT_ALLOW_LIST.map((userAgent) => ({
        userAgent,
        allow: '/',
        disallow: ['/demo/', '/internal/', '/api/', '/_next/'],
      })),
    ],
    sitemap: [
      `${SITE_URL}/sitemap.xml`,
      `${SITE_URL}/news-sitemap.xml`,
    ],
    host: SITE_HOST,
  }
}
