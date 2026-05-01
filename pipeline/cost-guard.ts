import { config } from 'dotenv'
import { resolve } from 'path'
import { pathToFileURL } from 'url'
config({ path: resolve(process.cwd(), '.env.local') })

import type { SupabaseClient } from '@supabase/supabase-js'
import { getServerClient } from '../lib/supabase'
import { fireAlert, resolveAlert } from './alerts'
import { queryClaudeCostReport } from './llm-usage'

const MOSCOW_TZ = 'Europe/Moscow'
const DAILY_BUDGET_USD = Number(process.env.CLAUDE_DAILY_BUDGET_USD ?? 1)

export interface DailyBudgetStatus {
  spent: number
  budget: number
  overBudget: boolean
  topOps: Array<{ key: string; costUsd: number }>
}

/**
 * Возвращает текущее состояние дневного расхода Claude по МСК.
 * Используется и cost-guard cron-ом (для алёртов), и enrich-submit-batch
 * (для проактивной блокировки до того, как мы потратим больше денег).
 */
export async function getDailyBudgetStatus(supabase: SupabaseClient): Promise<DailyBudgetStatus> {
  const report = await queryClaudeCostReport(supabase, getMoscowDayStart(), new Date())
  return {
    spent: report.totalCostUsd,
    budget: DAILY_BUDGET_USD,
    overBudget: report.totalCostUsd > DAILY_BUDGET_USD,
    topOps: report.byOperation.slice(0, 5).map((row) => ({ key: row.key, costUsd: row.costUsd })),
  }
}

function log(msg: string): void {
  const ts = new Date().toTimeString().slice(0, 8)
  console.log(`[${ts}] ${msg}`)
}

function getMoscowDayStart(): Date {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: MOSCOW_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date())

  const year = parts.find((part) => part.type === 'year')?.value ?? '1970'
  const month = parts.find((part) => part.type === 'month')?.value ?? '01'
  const day = parts.find((part) => part.type === 'day')?.value ?? '01'

  return new Date(`${year}-${month}-${day}T00:00:00+03:00`)
}

async function main(): Promise<void> {
  log('=== cost-guard check ===')

  const supabase = getServerClient()
  const now = new Date()
  const report = await queryClaudeCostReport(supabase, getMoscowDayStart(), now)
  const overBudget = report.totalCostUsd > DAILY_BUDGET_USD

  log(
    `Claude spend today: $${report.totalCostUsd.toFixed(4)} / budget $${DAILY_BUDGET_USD.toFixed(2)} ` +
    `(mode=${report.mode}, calls=${report.totalCalls}, in=${report.totalInputTokens}, out=${report.totalOutputTokens})`
  )

  if (overBudget) {
    const topOps = report.byOperation
      .slice(0, 3)
      .map((row) => `${row.key}=${row.costUsd.toFixed(4)}`)
      .join(', ')

    await fireAlert({
      supabase,
      alertType: 'claude_daily_budget_exceeded',
      severity: 'warning',
      entityKey: 'anthropic',
      message:
        `Claude spend for current Moscow day is $${report.totalCostUsd.toFixed(4)} ` +
        `against budget $${DAILY_BUDGET_USD.toFixed(2)}. Top operations: ${topOps || 'n/a'}.`,
      payload: {
        budgetUsd: DAILY_BUDGET_USD,
        reportMode: report.mode,
        totalCostUsd: report.totalCostUsd,
        totalCalls: report.totalCalls,
        totalInputTokens: report.totalInputTokens,
        totalOutputTokens: report.totalOutputTokens,
        byOperation: report.byOperation.slice(0, 5),
      },
      botToken: process.env.TELEGRAM_BOT_TOKEN,
      adminChatId: process.env.TELEGRAM_ADMIN_CHAT_ID,
    })
    log('⚠️ Claude daily budget exceeded alert fired')
  } else {
    await resolveAlert(supabase, 'claude_daily_budget_exceeded', 'anthropic')
  }

  log('=== cost-guard завершён ===')
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  })
}
