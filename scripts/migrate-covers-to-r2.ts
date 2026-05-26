/**
 * scripts/migrate-covers-to-r2.ts
 *
 * Одноразовая миграция обложек из Supabase Storage (bucket `article-images`) в Cloudflare R2.
 *
 * Для каждой статьи с legacy Supabase-storage cover_image_url:
 *   1. скачивает байты из Supabase Storage (по ключу после `/article-images/`),
 *   2. заливает в R2 с тем же ключом (uploadToR2 префиксует `article-images/`),
 *   3. переписывает articles.cover_image_url на R2-URL.
 *
 * Требует РАЗБЛОКИРОВАННЫЙ Supabase (иначе download/update вернут 402/403).
 * Идемпотентно: статьи, у которых cover уже на R2, пропускаются.
 *
 * Запуск:
 *   npx tsx scripts/migrate-covers-to-r2.ts --dry-run     # показать план, ничего не менять
 *   npx tsx scripts/migrate-covers-to-r2.ts               # выполнить
 *   npx tsx scripts/migrate-covers-to-r2.ts --limit 50    # ограничить пачку
 */

import { config as loadDotenv } from 'dotenv'
import { resolve } from 'node:path'
import { existsSync, readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { uploadToR2, isR2Configured } from '../lib/r2'

loadDotenv({ path: resolve(process.cwd(), '.env.local') })
loadDotenv({ path: resolve(process.cwd(), '.env') })
loadExtraEnv(resolve(process.cwd(), 'malakhov-ai-keys.env'))

const BUCKET = 'article-images'
const STORAGE_MARKER = '/storage/v1/object/public/article-images/'

const dryRun = process.argv.includes('--dry-run')
const limitArg = process.argv.indexOf('--limit')
const limit = limitArg !== -1 ? Number(process.argv[limitArg + 1]) : Infinity

function loadExtraEnv(path: string) {
  if (!existsSync(path)) return
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.+?)\s*$/i)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
}

/** Extract the object key (after `/article-images/`) from a legacy Supabase storage URL. */
function legacyStorageKey(url: string): string | null {
  const idx = url.indexOf(STORAGE_MARKER)
  if (idx === -1) return null
  return url.slice(idx + STORAGE_MARKER.length).split('?')[0]
}

async function main() {
  if (!isR2Configured()) {
    throw new Error('R2 is not configured — set R2_* env vars (see malakhov-ai-keys.env)')
  }
  const supabaseUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_KEY
  if (!supabaseUrl || !serviceKey) throw new Error('Missing Supabase env (SUPABASE_URL / SUPABASE_SERVICE_KEY)')

  const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } })

  console.log(`[migrate-covers-to-r2] mode=${dryRun ? 'DRY-RUN' : 'APPLY'} limit=${limit}`)

  const { data, error } = await supabase
    .from('articles')
    .select('id, slug, cover_image_url')
    .ilike('cover_image_url', `%${STORAGE_MARKER}%`)
    .order('created_at', { ascending: false })

  if (error) throw new Error(`Select failed: ${error.message}`)
  const rows = (data ?? []).slice(0, limit)
  console.log(`Found ${data?.length ?? 0} legacy Supabase-storage covers, processing ${rows.length}.`)

  let migrated = 0
  let failed = 0
  for (const row of rows) {
    const url = row.cover_image_url as string
    const key = legacyStorageKey(url)
    if (!key) {
      console.warn(`  skip ${row.slug}: cannot parse storage key`)
      continue
    }
    if (dryRun) {
      console.log(`  [dry] ${row.slug}: ${key} → R2 article-images/${key}`)
      migrated++
      continue
    }
    try {
      const { data: blob, error: dlErr } = await supabase.storage.from(BUCKET).download(key)
      if (dlErr || !blob) throw new Error(`download failed: ${dlErr?.message ?? 'no body'}`)
      const buffer = Buffer.from(await blob.arrayBuffer())
      const contentType = blob.type || 'image/webp'

      const publicUrl = await uploadToR2(key, buffer, { contentType, cacheControl: '31536000' })

      const { error: updErr } = await supabase
        .from('articles')
        .update({ cover_image_url: publicUrl })
        .eq('id', row.id)
      if (updErr) throw new Error(`db update failed: ${updErr.message}`)

      console.log(`  ✓ ${row.slug} (${Math.round(buffer.length / 1024)}KB) → ${publicUrl}`)
      migrated++
    } catch (e) {
      failed++
      console.error(`  ✗ ${row.slug}: ${(e as Error).message}`)
    }
  }

  console.log(`\nDone. migrated=${migrated} failed=${failed}`)
  if (failed > 0) process.exitCode = 1
}

main().catch((e) => {
  console.error('FATAL:', e?.message ?? e)
  process.exit(1)
})
