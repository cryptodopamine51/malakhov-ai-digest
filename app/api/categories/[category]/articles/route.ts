import { NextResponse } from 'next/server'
import { CATEGORY_PAGE_SIZE, getArticlesByCategoryPage } from '../../../../../lib/articles'
import { isKnownCategory } from '../../../../../lib/categories'
import { getPaginationMeta, normalizePositivePage } from '../../../../../lib/pagination'

export const revalidate = 300

export async function GET(
  request: Request,
  { params }: { params: Promise<{ category: string }> }
) {
  const { category } = await params
  if (!isKnownCategory(category)) {
    return NextResponse.json({ error: 'unknown_category' }, { status: 404 })
  }

  const url = new URL(request.url)
  const page = normalizePositivePage(url.searchParams.get('page'))
  const perPage = CATEGORY_PAGE_SIZE
  const { articles, total } = await getArticlesByCategoryPage(category, page, perPage)
  const pagination = getPaginationMeta(total, page, perPage)

  return NextResponse.json({
    articles,
    total,
    page,
    perPage,
    totalPages: pagination.totalPages,
    start: pagination.start,
    end: pagination.end,
  })
}
