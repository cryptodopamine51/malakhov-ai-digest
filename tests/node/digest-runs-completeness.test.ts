import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import {
  finalizeDigestFailure,
  finalizeDigestNonDelivery,
  writeUnclaimedDigestRun,
} from '../../bot/daily-digest'

/**
 * Wave 2.4 — `digest_runs` пишется на каждой ветке main().
 * См. docs/spec_observability_publication_2026-05-01.md § 6 и
 * docs/ORCHESTRATOR_observability_publication_2026-05-01.md (W2.4).
 *
 * Особенность: миграция 015 РАСШИРЯЕТ `digest_runs_status_check_v2`
 * существующего enum'а (миграция 009: running/success/skipped/low_articles/error/failed),
 * добавляя skipped_already_claimed / skipped_no_articles / skipped_outside_window /
 * failed_send / failed_pipeline_stalled. Старые row не падают.
 */

interface RecordedOp {
  table: string
  kind: 'insert' | 'update'
  payload: Record<string, unknown>
  filters: Array<[string, unknown]>
}

function createSupabaseMock(updateError: { message: string } | null = null): {
  client: { from: (name: string) => unknown }
  ops: RecordedOp[]
} {
  const ops: RecordedOp[] = []
  return {
    ops,
    client: {
      from(table: string) {
        const local: Record<string, unknown> = {}
        const state: { current: RecordedOp | null } = { current: null }
        local.insert = (payload: Record<string, unknown>) => {
          state.current = { table, kind: 'insert', payload, filters: [] }
          ops.push(state.current)
          return Promise.resolve({ error: null })
        }
        local.update = (payload: Record<string, unknown>) => {
          state.current = { table, kind: 'update', payload, filters: [] }
          ops.push(state.current)
          return local
        }
        local.eq = (col: string, val: unknown) => {
          state.current?.filters.push([col, val])
          return Promise.resolve({ error: updateError })
        }
        return local
      },
    },
  }
}

test('writeUnclaimedDigestRun вставляет skipped_already_claimed в digest_runs', async () => {
  const { client, ops } = createSupabaseMock()
  await writeUnclaimedDigestRun(client as never, '2026-05-02', '@channel', 'skipped_already_claimed', {
    site_url: 'https://x.test',
    error_message: 'slot already claimed',
  })
  assert.equal(ops.length, 1)
  assert.equal(ops[0]!.kind, 'insert')
  assert.equal(ops[0]!.table, 'digest_runs')
  const p = ops[0]!.payload
  assert.equal(p.status, 'skipped_already_claimed')
  assert.equal(p.digest_date, '2026-05-02')
  assert.equal(p.channel_id, '@channel')
})

test('writeUnclaimedDigestRun пробрасывает ошибку insert наружу', async () => {
  const client = {
    from(_table: string) {
      const local: Record<string, unknown> = {
        insert: () => Promise.resolve({ error: { message: 'permission denied' } }),
      }
      return local
    },
  }
  await assert.rejects(
    () => writeUnclaimedDigestRun(client as never, '2026-05-02', '@channel', 'skipped_already_claimed'),
    /skipped_already_claimed insert failed: permission denied/,
  )
})

test('finalizeDigestNonDelivery принимает skipped_no_articles', async () => {
  const { client, ops } = createSupabaseMock()
  await finalizeDigestNonDelivery(client as never, 'run-x', 'skipped_no_articles', {
    articles_count: 0,
    error_message: 'no_articles_in_window',
  })
  assert.equal(ops.length, 1)
  assert.equal(ops[0]!.kind, 'update')
  assert.equal(ops[0]!.payload.status, 'skipped_no_articles')
  assert.equal(ops[0]!.payload.error_message, 'no_articles_in_window')
})

test('finalizeDigestNonDelivery принимает failed_pipeline_stalled', async () => {
  const { client, ops } = createSupabaseMock()
  await finalizeDigestNonDelivery(client as never, 'run-y', 'failed_pipeline_stalled', {
    articles_count: 0,
    error_message: 'pipeline_stalled: 12 processing>6h',
  })
  assert.equal(ops[0]!.payload.status, 'failed_pipeline_stalled')
})

