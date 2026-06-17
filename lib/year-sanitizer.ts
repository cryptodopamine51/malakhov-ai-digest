export interface StaleYearCheckParams {
  generatedText: string
  sourceText: string
  now?: Date
}

export function findStaleHallucinatedYears({
  generatedText,
  sourceText,
  now = new Date(),
}: StaleYearCheckParams): string[] {
  const currentYear = now.getUTCFullYear()
  const matches = [...generatedText.matchAll(/\b20\d{2}\b/g)]
  if (!matches.length) return []

  const source = sourceText || ''
  return [...new Set(matches
    .filter((match) => isLikelyYearReference(generatedText, match.index ?? 0, match[0]))
    .map((match) => match[0]))]
    .filter((year) => Number(year) < currentYear && !source.includes(year))
    .sort()
}

export function hasStaleYearHallucination(params: StaleYearCheckParams): boolean {
  return findStaleHallucinatedYears(params).length > 0
}

function isLikelyYearReference(text: string, index: number, year: string): boolean {
  const before = text.slice(Math.max(0, index - 48), index)
  const after = text.slice(index + year.length, index + year.length + 64)
  if (isCountMetricContext(before, after)) return false
  return true
}

function isCountMetricContext(before: string, after: string): boolean {
  const normalizedAfter = after.toLowerCase()
  const normalizedBefore = before.toLowerCase()

  if (/^\s*(?:отдельн(?:ым|ых)\s+)?(?:цел(?:ь|и|ей|ям)|target(?:s)?\b)/iu.test(normalizedAfter)) {
    return true
  }
  if (/^\s*(?:единиц(?:а|ы)?\s+)?(?:боеприпас(?:ов|а|ы)?|munition(?:s)?\b)/iu.test(normalizedAfter)) {
    return true
  }
  if (/^\s*(?:пользовател(?:ей|я|и)|users?\b|клиент(?:ов|а|ы)|customers?\b)/iu.test(normalizedAfter)) {
    return true
  }
  if (/^\s*(?:токен(?:ов|а|ы)?|tokens?\b|запрос(?:ов|а|ы)?|requests?\b|слов(?:а)?|words?\b)/iu.test(normalizedAfter)) {
    return true
  }
  if (/^\s*(?:модел(?:ей|и)|models?\b|компани(?:й|и|я)|companies?\b|стартап(?:ов|а|ы)?|startups?\b)/iu.test(normalizedAfter)) {
    return true
  }
  if (/^\s*(?:стат(?:ей|ьи)|article(?:s)?\b|материал(?:ов|а|ы)?|публикаци(?:й|и|я)|post(?:s)?\b)/iu.test(normalizedAfter)) {
    return true
  }
  if (/^\s*(?:руб(?:лей|ля)?|доллар(?:ов|а)?|евро|₽|\$|€)\b/iu.test(normalizedAfter)) {
    return true
  }
  if (/(?:более|свыше|около|примерно|почти|до|over|more than|about|around|nearly)\s*$/iu.test(normalizedBefore) &&
    !/^\s*(?:г(?:од(?:а|у|ом|е)?|\.?)|year(?:s)?\b)/iu.test(normalizedAfter)) {
    return true
  }

  return false
}
