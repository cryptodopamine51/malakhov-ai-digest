/**
 * bot/daily-digest.ts
 *
 * CLI-обёртка над `bot/daily-digest-core.ts`. Подгружает .env.local,
 * вызывает `runDailyDigest()`, маппит результат в exit-код.
 *
 * Запуск: npm run tg-digest
 * Принудительный: FORCE_DIGEST=1 FORCE_DIGEST_CONFIRM_DATE=YYYY-MM-DD npm run tg-digest
 *
 * Серверлесс-точка входа — `app/api/cron/tg-digest/route.ts`, она дёргает
 * `runDailyDigest()` из core напрямую без dotenv.
 */

import { config } from 'dotenv'
import { resolve } from 'path'
import { pathToFileURL } from 'url'
config({ path: resolve(process.cwd(), '.env.local') })

import { runDailyDigest } from './daily-digest-core'

// Re-export всех публичных функций для обратной совместимости с тестами и
// существующим кодом, импортирующим из 'bot/daily-digest'.
export {
  assertServiceRoleKey,
  claimDigestSlot,
  finalizeDigestSuccess,
  finalizeDigestFailure,
  finalizeDigestNonDelivery,
  writeUnclaimedDigestRun,
  markArticlesSent,
  deliverClaimedDigest,
  runDailyDigest,
} from './daily-digest-core'
export type { DigestRunStatus, DigestResult } from './daily-digest-core'

async function main(): Promise<void> {
  try {
    const result = await runDailyDigest()
    console.log(`[tg-digest] result: ${result.status}`)
    const exitCode =
      result.status === 'preflight_failed' || result.status === 'failed' ? 1 : 0
    process.exit(exitCode)
  } catch (err) {
    console.error('[tg-digest] unhandled error:', err)
    process.exit(1)
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
}
