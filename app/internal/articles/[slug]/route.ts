import { NextRequest, NextResponse } from 'next/server'
import { getServerClient } from '../../../../lib/supabase'

const VERIFYABLE_STATUSES = ['publish_ready', 'verifying', 'live', 'verification_failed'] as const

function isAuthorized(request: NextRequest): boolean {
  const expected = process.env.PUBLISH_VERIFY_SECRET
  if (!expected) return false

  const headerToken = request.headers.get('x-publish-verify-secret')
  const queryToken = request.nextUrl.searchParams.get('token')
  return headerToken === expected || queryToken === expected
}

async function resolveArticle(slug: string) {
  const supabase = getServerClient()
  const { data, error } = await supabase
    .from('articles')
    .select('id, slug, publish_status, verified_live')
    .eq('slug', slug)
    .eq('published', true)
    .eq('quality_ok', true)
    .in('publish_status', [...VERIFYABLE_STATUSES])
    .maybeSingle()

  if (error) {
    throw error
  }

  return data
}

export async function GET(
  request: NextRequest,
  context: { params: { slug: string } },
) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const article = await resolveArticle(context.params.slug)
  if (!article) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }

  return NextResponse.json({
    ok: true,
    id: article.id,
    slug: article.slug,
    publish_status: article.publish_status,
    verified_live: article.verified_live,
  })
}

export async function HEAD(
  request: NextRequest,
  context: { params: { slug: string } },
) {
  if (!isAuthorized(request)) {
    return new Response(null, { status: 401 })
  }

  const article = await resolveArticle(context.params.slug)
  if (!article) {
    return new Response(null, { status: 404 })
  }

  return new Response(null, { status: 200 })
}
