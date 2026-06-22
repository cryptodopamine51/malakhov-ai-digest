/** CLI wrapper for weekly Telegram report previews and scheduled/manual runs. */

import { config } from 'dotenv'
import { resolve } from 'path'
import { pathToFileURL } from 'url'

import {
  runWeeklyReport,
  type WeeklyReportDelivery,
  type WeeklyReportFormatArg,
} from './weekly-report-core'

config({ path: resolve(process.cwd(), '.env.local') })

interface WeeklyReportCliOptions {
  reportDate?: string
  weekStart?: string
  format?: WeeklyReportFormatArg
  delivery?: WeeklyReportDelivery
  pinnedArticle?: string
  marker?: boolean
}

const FORMATS = new Set<WeeklyReportFormatArg>(['signal', 'business', 'channel', 'all'])

function valueAfterEquals(arg: string, name: string): string | null {
  const prefix = `${name}=`
  return arg.startsWith(prefix) ? arg.slice(prefix.length) : null
}

export function parseWeeklyReportCliArgs(argv: string[]): WeeklyReportCliOptions {
  const result: WeeklyReportCliOptions = {}
  for (const arg of argv) {
    if (arg === '--dry-run') {
      result.delivery = 'dry-run'
      continue
    }
    if (arg === '--send=admin') {
      result.delivery = 'preview'
      continue
    }
    if (arg === '--scheduled') {
      result.delivery = 'scheduled'
      continue
    }
    if (arg === '--markers') {
      result.marker = true
      continue
    }
    const reportDate = valueAfterEquals(arg, '--report-date')
    if (reportDate !== null) {
      result.reportDate = reportDate
      continue
    }
    const weekStart = valueAfterEquals(arg, '--week-start')
    if (weekStart !== null) {
      result.weekStart = weekStart
      continue
    }
    const pinnedArticle = valueAfterEquals(arg, '--pin')
    if (pinnedArticle !== null) {
      result.pinnedArticle = pinnedArticle
      continue
    }
    const format = valueAfterEquals(arg, '--format')
    if (format !== null) {
      if (!FORMATS.has(format as WeeklyReportFormatArg)) throw new Error(`Неизвестный --format=${format}`)
      result.format = format as WeeklyReportFormatArg
      continue
    }
    throw new Error(`Неизвестный аргумент: ${arg}`)
  }

  if (!result.delivery) throw new Error('Требуется --dry-run, --send=admin или --scheduled')
  if (result.delivery === 'scheduled' && result.format === 'all') {
    throw new Error('--scheduled не поддерживает --format=all')
  }
  return result
}

async function main(): Promise<void> {
  try {
    const result = await runWeeklyReport(parseWeeklyReportCliArgs(process.argv.slice(2)))
    console.log(`[weekly-report] result=${result.status} week=${result.weekStart}..${result.weekEnd}`)
    process.exitCode = 0
  } catch (error) {
    console.error(`[weekly-report] ${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 1
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main()
}
