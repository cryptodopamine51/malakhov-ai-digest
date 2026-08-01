import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { recoverSupabaseFetchCache } from '../../scripts/recover-supabase-cache'

const legacyUrl = 'https://oziddrpkwzsdtsibauon.supabase.co/rest/v1/articles?select=*'
const longBody = 'x'.repeat(1200)

function article(overrides: Record<string, unknown> = {}) {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    slug: 'first-article',
    original_url: 'https://example.test/first',
    published: true,
    quality_ok: true,
    publish_status: 'live',
    editorial_body: longBody,
    updated_at: '2026-06-01T00:00:00.000Z',
    ...overrides,
  }
}

function fetchRecord(rows: unknown, url = legacyUrl, date = 'Mon, 01 Jun 2026 00:00:00 GMT') {
  return {
    kind: 'FETCH',
    data: {
      url,
      headers: { date, 'set-cookie': 'must-not-leak', authorization: 'must-not-leak' },
      body: Buffer.from(JSON.stringify(rows)).toString('base64'),
    },
  }
}

async function fixture(records: unknown[]): Promise<{ directory: string; output: string }> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'recover-supabase-cache-'))
  await Promise.all(records.map((record, index) => fs.writeFile(path.join(directory, `${index}.json`), JSON.stringify(record))))
  return { directory, output: path.join(directory, 'export') }
}

test('recovers valid arrays, preserves unknown fields, and excludes transport secrets', async (t) => {
  const temp = await fixture([fetchRecord([article({ unknown_future_field: { retained: true } })])])
  t.after(() => fs.rm(temp.directory, { recursive: true, force: true }))
  const result = await recoverSupabaseFetchCache({ input: temp.directory, output: temp.output })
  assert.equal(result.articles.length, 1)
  assert.deepEqual(result.articles[0].unknown_future_field, { retained: true })
  const exported = await fs.readFile(path.join(temp.output, 'articles.jsonl'), 'utf8')
  assert.equal(exported.includes('must-not-leak'), false)
  assert.equal((await fs.readFile(path.join(temp.output, 'manifest.json'), 'utf8')).includes('set-cookie'), false)
})

test('rejects invalid JSON and invalid base64 bodies', async (t) => {
  const temp = await fixture([{ kind: 'FETCH', data: { url: legacyUrl, body: 'not base64!' } }, fetchRecord([])])
  await fs.writeFile(path.join(temp.directory, 'invalid.json'), '{not json')
  t.after(() => fs.rm(temp.directory, { recursive: true, force: true }))
  const result = await recoverSupabaseFetchCache({ input: temp.directory, dryRun: true })
  assert.ok(result.rejected.some((entry) => entry.reason === 'invalid_outer_json'))
  assert.ok(result.rejected.some((entry) => entry.reason === 'invalid_base64_body'))
})

test('rejects FETCH records outside the legacy articles allowlist', async (t) => {
  const temp = await fixture([fetchRecord([article()], 'https://attacker.example/rest/v1/articles'), fetchRecord([article()], 'https://oziddrpkwzsdtsibauon.supabase.co/rest/v1/categories')])
  t.after(() => fs.rm(temp.directory, { recursive: true, force: true }))
  const result = await recoverSupabaseFetchCache({ input: temp.directory, dryRun: true })
  assert.equal(result.articles.length, 0)
  assert.equal(result.rejected.filter((entry) => entry.reason === 'outside_articles_whitelist').length, 2)
})

test('chooses newest updated_at then response date for duplicate ids', async (t) => {
  const older = article({ editorial_body: `${longBody} old`, updated_at: '2026-06-01T00:00:00.000Z' })
  const newer = article({ editorial_body: `${longBody} new`, updated_at: '2026-06-02T00:00:00.000Z' })
  const sameUpdateLaterResponse = article({ editorial_body: `${longBody} latest response`, updated_at: '2026-06-02T00:00:00.000Z' })
  const temp = await fixture([
    fetchRecord([older], legacyUrl, 'Mon, 01 Jun 2026 00:00:00 GMT'),
    fetchRecord([newer], legacyUrl, 'Tue, 02 Jun 2026 00:00:00 GMT'),
    fetchRecord([sameUpdateLaterResponse], legacyUrl, 'Wed, 03 Jun 2026 00:00:00 GMT'),
  ])
  t.after(() => fs.rm(temp.directory, { recursive: true, force: true }))
  const result = await recoverSupabaseFetchCache({ input: temp.directory, dryRun: true })
  assert.equal(result.articles.length, 1)
  assert.equal(result.articles[0].editorial_body, `${longBody} latest response`)
  assert.equal(result.duplicateIdsResolved, 2)
})

test('sorts deterministically and reports the JSONL checksum', async (t) => {
  const temp = await fixture([fetchRecord([article({ id: 'b', slug: 'b', original_url: 'https://example.test/b' }), article({ id: 'a', slug: 'a', original_url: 'https://example.test/a' })])])
  t.after(() => fs.rm(temp.directory, { recursive: true, force: true }))
  const first = await recoverSupabaseFetchCache({ input: temp.directory, dryRun: true })
  const second = await recoverSupabaseFetchCache({ input: temp.directory, dryRun: true })
  assert.deepEqual(first.articles.map((row) => row.id), ['a', 'b'])
  assert.equal(first.checksum, second.checksum)
  const expected = createHash('sha256').update(first.articles.map((row) => JSON.stringify(row)).join('\n') + '\n').digest('hex')
  assert.equal(first.checksum, expected)
})
