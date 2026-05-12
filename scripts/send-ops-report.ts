import { config } from 'dotenv'
import { resolve } from 'path'
import { pathToFileURL } from 'url'

config({ path: resolve(process.cwd(), '.env.local') })

import { getServerClient } from '../lib/supabase'
import {
  formatOpsSummaryForTelegram,
  getOpsSummary,
  resolveOpsReportKind,
} from '../lib/ops-summary'

interface TelegramResponse {
  ok: boolean
  description?: string
  result?: { message_id?: number }
}

function arg(name: string): string | undefined {
  return process.argv.find((item) => item.startsWith(`--${name}=`))?.split('=').slice(1).join('=')
}

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`)
}

async function sendTelegramMessage(botToken: string, chatId: string, text: string): Promise<number> {
  const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    }),
  })

  const data = (await res.json()) as TelegramResponse
  if (!res.ok || !data.ok) {
    throw new Error(`Telegram send failed: ${res.status} ${data.description ?? ''}`.trim())
  }
  if (typeof data.result?.message_id !== 'number') {
    throw new Error('Telegram send failed: no result.message_id')
  }
  return data.result.message_id
}

export async function runOpsReport(): Promise<void> {
  const now = new Date()
  const reportKind = resolveOpsReportKind(arg('kind') ?? process.env.OPS_REPORT_KIND, now)
  const dryRun = hasFlag('dry-run') || process.env.OPS_REPORT_DRY_RUN === '1'

  const summary = await getOpsSummary(getServerClient(), { reportKind, now })
  const message = formatOpsSummaryForTelegram(summary)

  if (dryRun) {
    console.log(message)
    return
  }

  const botToken = process.env.TELEGRAM_BOT_TOKEN
  const adminChatId = process.env.TELEGRAM_ADMIN_CHAT_ID
  if (!botToken) throw new Error('TELEGRAM_BOT_TOKEN missing')
  if (!adminChatId) throw new Error('TELEGRAM_ADMIN_CHAT_ID missing')

  const messageId = await sendTelegramMessage(botToken, adminChatId, message)
  console.log(`[ops-report] sent ${reportKind} report to admin chat, message_id=${messageId}`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runOpsReport().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  })
}
