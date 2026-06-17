import { NextRequest, NextResponse } from 'next/server'
import { getServerClient } from '../../../../lib/supabase'

const VERIFYABLE_STATUSES = ['publish_ready', 'verifying', 'live', 'verification_failed'] as const

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type RouteContext = {
  params: Promise<{ slug: string }>
}

export async function HEAD(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  return handleInternalArticleVerify(request, context)
}

export async function GET(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  return handleInternalArticleVerify(request, context)
}

function isAuthorized(request: NextRequest): boolean {
  const expected = process.env.PUBLISH_VERIFY_SECRET
  if (!expected) return false

  const headerToken = request.headers.get('x-publish-verify-secret')
  const queryToken = request.nextUrl.searchParams.get('token')
  return headerToken === expected || queryToken === expected
}

async function resolveArticle(slug: string) {
  const { data, error } = await getServerClient()
    .from('articles')
    .select('id, slug, publish_status, verified_live')
    .eq('slug', slug)
    .eq('published', true)
    .eq('quality_ok', true)
    .in('publish_status', [...VERIFYABLE_STATUSES])
    .maybeSingle()

  if (error) throw error
  return data
}

async function handleInternalArticleVerify(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const { slug: rawSlug } = await context.params
  const slug = decodeURIComponent(rawSlug ?? '').trim()
  if (!slug) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  let article
  try {
    article = await resolveArticle(slug)
  } catch {
    return NextResponse.json({ error: 'article_lookup_failed' }, { status: 500 })
  }
  if (!article) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  if (request.method === 'GET') {
    return NextResponse.json({
      ok: true,
      id: article.id,
      slug: article.slug,
      publish_status: article.publish_status,
      verified_live: article.verified_live,
    }, { headers: { 'Cache-Control': 'no-store' } })
  }

  return new NextResponse(null, {
    status: 200,
    headers: { 'Cache-Control': 'no-store' },
  })
}
