import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { getAdminClient } from '../lib/supabase'

async function main(): Promise<void> {
  const supabase = getAdminClient()
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const { data, error } = await supabase
    .from('pipeline_alerts')
    .update({ status: 'resolved', resolved_at: new Date().toISOString() })
    .eq('status', 'open')
    .lt('cooldown_until', cutoff)
    .select('id')

  if (error) throw error
  console.log(`Auto-resolved ${data?.length ?? 0} stale alerts`)
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err))
  process.exit(1)
})
