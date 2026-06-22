import { NextRequest, NextResponse } from 'next/server'

import { runWeeklyReport } from '../../../../bot/weekly-report-core'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    return NextResponse.json({ ok: false, error: 'CRON_SECRET is not configured' }, { status: 500 })
  }
  if (request.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }

  try {
    const result = await runWeeklyReport({ delivery: 'scheduled' })
    const failed = result.status === 'skipped-low-articles'
    return NextResponse.json(
      { ok: !failed, ...result },
      { status: failed ? 503 : 200, headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (error) {
    console.error('[cron/tg-weekly-report] unhandled error:', error)
    return NextResponse.json(
      { ok: false, status: 'failed', error: error instanceof Error ? error.message : String(error) },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    )
  }
}