test('finalizeDigestFailure по умолчанию пишет failed_send', async () => {
  const { client, ops } = createSupabaseMock()
  await finalizeDigestFailure(client as never, 'run-z', new Error('telegram boom'))
  assert.equal(ops[0]!.payload.status, 'failed_send')
  assert.match(String(ops[0]!.payload.error_message), /telegram boom/)
})

test('finalizeDigestFailure поддерживает явный failed_pipeline_stalled', async () => {
  const { client, ops } = createSupabaseMock()
  await finalizeDigestFailure(client as never, 'run-w', new Error('stalled'), 'failed_pipeline_stalled')
  assert.equal(ops[0]!.payload.status, 'failed_pipeline_stalled')
})

/**
 * Структурный «contract test»: каждый post-claim `return { status: ... }` в
 * `runDailyDigest()` должен быть подкреплён записью в digest_runs (через
 * finalizeDigest*, writeUnclaimedDigestRun, либо обёрнутый send-flow с
 * markArticlesSent + finalizeDigestSuccess). Pre-claim env-проверки
 * (TELEGRAM_BOT_TOKEN, NEXT_PUBLIC_SITE_URL и т.д.) — config-ошибки до
 * любого DB-touch — намеренно исключены.
 *
 * До 2026-05-02 ядро жило в `bot/daily-digest.ts` и использовало
 * `process.exit(...)`. После выноса в `bot/daily-digest-core.ts` и перевода
 * на возвращаемый `DigestResult` инвариант остался тем же — изменилась
 * только форма «выхода»: `return { status: ... }` вместо `process.exit`.
 */
test('runDailyDigest() пишет digest_runs перед каждым post-claim return', () => {
  const src = readFileSync(resolve(__dirname, '..', '..', 'bot', 'daily-digest-core.ts'), 'utf8')
  const fnStart = src.indexOf('export async function runDailyDigest()')
  assert.ok(fnStart > 0, 'runDailyDigest() not found')
  const fnEnd = src.indexOf('\n}\n', fnStart)
  assert.ok(fnEnd > fnStart, 'end of runDailyDigest() not found')
  const fnBody = src.slice(fnStart, fnEnd)

  // Где начинается часть с claim-ом — всё «до» это env preflights.
  const claimMarker = 'claimDigestSlot('
  const claimIdx = fnBody.indexOf(claimMarker)
  assert.ok(claimIdx > 0, `${claimMarker} not found in runDailyDigest()`)
  const postClaim = fnBody.slice(claimIdx)

  // success-ветка использует обернутый send + finalizeDigestSuccess внутри,
  // skipped/failed-ветки — finalize* / writeUnclaimedDigestRun. Все терминальные
  // выходы — это return { status: ... }.
  const returns = [...postClaim.matchAll(/return\s*\{\s*status:/g)]
  assert.ok(returns.length >= 5, `expected at least 5 post-claim returns, got ${returns.length}`)

  for (const m of returns) {
    const upTo = postClaim.slice(0, m.index ?? 0)
    const lastFinalize = Math.max(
      upTo.lastIndexOf('finalizeDigestSuccess'),
      upTo.lastIndexOf('finalizeDigestFailure'),
      upTo.lastIndexOf('finalizeDigestNonDelivery'),
      upTo.lastIndexOf('writeUnclaimedDigestRun'),
      upTo.lastIndexOf('deliverClaimedDigest'),
    )
    assert.ok(
      lastFinalize > 0 && (m.index! - lastFinalize) < 1500,
      `post-claim return at offset ${m.index} not preceded (within 1500 chars) by digest_runs write helper`,
    )
  }
})

test('runDailyDigest() использует новые точные коды статусов (не legacy generic skipped/failed)', () => {
  const src = readFileSync(resolve(__dirname, '..', '..', 'bot', 'daily-digest-core.ts'), 'utf8')
  const fnStart = src.indexOf('export async function runDailyDigest()')
  const fnEnd = src.indexOf('\n}\n', fnStart)
  const fnBody = src.slice(fnStart, fnEnd)

  for (const code of [
    'skipped_already_claimed',
    'skipped_no_articles',
    'failed_pipeline_stalled',
  ]) {
    assert.ok(fnBody.includes(code), `runDailyDigest() must use status code '${code}'`)
  }
})
