import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const root = process.cwd()

function read(path: string): string {
  return readFileSync(join(root, path), 'utf8')
}

test('public legal pages do not expose a visible revoke-consent control', () => {
  const files = [
    'app/consent/page.tsx',
    'app/cookie-policy/page.tsx',
    'app/privacy-policy/page.tsx',
    'src/components/Footer.tsx',
  ]
  const combined = files.map(read).join('\n')

  assert.match(read('app/consent/page.tsx'), /Согласие на обработку персональных данных/)
  assert.ok(!existsSync(join(root, 'src/components/RevokeConsentButton.tsx')))
  assert.doesNotMatch(combined, /Отозвать согласие/)
  assert.doesNotMatch(combined, /Отзыв согласия/)
  assert.doesNotMatch(combined, /RevokeConsentButton/)
})
