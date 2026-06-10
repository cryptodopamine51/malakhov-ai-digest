/**
 * scripts/mirror-covers-to-r2.ts
 *
 * Backfill: зеркалит внешние (hotlink) cover-обложки live-статей в R2
 * (WebP 1200w + варианты -400/-800) и переписывает cover_image_url.
 * Runtime-путь для новых статей — pipeline/cover-mirror.ts (вызывается из
 * prepareEditorialApplication); этот скрипт закрывает существующий корпус.
 *
 * Безопасность: update идёт с предикатом `eq('cover_image_url', oldUrl)` —
 * если статью успели перезаписать параллельно, строка не трогается.
 * Ошибки скачивания/конвертации — skip, статья остаётся на внешнем URL.
 *
 * Запуск:
 *   npx tsx scripts/mirror-covers-to-r2.ts                  — dry-run (только список)
 *   npx tsx scripts/mirror-covers-to-r2.ts --apply          — зеркалить всё
 *   npx tsx scripts/mirror-covers-to-r2.ts --apply --limit=50
 */

import { config as loadDotenv } from 'dotenv'
import { resolve } from 'path'

loadDotenv({ path: resolve(process.cwd(), '.env.local') })
loadDotenv({ path: resolve(process.cwd(), '.env') })

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { mirrorCoverToR2, shouldMirrorCover } from '../pipeline/cover-mirror'
import { isR2Configured } from '../lib/r2'

const CONCURRENCY = 4
const PAGE_SIZE = 500

interface Args {
  apply: boolean
  limit: number | null
}

function parseArgs(argv: string[]): Args {
  const args: Args = { apply: false, limit: null }
  for (const arg of argv) {
    if (arg === '--apply') args.apply = true
    else if (arg.startsWith('--limit=')) args.limit = Number(arg.slice('--limit='.length)) || null
  }
  return args
}

interface CandidateRow {
  id: string
  cover_image_url: string
  published_at: string | null
}

async function loadCandidates(supabase: SupabaseClient, limit: number | null): Promise<CandidateRow[]> {
  const rows: CandidateRow[] = []
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from('articles')
      .select('id, cover_image_url, published_at')
      .eq('publish_status', 'live')
      .like('cover_image_url', 'https%')
      .order('published_at', { ascending: false, nullsFirst: false })
      .range(from, from + PAGE_SIZE - 1)
    if (error) throw new Error(`candidates query failed: ${error.message}`)
    const page = (data ?? []) as CandidateRow[]
    for (const row of page) {
      if (shouldMirrorCover(row.cover_image_url)) rows.push(row)
      if (limit && rows.length >= limit) return rows
    }
    if (page.length < PAGE_SIZE) break
  }
  return rows
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const supabaseUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_KEY
  if (!supabaseUrl || !serviceKey) throw new Error('SUPABASE_URL и SUPABASE_SERVICE_KEY должны быть заданы')
  if (!isR2Configured()) throw new Error('R2_* env не сконфигурирован')
  const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } })

  const candidates = await loadCandidates(supabase, args.limit)
  console.log(`Кандидатов (live, внешний https-cover): ${candidates.length}`)
  if (!args.apply) {
    for (const c of candidates.slice(0, 20)) console.log(`  - ${c.id} ${c.cover_image_url.slice(0, 90)}`)
    if (candidates.length > 20) console.log(`  ... и ещё ${candidates.length - 20}`)
    console.log('\nDry-run. Для записи добавьте --apply.')
    return
  }

  let mirrored = 0
  let skipped = 0
  let raceLost = 0
  let index = 0

  async function worker() {
    for (;;) {
      const i = index++
      if (i >= candidates.length) return
      const c = candidates[i]
      const newUrl = await mirrorCoverToR2(c.id, c.cover_image_url, () => {})
      if (!newUrl) {
        skipped++
        console.log(`  ✗ skip ${c.id} (${c.cover_image_url.slice(0, 70)})`)
        continue
      }
      const { data, error } = await supabase
        .from('articles')
        .update({ cover_image_url: newUrl })
        .eq('id', c.id)
        .eq('cover_image_url', c.cover_image_url)
        .select('id')
      if (error) {
        skipped++
        console.log(`  ✗ update failed ${c.id}: ${error.message}`)
      } else if (!data?.length) {
        raceLost++
      } else {
        mirrored++
        if (mirrored % 25 === 0) console.log(`  … mirrored ${mirrored}/${candidates.length}`)
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()))
  console.log(`\nИтог: mirrored=${mirrored}, skipped=${skipped}, race_lost=${raceLost}, total=${candidates.length}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
