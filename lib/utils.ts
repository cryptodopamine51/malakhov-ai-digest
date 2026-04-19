import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

/**
 * Объединяет классы Tailwind с разрешением конфликтов.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}

/**
 * Форматирует дату публикации в относительный вид.
 *
 * < 1 минуты  → "только что"
 * < 1 часа    → "N минут назад"
 * < 24 часов  → "N часов назад"
 * < 48 часов  → "вчера"
 * < 7 дней    → "N дней назад"
 * иначе       → "12 янв" (день + сокращённый месяц)
 */
export function formatRelativeTime(date: string | Date): string {
  const now = Date.now()
  const then = new Date(date).getTime()
  const diffMs = now - then
  const diffMin = Math.floor(diffMs / 60_000)
  const diffHour = Math.floor(diffMs / 3_600_000)
  const diffDay = Math.floor(diffMs / 86_400_000)

  if (diffMin < 1) return 'только что'
  if (diffMin < 60) return `${diffMin} ${pluralize(diffMin, 'минуту', 'минуты', 'минут')} назад`
  if (diffHour < 24) return `${diffHour} ${pluralize(diffHour, 'час', 'часа', 'часов')} назад`
  if (diffDay === 1) return 'вчера'
  if (diffDay < 7) return `${diffDay} ${pluralize(diffDay, 'день', 'дня', 'дней')} назад`

  return new Date(date).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })
}

/**
 * Русское склонение числительного по трём формам.
 */
function pluralize(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod100 >= 11 && mod100 <= 19) return many
  if (mod10 === 1) return one
  if (mod10 >= 2 && mod10 <= 4) return few
  return many
}

/**
 * Обрезает строку до maxLength символов, добавляя «…».
 */
export function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text
  return text.slice(0, maxLength - 1) + '…'
}

const MOSCOW_TZ = 'Europe/Moscow'

export function getMoscowDateKey(date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: MOSCOW_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)

  const year = parts.find((part) => part.type === 'year')?.value
  const month = parts.find((part) => part.type === 'month')?.value
  const day = parts.find((part) => part.type === 'day')?.value

  return `${year}-${month}-${day}`
}

export function shiftMoscowDateKey(dateKey: string, days: number): string {
  const date = new Date(`${dateKey}T12:00:00+03:00`)
  date.setUTCDate(date.getUTCDate() + days)
  return getMoscowDateKey(date)
}

export function formatMoscowDate(
  dateKey: string,
  options: Intl.DateTimeFormatOptions,
  locale = 'ru-RU'
): string {
  return new Intl.DateTimeFormat(locale, {
    ...options,
    timeZone: MOSCOW_TZ,
  }).format(new Date(`${dateKey}T12:00:00+03:00`))
}
