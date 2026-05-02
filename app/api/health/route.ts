import { NextRequest, NextResponse } from 'next/server'
import { getAdminClient } from '../../../lib/supabase'
import { getHealthSummary } from '../../../lib/health-summary'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const expectedToken = process.env.HEALTH_TOKEN
  const actualToken = request.nextUrl.searchParams.get('token')

  if (!expectedToken || actualToken !== expectedToken) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const summary = await getHealthSummary(getAdminClient())

  return NextResponse.json(summary, { headers: { 'Cache-Control': 'no-store' } })
}
