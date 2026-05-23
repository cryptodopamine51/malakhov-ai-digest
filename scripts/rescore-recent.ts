/**
 * scripts/rescore-recent.ts
 *
 * Пересчитывает `articles.score` по текущей формуле в `pipeline/scorer.ts` для свежих
 * live-статей. Нужен после изменений scorer-формулы (например, Wave 1 из
 * `docs/spec_2026-05-22_digest_editorial_priority.md`), чтобы уже опубликованные за
 * последние дни статьи попали в ближайший дайджест по новой логике, а не по старой
 * формуле submit-этапа.
 *
 * Запуск:
 *   npx tsx scripts/rescore-recent.ts --dry-run                — показать diff
 *   npx tsx scripts/rescore-recent.ts --apply                  — записать
 *   npx tsx scripts/rescore-recent.ts --days=7 --apply         — окно 7 дней (по умолчанию 3)
 *
 * Скрипт не вызывает Claude / OpenAI / fetcher, работает только со строками в БД.
 */

import { config as loadDotenv } from 'dotenv'
import { resolve } from 'path'

loadDotenv({ path: resolve(process.cwd(), '.env.local') })
loadDotenv({ path: resolve(process.cwd(), '.env') })

import { createClient } from '@supabase/supabase-js'

import type { Article } from '../lib/supabase'
import { scoreArticle } from '../pipeline/scorer'

interface Args {
  apply: boolean
  days: number
}

function parseArgs(argv: string[]): Args {
  const args: Args = { apply: false, days: 3 }
  for (const arg of argv) {
    if (arg === '--apply') args.apply = true
    else if (arg === '--dry-run') args.apply = false
    else if (arg.startsWith('--days=')) {
      const n = Number(arg.slice('--days='.length))
      if (Number.isFinite(n) && n > 0) args.days = Math.floor(n)
    }
  }
  return args
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const supabaseUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_KEY
  if (!supabaseUrl || !serviceKey) throw new Error('SUPABASE_URL и SUPABASE_SERVICE_KEY должны быть заданы')
  const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } })

  const since = new Date(Date.now() - args.days * 24 * 3600 * 1000).toISOString()

  // Live-статьи с заполненным editorial_body (значит score уже считался один раз
  // после enrich). Это исключает pending/processing/failed строки.
  const { data, error } = await supabase
    .from('articles')
    .select('*')
    .eq('publish_status', 'live')
    .eq('quality_ok', true)
    .gte('created_at', since)
    .order('created_at', { ascending: false })
  if (error) throw new Error(`articles query failed: ${error.message}`)

  const rows = (data ?? []) as Article[]
  console.log(`Окно ${args.days} дней: ${rows.length} live-статей`)

  type Change = { id: string; slug: string | null; source: string; old: number; next: number; title: string }
  const changes: Change[] = []

  for (const article of rows) {
    const next = scoreArticle(article)
    const old = Number(article.score ?? 0)
    if (next === old) continue
    changes.push({
      id: article.id,
      slug: article.slug,
      source: article.source_name,
      old,
      next,
      title: (article.ru_title ?? article.original_title ?? '').slice(0, 90),
    })
  }

  // Сортируем по диффу — крупные изменения в начало.
  changes.sort((a, b) => Math.abs(b.next - b.old) - Math.abs(a.next - a.old))

  console.log(`\nИзменений: ${changes.length}`)
  console.log(`Распределение diff:`)
  const buckets: Record<string, number> = {}
  for (const c of changes) {
    const key = `${c.next > c.old ? '+' : ''}${c.next - c.old}`
    buckets[key] = (buckets[key] ?? 0) + 1
  }
  for (const [k, v] of Object.entries(buckets).sort((x, y) => Number(x[0]) - Number(y[0]))) {
    console.log(`  ${k}: ${v}`)
  }

  console.log(`\nTop ${Math.min(15, changes.length)} изменений:`)
  for (const c of changes.slice(0, 15)) {
    const arrow = c.next > c.old ? '↑' : '↓'
    console.log(`  ${arrow} ${c.old} → ${c.next}  [${c.source}]  ${c.title}`)
  }

  if (!args.apply) {
    console.log('\nDry-run. Чтобы записать в БД, повтори с --apply.')
    return
  }

  if (changes.length === 0) {
    console.log('\nНечего применять.')
    return
  }

  let applied = 0
  for (const c of changes) {
    const { error: updateError } = await supabase
      .from('articles')
      .update({ score: c.next })
      .eq('id', c.id)
    if (updateError) {
      console.error(`  FAIL ${c.slug ?? c.id}: ${updateError.message}`)
      continue
    }
    applied++
  }
  console.log(`\nПрименено: ${applied} / ${changes.length}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
