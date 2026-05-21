import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import { getAllGuides } from '../../lib/guides'

const META_DIR = join(process.cwd(), 'content', 'guides', 'meta')

test('every guide meta JSON file declares verifiedAt as a valid ISO-like date string', () => {
  const files = readdirSync(META_DIR).filter((file) => file.endsWith('.json'))
  assert.ok(files.length > 0, 'expected at least one guide meta file')

  for (const file of files) {
    const raw = readFileSync(join(META_DIR, file), 'utf8')
    const parsed = JSON.parse(raw) as { verifiedAt?: unknown }
    assert.equal(typeof parsed.verifiedAt, 'string', `${file}: verifiedAt must be a string`)
    const value = parsed.verifiedAt as string
    assert.ok(value.length > 0, `${file}: verifiedAt must not be empty`)
    const parsedDate = new Date(value)
    assert.ok(!Number.isNaN(parsedDate.getTime()), `${file}: verifiedAt must parse as a valid date`)
  }
})

test('getAllGuides exposes verifiedAt on every loaded guide (includeNoindex covers drafts)', () => {
  const guides = getAllGuides({ includeNoindex: true })
  assert.ok(guides.length > 0, 'expected at least one guide')
  for (const guide of guides) {
    assert.equal(typeof guide.verifiedAt, 'string', `${guide.slug}: verifiedAt must be a string`)
    assert.ok(guide.verifiedAt.length > 0, `${guide.slug}: verifiedAt must not be empty`)
  }
})
