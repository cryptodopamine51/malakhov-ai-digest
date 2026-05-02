import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { resolve } from 'node:path'

/**
 * Lint-test: every key declared in pipeline/alerts.ts:COOLDOWN_HOURS must have
 * a corresponding fireAlert(...) call somewhere in the codebase. Otherwise the
 * declaration becomes a phantom hint to an operator who is looking for a real
 * alert that never fires.
 *
 * See docs/spec_observability_publication_2026-05-01.md § 9.
 */

const repoRoot = resolve(__dirname, '..', '..')
const alertsFile = resolve(repoRoot, 'pipeline', 'alerts.ts')

function extractCooldownKeys(): string[] {
  const source = readFileSync(alertsFile, 'utf8')
  const blockMatch = source.match(/COOLDOWN_HOURS:\s*Record<string, number>\s*=\s*\{([\s\S]*?)\}/)
  assert.ok(blockMatch, 'Could not locate COOLDOWN_HOURS block in pipeline/alerts.ts')
  const body = blockMatch![1]
  const keyRegex = /^\s*([a-z_][a-z0-9_]*)\s*:\s*\d+/gim
  const keys: string[] = []
  let m: RegExpExecArray | null
  while ((m = keyRegex.exec(body)) !== null) keys.push(m[1])
  assert.ok(keys.length > 0, 'COOLDOWN_HOURS appears empty')
  return keys
}

function ripgrep(pattern: string): string {
  try {
    return execSync(
      `grep -rln --include='*.ts' --include='*.tsx' "${pattern}" pipeline bot lib app scripts 2>/dev/null || true`,
      { cwd: repoRoot, encoding: 'utf8' },
    )
  } catch {
    return ''
  }
}

test('every COOLDOWN_HOURS key has a corresponding fireAlert call', () => {
  const keys = extractCooldownKeys()
  const missing: string[] = []
  for (const key of keys) {
    // accept either fireAlert(...alertType: 'KEY'...) form or shorthand object literal
    const hits =
      ripgrep(`alertType: '${key}'`) +
      ripgrep(`alertType: \\"${key}\\"`)
    if (!hits.trim()) missing.push(key)
  }
  assert.deepEqual(missing, [], `COOLDOWN_HOURS keys without fireAlert: ${missing.join(', ')}`)
})

test('COOLDOWN_HOURS contains all alerts introduced by spec 2026-05-01', () => {
  const keys = new Set(extractCooldownKeys())
  // Existing alerts introduced before this initiative
  const existing = [
    'source_down',
    'backlog_high',
    'provider_invalid_request',
    'provider_rate_limit',
    'enrich_failed_spike',
    'batch_submit_failed',
    'batch_collect_failed',
    'batch_poll_stuck',
    'batch_apply_stuck',
    'claude_daily_budget_exceeded',
    'publish_verify_failed',
    'digest_low_articles',
  ]
  for (const k of existing) {
    assert.ok(keys.has(k), `expected existing key ${k} in COOLDOWN_HOURS`)
  }
})
