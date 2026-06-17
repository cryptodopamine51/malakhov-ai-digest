import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  decideTgChannelAlert,
  dueSlotCount,
  isStaleTgChannelAlertEntity,
  mskDateKey,
} from '../../pipeline/tg-channel-monitor'

// 2026-06-10, время задаётся по МСК (UTC+3).
function mskTime(hours: number, minutes = 0): Date {
  return new Date(Date.UTC(2026, 5, 10, hours - 3, minutes))
}

test('dueSlotCount: до первого слота с грейсом — ноль, к 13:01 МСК — два', () => {
  assert.equal(dueSlotCount(mskTime(9, 45)), 0) // 09:30 + 30m grace ещё не истёк
  assert.equal(dueSlotCount(mskTime(10, 1)), 1)
  assert.equal(dueSlotCount(mskTime(13, 1)), 2)
  assert.equal(dueSlotCount(mskTime(21, 31)), 5)
})

test('утром при пустом дне — noop (не шумим из-за одного слота)', () => {
  const decision = decideTgChannelAlert([], mskTime(11, 0))
  assert.equal(decision.kind, 'noop')
})

test('к 13:01 при полном отсутствии строк — critical no_rows', () => {
  const decision = decideTgChannelAlert([], mskTime(13, 1))
  assert.deepEqual(decision, { kind: 'fire', reason: 'no_rows', dueSlots: 2, successCount: 0 })
})

test('строки есть, но ни одной success — critical no_success', () => {
  const decision = decideTgChannelAlert(
    [{ status: 'planned' }, { status: 'failed_send' }],
    mskTime(16, 30),
  )
  assert.deepEqual(decision, { kind: 'fire', reason: 'no_success', dueSlots: 3, successCount: 0 })
})

test('есть success, но меньше due slots — critical partial_success', () => {
  const decision = decideTgChannelAlert(
    [{ status: 'success' }, { status: 'planned' }],
    mskTime(13, 1),
  )
  assert.deepEqual(decision, { kind: 'fire', reason: 'partial_success', dueSlots: 2, successCount: 1 })
})

test('success покрывает due slots — resolve', () => {
  const decision = decideTgChannelAlert(
    [{ status: 'success' }, { status: 'success' }, { status: 'planned' }],
    mskTime(13, 1),
  )
  assert.deepEqual(decision, { kind: 'resolve', successCount: 2 })
})

test('mskDateKey переводит вечер UTC в следующий день МСК', () => {
  assert.equal(mskDateKey(new Date('2026-06-10T22:30:00.000Z')), '2026-06-11')
})

test('устаревшими считаются только tg day entity keys старше текущего delivery date', () => {
  assert.equal(isStaleTgChannelAlertEntity('day:2026-06-16', '2026-06-17'), true)
  assert.equal(isStaleTgChannelAlertEntity('day:2026-06-17', '2026-06-17'), false)
  assert.equal(isStaleTgChannelAlertEntity('day:2026-06-18', '2026-06-17'), false)
  assert.equal(isStaleTgChannelAlertEntity('article:123', '2026-06-17'), false)
  assert.equal(isStaleTgChannelAlertEntity(null, '2026-06-17'), false)
})
