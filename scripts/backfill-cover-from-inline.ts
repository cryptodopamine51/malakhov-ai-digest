/**
 * scripts/backfill-cover-from-inline.ts
 *
 * Восстанавливает оригинальные продуктовые/редакционные обложки для статей, у которых
 * AI-cover был сгенерирован поверх вполне годных inline-картинок. Это последствие старой
 * логики `needsAiCover()` в `scripts/generate-ai-covers.ts`, которая хардкодом ставила AI-cover
 * всем материалам из `Habr AI / vc.ru / vc.ru AI/стартапы / CNews`, игнорируя `article_images`.
 *
 * После фикса нового AI-cover скрипта (Wave 2 в `docs/spec_2026-05-22_digest_editorial_priority.md`)
 * для НОВЫХ статей это поведение исправлено. Этот скрипт чинит уже опубликованные.
 *
 * Запуск:
 *   npx tsx scripts/backfill-cover-from-inline.ts --dry-run
 *   npx tsx scripts/backfill-cover-from-inline.ts --apply
 *   npx tsx scripts/backfill-cover-from-inline.ts --slug=<slug> --apply
 *
 * Опции:
 *   --dry-run      ничего не пишет (default, если нет --apply)
 *   --apply        записывает новый cover в DB
 *   --slug=<slug>  работать только по одной статье
 *   --limit=<n>    ограничить число затронутых строк (по умолчанию без лимита)
 *
 * Скрипт не вызывает OpenAI и не дергает fetcher — он работает только с уже сохранёнными
 * `article_images`.
 */

import { config as loadDotenv } from 'dotenv'
import { resolve } from 'path'

loadDotenv({ path: resolve(process.cwd(), '.env.local') })
loadDotenv({ path: resolve(process.cwd(), '.env') })

import { createClient } from '@supabase/supabase-js'

import { sanitizeArticleMedia } from '../lib/media-sanitizer'

interface Args {
  apply: boolean
  slug: string | null
  limit: number | null
}

interface CandidateRow {
  id: string
  slug: string | null
  source_name: string
  original_title: string
  ru_title: string | null
  lead: string | null
  summary: string[] | null
  original_text: string | null
  editorial_body: string | null
  cover_image_url: string | null
  article_images: { src: string; alt?: string | null }[] | null
}

function parseArgs(argv: string[]): Args {
  const args: Args = { apply: false, slug: null, limit: null }
  for (const arg of argv) {
    if (arg === '--apply') args.apply = true
    else if (arg === '--dry-run') args.apply = false
    else if (arg.startsWith('--slug=')) args.slug = arg.slice('--slug='.length)
    else if (arg.startsWith('--limit=')) {
      const n = Number(arg.slice('--limit='.length))
      if (Number.isFinite(n) && n > 0) args.limit = Math.floor(n)
    }
  }
  return args
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const supabaseUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_KEY
  if (!supabaseUrl || !serviceKey) {
    throw new Error('SUPABASE_URL и SUPABASE_SERVICE_KEY должны быть заданы в окружении')
  }
  const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } })

  // Берём только статьи с AI-cover. Template/stock пропускаем намеренно — это были fill-in
  // когда у статьи ничего не было; даже если в article_images что-то лежит, владельцу проще
  // оставить fill-in, чем перевести на сырую сорсную картинку, у которой нет editorial
  // treatment'a. AI-cover же реально перетёр оригинальный content и должен быть возвращён.
  let query = supabase
    .from('articles')
    .select(
      'id, slug, source_name, original_title, ru_title, lead, summary, original_text, editorial_body, cover_image_url, article_images',
    )
    .like('cover_image_url', '%/article-images/ai-covers/%')
    .not('article_images', 'is', null)
    .order('created_at', { ascending: false })

  if (args.slug) query = query.eq('slug', args.slug)
  if (args.limit) query = query.limit(args.limit)

  const { data, error } = await query
  if (error) throw new Error(`articles query failed: ${error.message}`)

  const rows = (data ?? []) as CandidateRow[]
  console.log(`Скан: ${rows.length} статей с AI-cover и непустым article_images`)

  const changes: Array<{
    id: string
    slug: string | null
    sourceName: string
    previousCover: string
    nextCover: string
  }> = []
  const noUsableInline: string[] = []

  for (const row of rows) {
    if (!row.cover_image_url) continue
    const sanitized = sanitizeArticleMedia({
      // null — нам важно посмотреть, что промоутится из inline,
      // не сбивая решение текущим AI-cover URL.
      coverImageUrl: null,
      articleImages: row.article_images,
      context: {
        sourceName: row.source_name,
        originalUrl: '',
        originalTitle: row.original_title,
        ruTitle: row.ru_title,
        lead: row.lead,
        summary: row.summary,
        originalText: row.original_text ?? row.editorial_body,
      },
    })

    if (!sanitized.coverImageUrl) {
      noUsableInline.push(row.slug ?? row.id)
      continue
    }

    // Sanitizer всегда промоутит первую sanitized inline, если cover был null.
    // Этот URL — реальная картинка из исходника, безопасная замена AI-cover'a.
    changes.push({
      id: row.id,
      slug: row.slug,
      sourceName: row.source_name,
      previousCover: row.cover_image_url,
      nextCover: sanitized.coverImageUrl,
    })
  }

  console.log(`\nК замене (${changes.length}):`)
  for (const c of changes) {
    console.log(`  [${c.sourceName}] ${c.slug ?? c.id}`)
    console.log(`      AI: ${c.previousCover}`)
    console.log(`     new: ${c.nextCover}`)
  }
  console.log(`\nБез usable inline (${noUsableInline.length}) — оставляем AI-cover как есть.`)

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
      .update({ cover_image_url: c.nextCover })
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
