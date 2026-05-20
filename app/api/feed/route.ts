import { NextResponse } from 'next/server'
import { getArticlesFeed } from '../../../lib/articles'
import { getPaginationMeta, normalizePositivePage } from '../../../lib/pagination'

// Per-request dynamic by design — only called from client-side Load-more.
// Home/category/russia pages stay statically cacheable; this endpoint
// supplies pages 2+ on demand.
export const dynamic = 'force-dynamic'

const PER_PAGE = 12

export async function GET(request: Request) {
  const url = new URL(request.url)
  const page = normalizePositivePage(url.searchParams.get('page'))
  const excludeId = url.searchParams.get('excludeId')
  const excludeIds = excludeId ? [excludeId] : []

  const { articles, total } = await getArticlesFeed(page, PER_PAGE, { excludeIds })
  const pagination = getPaginationMeta(total, page, PER_PAGE)

  return NextResponse.json({
    articles,
    total,
    page,
    perPage: PER_PAGE,
    totalPages: pagination.totalPages,
    start: pagination.start,
    end: pagination.end,
  })
}
