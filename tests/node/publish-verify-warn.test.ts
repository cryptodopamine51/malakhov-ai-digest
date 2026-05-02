import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * publish-verify wave 2.2 contract:
 *  - 1st failed verify fires `publish_verify_failed_warn` (warning).
 *  - exhausted (3rd) failure fires `publish_verify_failed` (critical).
 *  - successful verify resolves both alerts so they don't linger.
 *
 * Tested via source inspection because publishVerify() is a long-running
 * orchestrator that's awkward to mock end-to-end. The alert-cleanup test
 * already enforces that `publish_verify_failed_warn` is wired into
 * COOLDOWN_HOURS; this test pins down the wiring in publish-verify.ts.
 */

const repoRoot = resolve(__dirname, '..', '..')
const verifyFile = resolve(repoRoot, 'pipeline', 'publish-verify.ts')

function source(): string {
  return readFileSync(verifyFile, 'utf8')
}

test('publish-verify wires publish_verify_failed_warn at warning severity', () => {
  const src = source()
  const warnMatch = src.match(/alertType:\s*'publish_verify_failed_warn'[\s\S]{0,200}severity:\s*'(\w+)'/)
  assert.ok(warnMatch, 'expected fireAlert("publish_verify_failed_warn") to exist in publish-verify.ts')
  assert.equal(warnMatch![1], 'warning')
})

test('publish-verify exhausted alert is critical', () => {
  const src = source()
  // Find the non-warn variant. Two fireAlert blocks reference publish_verify_failed:
  //   - regression branch (live_sample) — already critical
  //   - exhausted branch (new candidate) — must be critical too
  const matches = [...src.matchAll(/alertType:\s*'publish_verify_failed'[\s\S]{0,200}severity:\s*'(\w+)'/g)]
  assert.ok(matches.length >= 2, `expected at least 2 publish_verify_failed alert blocks, got ${matches.length}`)
  for (const m of matches) {
    assert.equal(m[1], 'critical', `publish_verify_failed alert must be critical, found ${m[1]}`)
  }
})

test('publish-verify success path resolves both critical and warn alerts', () => {
  const src = source()
  // Both resolveAlert lines should appear in the success branch.
  assert.match(src, /resolveAlert\(supabase,\s*'publish_verify_failed_warn'/)
  assert.match(src, /resolveAlert\(supabase,\s*'publish_verify_failed'[^_]/)
})
