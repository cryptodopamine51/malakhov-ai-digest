import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const repoRoot = resolve(__dirname, '..', '..')
const routeSource = readFileSync(resolve(repoRoot, 'app/internal/articles/[slug]/route.ts'), 'utf8')

test('internal article verify route is protected and accepts pre-live publish statuses', () => {
  assert.match(routeSource, /PUBLISH_VERIFY_SECRET/)
  assert.match(routeSource, /x-publish-verify-secret/)
  assert.match(routeSource, /publish_ready/)
  assert.match(routeSource, /verifying/)
  assert.match(routeSource, /live/)
})
