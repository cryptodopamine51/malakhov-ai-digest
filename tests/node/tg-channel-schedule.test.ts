import test from 'node:test'
import assert from 'node:assert/strict'

import {
  latestChannelPostSlotForMoscowTime,
  resolveChannelPostBackupSlot,
  TG_CHANNEL_BACKUP_CRON_BY_SLOT,
} from '../../lib/tg-channel-schedule'

function mskTime(hours: number, minutes = 0): Date {
  return new Date(Date.UTC(2026, 5, 16, hours - 3, minutes))
}

test('resolveChannelPostBackupSlot maps GitHub backup cron expressions to slots', () => {
  assert.deepEqual(
    resolveChannelPostBackupSlot({ eventSchedule: TG_CHANNEL_BACKUP_CRON_BY_SLOT[1] }),
    { slot: 1, source: 'github_schedule' },
  )
  assert.deepEqual(
    resolveChannelPostBackupSlot({ eventSchedule: TG_CHANNEL_BACKUP_CRON_BY_SLOT[5] }),
    { slot: 5, source: 'github_schedule' },
  )
})

test('resolveChannelPostBackupSlot prefers explicit slot over GitHub schedule', () => {
  assert.deepEqual(
    resolveChannelPostBackupSlot({
      explicitSlot: '3',
      eventSchedule: TG_CHANNEL_BACKUP_CRON_BY_SLOT[1],
    }),
    { slot: 3, source: 'explicit' },
  )
})

test('resolveChannelPostBackupSlot rejects unknown schedules and invalid explicit slots', () => {
  assert.throws(
    () => resolveChannelPostBackupSlot({ explicitSlot: '9' }),
    /slot must be 1\.\.5/,
  )
  assert.throws(
    () => resolveChannelPostBackupSlot({ eventSchedule: '0 0 * * *' }),
    /Unsupported tg-channel-post backup schedule/,
  )
})

test('latestChannelPostSlotForMoscowTime returns the latest passed Moscow slot', () => {
  assert.equal(latestChannelPostSlotForMoscowTime(mskTime(9, 29)), null)
  assert.equal(latestChannelPostSlotForMoscowTime(mskTime(9, 30)), 1)
  assert.equal(latestChannelPostSlotForMoscowTime(mskTime(15, 39)), 3)
  assert.equal(latestChannelPostSlotForMoscowTime(mskTime(21, 0)), 5)
})

test('resolveChannelPostBackupSlot falls back to clock only when a slot is due', () => {
  assert.deepEqual(
    resolveChannelPostBackupSlot({ now: mskTime(18, 45) }),
    { slot: 4, source: 'clock' },
  )
  assert.throws(
    () => resolveChannelPostBackupSlot({ now: mskTime(8, 0) }),
    /No Telegram channel slot is due yet/,
  )
})
