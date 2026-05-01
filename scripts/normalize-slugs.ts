#!/usr/bin/env tsx
/**
 * scripts/normalize-slugs.ts
 *
 * Одноразовая чистка БД от slug-ов с кириллицей и legacy hex-хвостами.
 * Безопасно: проверяет конфликты с уже занятыми slug-ами и добавляет
 * `-2`, `-3`, ... суффикс при коллизии. Не трогает уже валидные ASCII-slug-и.
 *
 * Запуск:
 *   npx tsx scripts/normalize-slugs.ts            # dry-run, печатает что будет изменено
 *   APPLY=1 npx tsx scripts/normalize-slugs.ts    # реальное обновление
 */

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { getServerClient } from '../lib/supabase'
import { generateSlug, normalizeSlug } from '../pipeline/slug'

const APPLY = process.env.APPLY === '1'
const VALID_SLUG_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/
const LEGACY_HEX_RE = /-{1,2}[a-f0-9]{6}$/i

interface ArticleRow {
  id: string
  slug: string | null
  ru_title: string | null
  original_title: string | null
}

async function findUniqueSlug(
  supabase: ReturnType<typeof getServerClient>,
  baseSlug: string,
  ownArticleId: string,
): Promise<string> {
  let candidate = baseSlug
  for (let attempt = 0; attempt < 100; attempt++) {
    const { data, error } = await supabase
      .from('articles')
      .select('id')
      .eq('slug', candidate)
      .neq('id', ownArticleId)
      .limit(1)

    if (error) throw new Error(`uniqueness check failed: ${error.message}`)
    if ((data ?? []).length === 0) return candidate

    const ordinal = attempt + 2
    const suffix = `-${ordinal}`
    candidate = `${baseSlug.slice(0, 60 - suffix.length).replace(/-+$/g, '')}${suffix}`
  }
  throw new Error(`could not find unique slug for ${baseSlug}`)
}

async function main(): Promise<void> {
  const supabase = getServerClient()
  const { data: rows, error } = await supabase
    .from('articles')
    .select('id, slug, ru_title, original_title')
    .not('slug', 'is', null)

  if (error) throw error

  const candidates = (rows as ArticleRow[]).filter((r) => r.slug && !VALID_SLUG_RE.test(r.slug))
  const legacyHex = (rows as ArticleRow[]).filter((r) => r.slug && LEGACY_HEX_RE.test(r.slug))

  console.log(`Total articles with slug: ${rows?.length ?? 0}`)
  console.log(`Invalid (non-ASCII) slugs: ${candidates.length}`)
  console.log(`Legacy hex-tail slugs: ${legacyHex.length}`)

  const targets = [
    ...candidates,
    ...legacyHex.filter((r) => !candidates.some((c) => c.id === r.id)),
  ]

  console.log(`Will normalize: ${targets.length}`)
  if (!APPLY) {
    console.log('\nDry-run preview (first 30):')
  }

  let updated = 0
  let skipped = 0
  let failed = 0

  for (const row of targets) {
    if (!row.slug) continue
    const oldSlug = row.slug
    const baseFromTitle = row.ru_title ? generateSlug(row.ru_title) : ''
    const baseFromSlug = normalizeSlug(oldSlug)
    // Берём более «полный» вариант: если slug в БД был обрезан, ru_title обычно даёт лучший результат
    const baseSlug = baseFromTitle.length >= baseFromSlug.length ? baseFromTitle : baseFromSlug
    if (!baseSlug) {
      console.error(`✗ ${row.id} :: cannot derive slug (ru_title=${JSON.stringify(row.ru_title)}, slug=${JSON.stringify(oldSlug)})`)
      failed++
      continue
    }

    if (baseSlug === oldSlug) {
      skipped++
      continue
    }

    if (!APPLY) {
      if (updated < 30) console.log(`  ${oldSlug}\n  → ${baseSlug}`)
      updated++
      continue
    }

    try {
      const finalSlug = await findUniqueSlug(supabase, baseSlug, row.id)
      const { error: updateError } = await supabase
        .from('articles')
        .update({ slug: finalSlug, updated_at: new Date().toISOString() })
        .eq('id', row.id)
      if (updateError) throw updateError
      console.log(`✓ ${row.id} :: ${oldSlug} → ${finalSlug}`)
      updated++
    } catch (err) {
      console.error(`✗ ${row.id} :: ${err instanceof Error ? err.message : String(err)}`)
      failed++
    }
  }

  console.log(`\nUpdated: ${updated}, Skipped (no change): ${skipped}, Failed: ${failed}`)
  if (!APPLY) console.log('Run with APPLY=1 to persist.')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
