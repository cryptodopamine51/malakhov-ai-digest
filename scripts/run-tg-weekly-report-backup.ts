/** GitHub Actions backup for the Monday weekly Telegram report. */

import { runWeeklyReport } from '../bot/weekly-report-core'

async function main(): Promise<void> {
  const result = await runWeeklyReport({ delivery: 'scheduled' })
  console.log(`[weekly-report-backup] status=${result.status} week=${result.weekStart}..${result.weekEnd}`)
  if (result.status === 'skipped-low-articles') process.exitCode = 1
}

void main().catch((error) => {
  console.error('[weekly-report-backup] failed:', error)
  process.exitCode = 1
})
