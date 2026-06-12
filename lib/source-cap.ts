export const SOURCE_DAILY_PUBLISH_CAP = Math.max(
  1,
  Number(process.env.SOURCE_DAILY_PUBLISH_CAP ?? '10') || 10,
)

/**
 * Pure filter: lets candidates through until (already published today + already
 * accepted in this pass) reaches the source cap. Returns candidates in input order.
 */
export function applySourceDailyCap<T extends { source_name: string | null }>(
  candidates: T[],
  publishedTodayBySource: Map<string, number>,
  cap: number = SOURCE_DAILY_PUBLISH_CAP,
): { allowed: T[]; skippedBySource: Map<string, number> } {
  const running = new Map<string, number>(publishedTodayBySource)
  const allowed: T[] = []
  const skippedBySource = new Map<string, number>()
  for (const candidate of candidates) {
    const source = candidate.source_name ?? ''
    if (!source) {
      allowed.push(candidate)
      continue
    }
    const used = running.get(source) ?? 0
    if (used >= cap) {
      skippedBySource.set(source, (skippedBySource.get(source) ?? 0) + 1)
      continue
    }
    running.set(source, used + 1)
    allowed.push(candidate)
  }
  return { allowed, skippedBySource }
}
