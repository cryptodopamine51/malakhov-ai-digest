import { NextRequest, NextResponse } from 'next/server'
import { getAdminClient } from '../../../lib/supabase'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const expectedToken = process.env.HEALTH_TOKEN
  const actualToken = request.nextUrl.searchParams.get('token')

  if (!expectedToken || actualToken !== expectedToken) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const supabase = getAdminClient()
  const [ingest, enrich, digest, alerts, batches] = await Promise.all([
    supabase
      .from('ingest_runs')
      .select('finished_at, status')
      .order('finished_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from('enrich_runs')
      .select('finished_at, status, run_kind')
      .order('finished_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from('digest_runs')
      .select('digest_date, status, sent_at')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from('pipeline_alerts')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'open'),
    supabase
      .from('anthropic_batches')
      .select('*', { count: 'exact', head: true })
      .eq('processing_status', 'in_progress'),
  ])

  return NextResponse.json(
    {
      ingest: ingest.data,
      enrich: enrich.data,
      digest: digest.data,
      alerts_open: alerts.count ?? 0,
      batches_open: batches.count ?? 0,
      server_time: new Date().toISOString(),
    },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
