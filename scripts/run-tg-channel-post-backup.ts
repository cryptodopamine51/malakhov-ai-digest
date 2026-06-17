import { config } from 'dotenv'
import { resolve } from 'path'
import { pathToFileURL } from 'url'

config({ path: resolve(process.cwd(), '.env.local') })
config({ path: resolve(process.cwd(), '.env') })

import { runChannelPost } from '../bot/channel-post-core'
import { resolveChannelPostBackupSlot } from '../lib/tg-channel-schedule'

function arg(name: string): string | undefined {
  return process.argv.find((item) => item.startsWith(`--${name}=`))?.split('=').slice(1).join('=')
}

async function main(): Promise<void> {
  const resolution = resolveChannelPostBackupSlot({
    explicitSlot: arg('slot') ?? process.env.TG_CHANNEL_POST_SLOT,
    eventSchedule: process.env.GITHUB_EVENT_SCHEDULE,
  })

  console.log(`[tg-channel-post-backup] slot=${resolution.slot} source=${resolution.source}`)
  const result = await runChannelPost(resolution.slot)
  console.log(`[tg-channel-post-backup] result=${result.status}`)

  const exitCode = result.status === 'failed' || result.status === 'preflight_failed' ? 1 : 0
  process.exit(exitCode)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error('[tg-channel-post-backup] unhandled error:', err)
    process.exit(1)
  })
}
