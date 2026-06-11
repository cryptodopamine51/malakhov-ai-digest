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
  const years = generatedText.match(/\b20\d{2}\b/g)
  if (!years) return []

  const source = sourceText || ''
  return [...new Set(years)]
    .filter((year) => Number(year) < currentYear && !source.includes(year))
    .sort()
}

export function hasStaleYearHallucination(params: StaleYearCheckParams): boolean {
  return findStaleHallucinatedYears(params).length > 0
}
