const RUSSIAN_DANGLING_TITLE_TOKENS = new Set([
  'а',
  'без',
  'в',
  'для',
  'и',
  'или',
  'из',
  'к',
  'на',
  'над',
  'но',
  'о',
  'об',
  'от',
  'по',
  'под',
  'при',
  'про',
  'с',
  'у',
  'за',
])

const RUSSIAN_TITLE_FORBIDDEN_PATTERNS: Array<{ pattern: RegExp; error: string }> = [
  {
    pattern: /(?:^|[\s"'«»“”‘’])в\s+(?:[А-Яа-яЁёA-Za-z0-9-]+\s+){0,4}киберопераций(?:$|[\s"'«»“”‘’.,:;!?])/iu,
    error: 'ru_title грамматически некорректен: "в ... киберопераций"',
  },
]

export interface ArticleTitleValidation {
  ok: boolean
  error: string | null
}

export function normalizeArticleTitle(value: string | null | undefined): string {
  return (value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[.。]+$/u, '')
}

export function finalTitleToken(value: string | null | undefined): string | null {
  const normalized = normalizeArticleTitle(value).replace(/[\s"'«»“”‘’.,:;!?…()[\]{}]+$/u, '')
  if (!normalized) return null
  return normalized.split(/\s+/u).pop() ?? null
}

export function findDanglingTitleEnding(value: string | null | undefined): string | null {
  const token = finalTitleToken(value)
  if (!token) return null
  if (/^[A-ZА-ЯЁ0-9-]{2,}$/u.test(token)) return null
  const lower = token.toLowerCase()
  return RUSSIAN_DANGLING_TITLE_TOKENS.has(lower) ? token : null
}

export function hasDanglingTitleEnding(value: string | null | undefined): boolean {
  return findDanglingTitleEnding(value) !== null
}

export function validateArticleTitle(value: string | null | undefined): ArticleTitleValidation {
  const title = normalizeArticleTitle(value)
  if (!title) return { ok: false, error: 'ru_title пустой' }
  if (title.length < 20 || title.length > 90) return { ok: false, error: `ru_title длина ${title.length}` }
  if (!/[А-Яа-яЁё]/u.test(title)) return { ok: false, error: 'ru_title без кириллицы' }
  const dangling = findDanglingTitleEnding(title)
  if (dangling) return { ok: false, error: `ru_title оборван на служебном слове: "${dangling}"` }
  const forbidden = RUSSIAN_TITLE_FORBIDDEN_PATTERNS.find(({ pattern }) => pattern.test(title))
  if (forbidden) return { ok: false, error: forbidden.error }
  return { ok: true, error: null }
}
