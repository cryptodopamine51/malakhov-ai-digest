/**
 * CLI wrapper for Telegram channel slot posts.
 *
 * Usage:
 *   npm run tg-channel-post -- --slot=1
 */

import { config } from 'dotenv'
import { resolve } from 'path'
import { pathToFileURL } from 'url'

config({ path: resolve(process.cwd(), '.env.local') })

import { parseSlot, runChannelPost } from './channel-post-core'

export {
  applyGeneratedCaptionsToPlan,
  buildChannelPostPlan,
  buildTelegramCaption,
  buildTelegramCaptionFromDeepSeekJson,
  deliverPlannedChannelPost,
  hasStaleYearHallucination,
  parseSlot,
  runChannelPost,
  sendTelegramPhoto,
} from './channel-post-core'
export type {
  ChannelPostCandidate,
  ChannelPostPlanItem,
  ChannelPostResult,
  ChannelPostStatus,
  TelegramChannelPostRow,
} from './channel-post-core'

function arg(name: string): string | undefined {
  return process.argv.find((item) => item.startsWith(`--${name}=`))?.split('=').slice(1).join('=')
}

async function main(): Promise<void> {
  const slot = parseSlot(arg('slot') ?? process.env.TG_CHANNEL_POST_SLOT)
  if (!slot) {
    console.error('[tg-channel-post] --slot=1..5 is required')
    process.exit(1)
  }

  const result = await runChannelPost(slot)
  console.log(`[tg-channel-post] result: ${result.status}`)
  const exitCode = result.status === 'failed' || result.status === 'preflight_failed' ? 1 : 0
  process.exit(exitCode)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error('[tg-channel-post] unhandled error:', err)
    process.exit(1)
  })
}
