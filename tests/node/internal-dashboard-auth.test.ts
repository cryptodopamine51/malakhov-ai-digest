import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import {
  _internals,
  firstSearchParam,
  isInternalDashboardAuthorized,
} from '../../lib/internal-dashboard'

/**
 * Wave 4.2 — /internal/dashboard is a server-rendered operator page guarded
 * by HEALTH_TOKEN. Without a valid query token or x-health-token header, the
 * server page calls notFound(), so the public response is 404.
 */

const repoRoot = resolve(__dirname, '..', '..')
const dashboardPage = resolve(repoRoot, 'app', 'internal', 'dashboard', 'page.tsx')

test('dashboard auth rejects missing server token and missing request token', () => {
  assert.equal(isInternalDashboardAuthorized({ expectedToken: null, queryToken: 'x', headerToken: null }), false)
  assert.equal(isInternalDashboardAuthorized({ expectedToken: 'secret', queryToken: null, headerToken: null }), false)
  assert.equal(isInternalDashboardAuthorized({ expectedToken: 'secret', queryToken: 'wrong', headerToken: null }), false)
})

test('dashboard auth accepts HEALTH_TOKEN via query or x-health-token header', () => {
  assert.equal(isInternalDashboardAuthorized({ expectedToken: 'secret', queryToken: 'secret', headerToken: null }), true)
  assert.equal(isInternalDashboardAuthorized({ expectedToken: 'secret', queryToken: null, headerToken: 'secret' }), true)
})

test('firstSearchParam handles Next.js searchParams array shape', () => {
  assert.equal(firstSearchParam(undefined), null)
  assert.equal(firstSearchParam('one'), 'one')
  assert.equal(firstSearchParam(['one', 'two']), 'one')
})

test('dashboard page uses server-side 404 guard and header token', () => {
  const src = readFileSync(dashboardPage, 'utf8')
  assert.doesNotMatch(src, /['"]use client['"]/)
  assert.match(src, /headers\(\)/)
  assert.match(src, /requestHeaders\.get\('x-health-token'\)/)
  assert.match(src, /isInternalDashboardAuthorized\(/)
  assert.match(src, /notFound\(\)/)
})

test('dashboard page renders required operational sections and auto-refresh meta', () => {
  const src = readFileSync(dashboardPage, 'utf8')
  for (const id of [
    'health-cards',
    'alerts-table',
    'stuck-batches-table',
    'recent-live-table',
    'digest-runs-table',
  ]) {
    assert.match(src, new RegExp(`id="${id}"`))
  }
  assert.match(src, /httpEquiv="refresh"\s+content="60"/)
})

test('dashboard live lag is measured from publish_ready_at to verified/published time', () => {
  assert.equal(
    _internals.minutesBetween('2026-05-02T08:00:00.000Z', '2026-05-02T08:47:20.000Z'),
    47,
  )
  assert.equal(_internals.minutesBetween(null, '2026-05-02T08:47:20.000Z'), null)
})
