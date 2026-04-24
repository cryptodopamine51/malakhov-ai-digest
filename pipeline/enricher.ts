/**
 * pipeline/enricher.ts
 *
 * Compatibility wrapper. The main happy path is now Anthropic Batch submit.
 *
 * Запуск: npm run enrich
 */

import { runEnrichSubmitBatch } from './enrich-submit-batch'

runEnrichSubmitBatch().catch((error: unknown) => {
  const msg = error instanceof Error ? error.message : String(error)
  console.error(`[${new Date().toTimeString().slice(0, 8)}] КРИТИЧЕСКАЯ ОШИБКА: ${msg}`)
  process.exit(1)
})
