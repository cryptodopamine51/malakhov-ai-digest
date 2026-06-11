import { config } from 'dotenv'
import { resolve } from 'path'
import { pathToFileURL } from 'url'

config({ path: resolve(process.cwd(), '.env.local') })

import { getServerClient } from '../lib/supabase'
import { sendOwnerFeedbackBatch } from '../pipeline/article-quality'

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`)
}

async function main(): Promise<void> {
  const botToken = process.env.TELEGRAM_BOT_TOKEN
  const adminChatId = process.env.TELEGRAM_ADMIN_CHAT_ID
  const dryRun = hasFlag('dry-run')

  if (!dryRun && !botToken) throw new Error('TELEGRAM_BOT_TOKEN missing')
  if (!dryRun && !adminChatId) throw new Error('TELEGRAM_ADMIN_CHAT_ID missing')

  const result = await sendOwnerFeedbackBatch({
    supabase: getServerClient(),
    botToken: botToken ?? '',
    adminChatId: adminChatId ?? '',
    dryRun,
  })
  console.log(`[quality-feedback] sent=${result.sent} skipped=${result.skipped}`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  })
}
