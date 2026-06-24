import assert from 'node:assert/strict'
import test from 'node:test'

import {
  decideWeeklyAlert,
  isStaleWeeklyAlertEntity,
  isWeeklyReportDue,
} from '../../pipeline/tg-weekly-monitor'

// Время задаём в UTC; МСК = UTC+3.
const mondayEarlyMsk = new Date('2026-06-22T08:00:00.000Z') // Mon 11:00 МСК — отчёт ещё «в полёте»
const mondayDueMsk = new Date('2026-06-22T10:30:00.000Z') // Mon 13:30 МСК — уже должен быть
const wednesdayMsk = new Date('2026-06-24T09:00:00.000Z') // Wed 12:00 МСК

test('isWeeklyReportDue: понедельник до 13:00 МСК — ещё не due', () => {
  assert.equal(isWeeklyReportDue(mondayEarlyMsk), false)
  assert.equal(isWeeklyReportDue(mondayDueMsk), true)
  assert.equal(isWeeklyReportDue(wednesdayMsk), true)
})

test('decideWeeklyAlert: noop до срока даже без строк', () => {
  const d = decideWeeklyAlert({ rows: [], schemaMissing: false }, mondayEarlyMsk)
  assert.deepEqual(d, { kind: 'noop', reason: 'too_early' })
})

test('decideWeeklyAlert: отсутствие схемы — fire no_schema', () => {
  const d = decideWeeklyAlert({ rows: null, schemaMissing: true }, wednesdayMsk)
  assert.equal(d.kind, 'fire')
  assert.equal(d.kind === 'fire' && d.reason, 'no_schema')
})

test('decideWeeklyAlert: нет строк после срока — fire no_rows', () => {
  const d = decideWeeklyAlert({ rows: [], schemaMissing: false }, wednesdayMsk)
  assert.equal(d.kind === 'fire' && d.reason, 'no_rows')
})

test('decideWeeklyAlert: строки есть, но не success — fire no_success', () => {
  const d = decideWeeklyAlert({ rows: [{ status: 'failed' }, { status: 'running' }], schemaMissing: false }, wednesdayMsk)
  assert.equal(d.kind === 'fire' && d.reason, 'no_success')
})

test('decideWeeklyAlert: есть success — resolve', () => {
  const d = decideWeeklyAlert({ rows: [{ status: 'failed' }, { status: 'success' }], schemaMissing: false }, wednesdayMsk)
  assert.deepEqual(d, { kind: 'resolve', successCount: 1 })
})

test('isStaleWeeklyAlertEntity: старые недели считаются устаревшими', () => {
  assert.equal(isStaleWeeklyAlertEntity('week:2026-06-08', '2026-06-15'), true)
  assert.equal(isStaleWeeklyAlertEntity('week:2026-06-15', '2026-06-15'), false)
  assert.equal(isStaleWeeklyAlertEntity('week:2026-06-22', '2026-06-15'), false)
  assert.equal(isStaleWeeklyAlertEntity(null, '2026-06-15'), false)
})
