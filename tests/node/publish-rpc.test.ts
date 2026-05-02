import test from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

/**
 * Wave 4.1 — publish_ready/verifying -> live goes through RPC publish_article.
 * These tests pin the contract without touching production data. A separate
 * smoke can call publish_article with a non-existent UUID and expect not_eligible.
 */

const repoRoot = resolve(__dirname, '..', '..')
const migrationFile = resolve(repoRoot, 'supabase', 'migrations', '014_observability_publication.sql')
const verifyFile = resolve(repoRoot, 'pipeline', 'publish-verify.ts')

function source(path: string): string {
  return readFileSync(path, 'utf8')
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.next') continue
    const full = join(dir, entry)
    const stat = statSync(full)
    if (stat.isDirectory()) {
      walk(full, out)
    } else if (/\.(ts|tsx)$/.test(entry)) {
      out.push(full)
    }
  }
  return out
}

test('migration 014 defines publish_article RPC result branches used by W4.1', () => {
  const sql = source(migrationFile)

  assert.match(sql, /create or replace function public\.publish_article\(/i)
  assert.match(sql, /grant execute on function public\.publish_article\(uuid,\s*text\) to service_role/i)
  assert.match(sql, /if v_quality_ok is not true then\s+return 'rejected_quality';\s+end if;/i)
  assert.match(sql, /if v_publish_status = 'live' then\s+return 'already_live';\s+end if;/i)
  assert.match(sql, /set publish_status = 'live'[\s\S]*last_publish_verifier = p_verifier/i)
  assert.match(sql, /return 'published_live';/i)
  assert.match(sql, /return 'not_eligible';/i)
})

test('publish-verify uses RPC publish_article on the normal publish path', () => {
  const src = source(verifyFile)

  assert.match(src, /\.rpc\('publish_article',\s*\{\s*p_article_id:\s*article\.id,\s*p_verifier:\s*PUBLISH_VERIFIER,\s*\}\)/)
  assert.match(src, /transitionResult === 'published_live' \|\| transitionResult === 'already_live'/)
  assert.match(src, /publish_transition_result: transitionResult/)
})

test('publish-verify has explicit emergency bypass with warning alert', () => {
  const src = source(verifyFile)

  assert.match(src, /process\.env\.PUBLISH_RPC_DISABLED === '1'/)
  assert.match(src, /alertType:\s*'publish_rpc_bypass_active'[\s\S]{0,160}severity:\s*'warning'/)
  assert.match(src, /if \(isPublishRpcBypassActive\(\)\) \{[\s\S]*publish_status:\s*'live'[\s\S]*return 'published_live'/)
})

test('publish-verify records failed RPC outcomes as verify attempts', () => {
  const src = source(verifyFile)

  assert.match(src, /'publish_rpc_error'/)
  assert.match(src, /`publish_rpc_\$\{transitionResult\}`/)
  assert.match(src, /resultStatus:\s*'failed'|,\s*'failed',/)
})

test('no direct publish_status live update exists outside publish-verify', () => {
  const roots = ['app', 'bot', 'lib', 'pipeline', 'scripts', 'src']
  const offenders: string[] = []
  const directLiveWrite = /\.update\(\s*\{[\s\S]{0,600}?publish_status\s*:\s*['"]live['"]/m

  for (const root of roots) {
    for (const file of walk(resolve(repoRoot, root))) {
      if (relative(repoRoot, file) === 'pipeline/publish-verify.ts') continue
      const src = source(file)
      if (directLiveWrite.test(src)) offenders.push(relative(repoRoot, file))
    }
  }

  assert.deepEqual(offenders, [])
})
