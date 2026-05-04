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
 * Структурный «contract test»: каждый `return { status: ... }` внутри
 * `runClaimedDigest()` (post-claim ядро) должен быть подкреплён записью в
 * digest_runs (через finalizeDigest*, writeUnclaimedDigestRun, либо
 * обёрнутый send-flow с markArticlesSent + finalizeDigestSuccess).
 *
 * Эволюция:
 *  - До 2026-05-02: ядро в `bot/daily-digest.ts`, выходы через
 *    `process.exit(...)` внутри `main()`.
 *  - С 2026-05-02: вынесено в `bot/daily-digest-core.ts`,
 *    `runDailyDigest()` возвращает `DigestResult`.
 *  - С 2026-05-04: post-claim логика вынесена в `runClaimedDigest()`,
 *    `runDailyDigest()` оборачивает её в safety-net try/catch для
 *    предотвращения stuck-running при unhandled throw (incident
 *    2026-05-03 — CHECK violation на новый статус оставил slot в running
 *    навсегда).
 */
test('runClaimedDigest() пишет digest_runs перед каждым return', () => {
  const src = readFileSync(resolve(__dirname, '..', '..', 'bot', 'daily-digest-core.ts'), 'utf8')
  const fnStart = src.indexOf('async function runClaimedDigest(')
  assert.ok(fnStart > 0, 'runClaimedDigest() not found')
  const fnEnd = src.indexOf('\n}\n', fnStart)
  assert.ok(fnEnd > fnStart, 'end of runClaimedDigest() not found')
  const fnBody = src.slice(fnStart, fnEnd)

  // Все терминальные выходы внутри runClaimedDigest — return { status: ... }.
  const returns = [...fnBody.matchAll(/return\s*\{\s*status:/g)]
  assert.ok(returns.length >= 5, `expected at least 5 returns in runClaimedDigest(), got ${returns.length}`)

  for (const m of returns) {
    const upTo = fnBody.slice(0, m.index ?? 0)
    const lastFinalize = Math.max(
      upTo.lastIndexOf('finalizeDigestSuccess'),
      upTo.lastIndexOf('finalizeDigestFailure'),
      upTo.lastIndexOf('finalizeDigestNonDelivery'),
      upTo.lastIndexOf('writeUnclaimedDigestRun'),
      upTo.lastIndexOf('deliverClaimedDigest'),
    )
    assert.ok(
      lastFinalize > 0 && (m.index! - lastFinalize) < 1500,
      `return at offset ${m.index} not preceded (within 1500 chars) by digest_runs write helper`,
    )
  }
})

test('runClaimedDigest() использует новые точные коды статусов (не legacy generic skipped/failed)', () => {
  const src = readFileSync(resolve(__dirname, '..', '..', 'bot', 'daily-digest-core.ts'), 'utf8')
  const fnStart = src.indexOf('async function runClaimedDigest(')
  const fnEnd = src.indexOf('\n}\n', fnStart)
  const fnBody = src.slice(fnStart, fnEnd)

  for (const code of [
    'skipped_already_claimed',
    'skipped_no_articles',
    'failed_pipeline_stalled',
  ]) {
    assert.ok(fnBody.includes(code), `runClaimedDigest() must use status code '${code}'`)
  }
})

test('runDailyDigest() оборачивает runClaimedDigest в safety-net try/catch с finalizeDigestFailure', () => {
  const src = readFileSync(resolve(__dirname, '..', '..', 'bot', 'daily-digest-core.ts'), 'utf8')
  const fnStart = src.indexOf('export async function runDailyDigest()')
  const fnEnd = src.indexOf('\n}\n', fnStart)
  const fnBody = src.slice(fnStart, fnEnd)

  // safety net должен быть строго после claim — иначе он не покрывает
  // неудачи tg_sent fallback / pipeline-stalled detection / Telegram send.
  const claimIdx = fnBody.indexOf('claimDigestSlot(')
  const tryIdx = fnBody.indexOf('try {', claimIdx)
  const innerCallIdx = fnBody.indexOf('runClaimedDigest(', claimIdx)
  const catchIdx = fnBody.indexOf('catch (err)', innerCallIdx)
  const finalizeIdx = fnBody.indexOf('finalizeDigestFailure(', catchIdx)

  assert.ok(tryIdx > claimIdx, 'safety-net try { not found after claimDigestSlot')
  assert.ok(innerCallIdx > tryIdx, 'runClaimedDigest call not found inside try')
  assert.ok(catchIdx > innerCallIdx, 'catch (err) not found after runClaimedDigest call')
  assert.ok(finalizeIdx > catchIdx && finalizeIdx - catchIdx < 500,
    'safety-net catch must call finalizeDigestFailure within ~500 chars to prevent stuck-running')
})
