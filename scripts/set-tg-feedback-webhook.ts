import { config } from 'dotenv'
import { resolve } from 'path'
import { pathToFileURL } from 'url'

config({ path: resolve(process.cwd(), '.env.local') })

import { readSiteUrlFromEnv, SITE_URL } from '../lib/site'

interface TelegramWebhookResponse {
  ok: boolean
  description?: string
  result?: unknown
}

function arg(name: string): string | undefined {
  return process.argv.find((item) => item.startsWith(`--${name}=`))?.split('=').slice(1).join('=')
}

async function main(): Promise<void> {
  const botToken = process.env.TELEGRAM_BOT_TOKEN
  const secretToken = process.env.TELEGRAM_FEEDBACK_SECRET_TOKEN ?? process.env.CRON_SECRET
  const siteUrl = readSiteUrlFromEnv(arg('site-url') ?? process.env.NEXT_PUBLIC_SITE_URL) || SITE_URL
  const webhookUrl = `${siteUrl}/api/tg-feedback`

  if (!botToken) throw new Error('TELEGRAM_BOT_TOKEN missing')
  if (!secretToken) throw new Error('TELEGRAM_FEEDBACK_SECRET_TOKEN or CRON_SECRET missing')

  const res = await fetch(`https://api.telegram.org/bot${botToken}/setWebhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      url: webhookUrl,
      secret_token: secretToken,
      allowed_updates: ['callback_query'],
      drop_pending_updates: false,
    }),
  })
  const data = await res.json().catch(() => null) as TelegramWebhookResponse | null
  if (!res.ok || !data?.ok) {
    throw new Error(`setWebhook failed: ${res.status} ${data?.description ?? ''}`.trim())
  }
  console.log(`[tg-feedback-webhook] set to ${webhookUrl}`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  })
}
