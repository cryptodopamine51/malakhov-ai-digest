import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 10

/**
 * Legacy endpoint for the old single-message daily digest.
 * Production Telegram delivery now uses /api/cron/tg-channel-post?slot=1..5.
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

  return NextResponse.json(
    {
      ok: true,
      status: 'disabled_replaced_by_channel_posts',
      replacement: '/api/cron/tg-channel-post?slot=1..5',
    },
    { status: 200, headers: { 'Cache-Control': 'no-store' } },
  )
}
