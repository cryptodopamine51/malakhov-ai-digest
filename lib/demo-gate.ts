/**
 * lib/demo-gate.ts
 *
 * Гейт для внутренних /demo-страниц (vector-covers, image-lab). Они нужны только для
 * визуальных экспериментов и не должны быть доступны в production — раздувают surface
 * поддержки. В preview и локально остаются открытыми, чтобы их можно было смотреть.
 *
 * Логика: доступны везде, кроме prod; в prod — только при ENABLE_DEMO=on (escape hatch).
 * `VERCEL_ENV` = 'production' | 'preview' | 'development'; локально не задан.
 */
export function isDemoEnabled(): boolean {
  if (process.env.ENABLE_DEMO === 'on') return true
  return process.env.VERCEL_ENV !== 'production'
}
