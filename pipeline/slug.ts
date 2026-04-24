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

const MAX_SLUG_LENGTH = 60

export function generateSlug(ruTitle: string): string {
  const transliterated = ruTitle
    .toLowerCase()
    .split('')
    .map((ch) => TRANSLIT_MAP[ch] ?? ch)
    .join('')

  const base = transliterated
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/^-+|-+$/g, '')

  return base || 'article'
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
