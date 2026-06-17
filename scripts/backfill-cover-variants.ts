/**
 * scripts/backfill-cover-variants.ts
 *
 * Генерирует уменьшенные WebP-варианты (`-400`/`-800`) для ВСЕХ существующих
 * R2-обложек и заливает их рядом с base-файлом в R2. Base-обложку не трогает.
 *
 * Invariant repair/check: пока у обложки нет вариантов, нативный `<img srcset>`
 * будет 404-ить на выбранный браузером кандидат (-400/-800). После полного
 * зелёного прогона инвариант «у каждой R2-обложки есть варианты» закрыт;
 * forward-аплоады (image-generator + cover-скрипты) генерят варианты сами через
 * uploadWebpWithVariants.
 *
 * Идемпотентно: с --skip-existing пропускает обложки, у которых вариант `-800`
 * уже доступен (HEAD 200).
 *
 * Запуск:
 *   npx tsx scripts/backfill-cover-variants.ts --dry-run        # показать план
 *   npx tsx scripts/backfill-cover-variants.ts                  # выполнить
 *   npx tsx scripts/backfill-cover-variants.ts --skip-existing  # пропустить готовые
 *   npx tsx scripts/backfill-cover-variants.ts --limit 50       # ограничить пачку
 */

import { config as loadDotenv } from 'dotenv'
import { resolve } from 'node:path'
import { existsSync, readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import sharp from 'sharp'
import { uploadToR2, isR2Configured } from '../lib/r2'
import {
  COVER_VARIANT_WIDTHS,
  isR2ImageUrl,
  variantKeyFor,
  variantUrlFor,
} from '../lib/image-variants'

loadDotenv({ path: resolve(process.cwd(), '.env.local') })
loadDotenv({ path: resolve(process.cwd(), '.env') })
loadExtraEnv(resolve(process.cwd(), 'malakhov-ai-keys.env'))

const dryRun = process.argv.includes('--dry-run')
const skipExisting = process.argv.includes('--skip-existing')
const limitArg = process.argv.indexOf('--limit')
const limit = limitArg !== -1 ? Number(process.argv[limitArg + 1]) : Infinity

function loadExtraEnv(path: string) {
  if (!existsSync(path)) return
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.+?)\s*$/i)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
}

/** R2 object key (after host) for a public R2 cover URL: `article-images/<...>.webp`. */
function objectKeyFromUrl(url: string): string {
  return new URL(url).pathname.replace(/^\/+/, '')
}

async function variantExists(url: string): Promise<boolean> {
  try {
    const res = await fetch(variantUrlFor(url, COVER_VARIANT_WIDTHS[COVER_VARIANT_WIDTHS.length - 1]), {
      method: 'HEAD',
    })
    return res.ok
  } catch {
    return false
  }
}

async function main() {
  if (!isR2Configured()) {
    throw new Error('R2 is not configured — set R2_* env vars (see malakhov-ai-keys.env)')
  }
  const supabaseUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_KEY
  if (!supabaseUrl || !serviceKey) throw new Error('Missing Supabase env (SUPABASE_URL / SUPABASE_SERVICE_KEY)')

  const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } })

  console.log(
    `[backfill-cover-variants] mode=${dryRun ? 'DRY-RUN' : 'APPLY'} skipExisting=${skipExisting} limit=${limit} widths=${COVER_VARIANT_WIDTHS.join(',')}`,
  )

  const { data, error } = await supabase
    .from('articles')
    .select('id, slug, cover_image_url')
    .ilike('cover_image_url', '%/article-images/%')
    .order('created_at', { ascending: false })

  if (error) throw new Error(`Select failed: ${error.message}`)

  const rows = (data ?? []).filter((r) => isR2ImageUrl(r.cover_image_url as string)).slice(0, limit)
  console.log(`Found ${data?.length ?? 0} candidates, ${rows.length} are R2 .webp covers (after limit).`)

  let done = 0
  let skipped = 0
  let failed = 0

  for (const row of rows) {
    const url = row.cover_image_url as string
    const baseKey = objectKeyFromUrl(url)

    if (dryRun) {
      console.log(`  [dry] ${row.slug}: ${COVER_VARIANT_WIDTHS.map((w) => variantKeyFor(baseKey, w)).join(', ')}`)
      done++
      continue
    }

    try {
      if (skipExisting && (await variantExists(url))) {
        console.log(`  · ${row.slug}: variants present, skip`)
        skipped++
        continue
      }

      const res = await fetch(url)
      if (!res.ok) throw new Error(`download base failed: ${res.status}`)
      const baseBuf = Buffer.from(await res.arrayBuffer())

      for (const width of COVER_VARIANT_WIDTHS) {
        const resized = await sharp(baseBuf)
          .resize({ width, withoutEnlargement: true })
          .webp({ quality: 82, effort: 4 })
          .toBuffer()
        await uploadToR2(variantKeyFor(baseKey, width), resized, {
          contentType: 'image/webp',
          cacheControl: '31536000',
        })
      }

      console.log(`  ✓ ${row.slug} → ${COVER_VARIANT_WIDTHS.map((w) => `${w}w`).join('+')}`)
      done++
    } catch (e) {
      failed++
      console.error(`  ✗ ${row.slug}: ${(e as Error).message}`)
    }
  }

  console.log(`\nDone. generated=${done} skipped=${skipped} failed=${failed}`)
  if (failed > 0) process.exitCode = 1
}

main().catch((e) => {
  console.error('FATAL:', e?.message ?? e)
  process.exit(1)
})
