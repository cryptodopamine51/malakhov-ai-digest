/**
 * pipeline/slug.ts
 *
 * Генерация URL-slug из русского заголовка.
 * По умолчанию генерирует чистый slug без технического хвоста.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

const TRANSLIT_MAP: Record<string, string> = {
  а: 'a',  б: 'b',  в: 'v',  г: 'g',  д: 'd',
  е: 'e',  ё: 'yo', ж: 'zh', з: 'z',  и: 'i',
  й: 'y',  к: 'k',  л: 'l',  м: 'm',  н: 'n',
  о: 'o',  п: 'p',  р: 'r',  с: 's',  т: 't',
  у: 'u',  ф: 'f',  х: 'kh', ц: 'ts', ч: 'ch',
  ш: 'sh', щ: 'shch', ъ: '', ы: 'y',  ь: '',
  э: 'e',  ю: 'yu', я: 'ya',
}

// SEO-wave 2026-05-21: bumped from 60 → 75 so longer titles ("AI-агенты в
// корпоративных закупках: что меняется в 2026 году") survive without
// mid-root chops like "-bezopas". Word-boundary slicing keeps the trailing
// fragment readable.
const MAX_SLUG_LENGTH = 75

// When the slug is cut at the length limit, prefer the last `-` before the
// limit so we end on a word boundary. Falls back to the hard cut if the
// nearest dash is too far back (avoids producing a stub like "ai-").
function capSlugAtWordBoundary(base: string, maxLength: number): string {
  if (base.length <= maxLength) return base
  const truncated = base.slice(0, maxLength)
  const lastDash = truncated.lastIndexOf('-')
  // Require the dash to leave at least 60% of the maxLength so we don't
  // cut back to a short stub.
  if (lastDash > Math.floor(maxLength * 0.6)) {
    return truncated.slice(0, lastDash)
  }
  return truncated
}

export function generateSlug(ruTitle: string): string {
  const transliterated = ruTitle
    .toLowerCase()
    .split('')
    .map((ch) => TRANSLIT_MAP[ch] ?? ch)
    .join('')

  const cleaned = transliterated
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')

  const base = capSlugAtWordBoundary(cleaned, MAX_SLUG_LENGTH)
    .replace(/^-+|-+$/g, '')

  return base || 'article'
}

/**
 * Defensive slug normalizer для входящих slug-ов из любого источника
 * (legacy backfill, ручной импорт, прошлые версии generator-а).
 * Возвращает только `[a-z0-9-]`, без leading/trailing/duplicate дефисов
 * и без legacy hex-хвоста.
 */
export function normalizeSlug(slug: string): string {
  const lowered = slug.toLowerCase()
  // Translit Cyrillic letters (защита от старых slug-ов с кириллицей в БД)
  const translit = lowered
    .split('')
    .map((ch) => TRANSLIT_MAP[ch] ?? ch)
    .join('')
  const cleaned = translit
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{1,2}[a-f0-9]{6}$/i, '')

  return capSlugAtWordBoundary(cleaned, MAX_SLUG_LENGTH).replace(/^-+|-+$/g, '')
}

/**
 * Runtime guard: бросает если slug содержит запрещённые символы.
 * Используется в collector apply path как safety net.
 */
export function assertAsciiSlug(slug: string): void {
  if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(slug)) {
    throw new Error(`invalid_slug: must match ^[a-z0-9-]+$, got ${JSON.stringify(slug)}`)
  }
}

function withNumericSuffix(baseSlug: string, ordinal: number): string {
  const suffix = `-${ordinal}`
  const trimmedBase = baseSlug
    .slice(0, Math.max(1, MAX_SLUG_LENGTH - suffix.length))
    .replace(/-+$/g, '')

  return `${trimmedBase}${suffix}`
}

async function isSlugTaken(
  supabase: Pick<SupabaseClient, 'from'>,
  slug: string,
  articleId: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from('articles')
    .select('id')
    .eq('slug', slug)
    .neq('id', articleId)
    .limit(1)

  if (error) {
    throw new Error(`Slug uniqueness check failed: ${error.message}`)
  }

  return (data ?? []).length > 0
}

export async function ensureUniqueSlug(
  supabase: Pick<SupabaseClient, 'from'>,
  ruTitle: string,
  articleId: string,
): Promise<string> {
  const baseSlug = generateSlug(ruTitle)

  if (!(await isSlugTaken(supabase, baseSlug, articleId))) {
    return baseSlug
  }

  for (let ordinal = 2; ordinal <= 99; ordinal++) {
    const candidate = withNumericSuffix(baseSlug, ordinal)
    if (!(await isSlugTaken(supabase, candidate, articleId))) {
      return candidate
    }
  }

  return withNumericSuffix(baseSlug, Math.max(100, Number.parseInt(articleId.slice(-2), 16) || 100))
}
