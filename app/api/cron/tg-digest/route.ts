import { NextRequest, NextResponse } from 'next/server'
import { runDailyDigest } from '../../../../bot/daily-digest-core'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
// Серверная функция должна успеть отработать дайджест за один заход:
// HEAD-проверки 5 статей (~5s) + Telegram send + Supabase writes. С запасом.
export const maxDuration = 60

/**
 * Vercel Cron endpoint для ежедневного Telegram-дайджеста.
 *
 * Расписание задано в `vercel.json`:
 *   - `30 6 * * 1-5` → 09:30 МСК, Пн–Пт
 *   - `30 8 * * 6,0` → 11:30 МСК, Сб + Вс
 *
 * Vercel автоматически добавляет `Authorization: Bearer ${CRON_SECRET}`
 * к запросам, если в проектных env есть переменная `CRON_SECRET`.
 *
 * UNIQUE-claim в `digest_runs(digest_date+channel_id)` гарантирует,
 * что повторный вызов (ручной / случайный) не отправит дубль.
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

  try {
    const result = await runDailyDigest()
    const httpStatus =
      result.status === 'failed' || result.status === 'preflight_failed' ? 500 : 200
    return NextResponse.json(
      { ok: httpStatus === 200, ...result },
      { status: httpStatus, headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (err) {
    console.error('[cron/tg-digest] unhandled error:', err)
    return NextResponse.json(
      { ok: false, status: 'failed', error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    )
  }
}
