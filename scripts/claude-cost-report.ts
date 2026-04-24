import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { getServerClient } from '../lib/supabase'
import { queryClaudeCostReport } from '../pipeline/llm-usage'

const DAYS = Number(process.env.CLAUDE_COST_REPORT_DAYS ?? 2)

function money(value: number): string {
  return `$${value.toFixed(4)}`
}

async function main(): Promise<void> {
  const supabase = getServerClient()
  const now = new Date()
  const since = new Date(now.getTime() - DAYS * 24 * 60 * 60 * 1000)
  const report = await queryClaudeCostReport(supabase, since, now)

  console.log(`Claude cost report (${report.mode})`)
  console.log(`Window: ${report.window.since} → ${report.window.until}`)
  console.log(`Total cost: ${money(report.totalCostUsd)}`)
  console.log(`Calls: ${report.totalCalls}`)
  console.log(`Input tokens: ${report.totalInputTokens}`)
  console.log(`Output tokens: ${report.totalOutputTokens}`)
  console.log(`Cache read tokens: ${report.totalCacheReadTokens}`)
  console.log(`Cache create tokens: ${report.totalCacheCreateTokens}`)

  console.log('\nBy day:')
  for (const row of report.byDay) {
    console.log(
      `- ${row.key}: ${money(row.costUsd)} | calls=${row.calls} | in=${row.inputTokens} | out=${row.outputTokens}`,
    )
  }

  console.log('\nBy operation:')
  for (const row of report.byOperation.slice(0, 10)) {
    console.log(
      `- ${row.key}: ${money(row.costUsd)} | calls=${row.calls} | in=${row.inputTokens} | out=${row.outputTokens}`,
    )
  }

  console.log('\nBy source:')
  for (const row of report.bySource.slice(0, 10)) {
    console.log(
      `- ${row.key}: ${money(row.costUsd)} | calls=${row.calls} | in=${row.inputTokens} | out=${row.outputTokens}`,
    )
  }

  console.log('\nTop entries:')
  for (const row of report.topEntries.slice(0, 10)) {
    console.log(
      `- ${row.at} | ${money(row.costUsd)} | ${row.operation} | ${row.sourceName ?? 'unknown'} | ${row.originalTitle ?? 'n/a'}`
    )
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
