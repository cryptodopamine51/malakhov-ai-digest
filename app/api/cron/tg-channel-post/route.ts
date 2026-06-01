import { NextRequest, NextResponse } from 'next/server'
import { parseSlot, runChannelPost } from '../../../../bot/channel-post-core'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * Vercel/Supabase pg_cron endpoint for one Telegram channel slot post.
 *
 * Query:
 *   /api/cron/tg-channel-post?slot=1..5
 */
export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    return NextResponse.json(
      { ok: false, error: 'CRON_SECRET is not configured' },
      { status: 500 },
    )
  }

  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }

  const slot = parseSlot(request.nextUrl.searchParams.get('slot'))
  if (!slot) {
    return NextResponse.json({ ok: false, error: 'slot must be 1..5' }, { status: 400 })
  }

  try {
    const result = await runChannelPost(slot)
    const httpStatus =
      result.status === 'failed' || result.status === 'preflight_failed' ? 500 : 200
    return NextResponse.json(
      { ok: httpStatus === 200, ...result },
      { status: httpStatus, headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (err) {
    console.error('[cron/tg-channel-post] unhandled error:', err)
    return NextResponse.json(
      { ok: false, status: 'failed', error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    )
  }
}
