const MSK_OFFSET_MS = 3 * 60 * 60 * 1000

export const TG_CHANNEL_SLOT_TIMES_MSK_MINUTES = [
  9 * 60 + 30,
  12 * 60 + 30,
  15 * 60 + 30,
  18 * 60 + 30,
  21 * 60,
] as const

export const TG_CHANNEL_BACKUP_CRON_BY_SLOT = {
  1: '35 6 * * *',
  2: '35 9 * * *',
  3: '35 12 * * *',
  4: '35 15 * * *',
  5: '5 18 * * *',
} as const

type ChannelPostSlot = 1 | 2 | 3 | 4 | 5

export type ChannelPostBackupSlotSource = 'explicit' | 'github_schedule' | 'clock'

export interface ChannelPostBackupSlotInput {
  explicitSlot?: string | number | null
  eventSchedule?: string | null
  now?: Date
}

export interface ChannelPostBackupSlotResolution {
  slot: ChannelPostSlot
  source: ChannelPostBackupSlotSource
}

const BACKUP_SLOT_BY_CRON = new Map<string, ChannelPostSlot>(
  Object.entries(TG_CHANNEL_BACKUP_CRON_BY_SLOT).map(([slot, schedule]) => [
    schedule,
    Number(slot) as ChannelPostSlot,
  ]),
)

export function parseChannelPostSlot(raw: string | number | null | undefined): ChannelPostSlot | null {
  if (raw === null || raw === undefined || raw === '') return null
  const slot = typeof raw === 'number' ? raw : Number(raw)
  return Number.isInteger(slot) && slot >= 1 && slot <= 5 ? slot as ChannelPostSlot : null
}

function hasExplicitSlot(raw: string | number | null | undefined): boolean {
  return raw !== null && raw !== undefined && String(raw).trim() !== ''
}

export function latestChannelPostSlotForMoscowTime(now = new Date()): ChannelPostSlot | null {
  const msk = new Date(now.getTime() + MSK_OFFSET_MS)
  const minutesOfDay = msk.getUTCHours() * 60 + msk.getUTCMinutes()
  const dueSlots = TG_CHANNEL_SLOT_TIMES_MSK_MINUTES.filter((slotTime) => slotTime <= minutesOfDay).length
  return dueSlots >= 1 && dueSlots <= 5 ? dueSlots as ChannelPostSlot : null
}

export function resolveChannelPostBackupSlot(
  input: ChannelPostBackupSlotInput = {},
): ChannelPostBackupSlotResolution {
  if (hasExplicitSlot(input.explicitSlot)) {
    const slot = parseChannelPostSlot(input.explicitSlot)
    if (!slot) throw new Error('TG channel backup slot must be 1..5')
    return { slot, source: 'explicit' }
  }

  const schedule = input.eventSchedule?.trim()
  if (schedule) {
    const slot = BACKUP_SLOT_BY_CRON.get(schedule)
    if (!slot) throw new Error(`Unsupported tg-channel-post backup schedule: ${schedule}`)
    return { slot, source: 'github_schedule' }
  }

  const slot = latestChannelPostSlotForMoscowTime(input.now)
  if (!slot) throw new Error('No Telegram channel slot is due yet; pass --slot=1..5')
  return { slot, source: 'clock' }
}
