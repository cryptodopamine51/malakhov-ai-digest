/**
 * scripts/withdraw-off-topic.ts
 *
 * Снимает с публикации (publish_status = 'withdrawn') живые статьи, которые
 * ранжируются в поиске по не-AI запросам (consumer-tech / IT-продукты без AI).
 * Волна 1 (2026-06-01): список по экспорту топ-запросов Яндекс.Вебмастера за
 * 2026-04-30..05-30 (см. docs/spec_2026-06-01_organic_growth_implementation.md, T5).
 * Волна 2 (2026-06-10): сплошной sweep live-статей по consumer-паттернам
 * (VPN/наушники/телевизоры/пылесосы/Windows/Linux/распродажи) — утечка ZDNet AI
 * до включения needsKeywordFilter (см. docs/spec_2026-06-10_digest_full_audit.md).
 *
 * Механизм обратимый: статья уходит из ленты / sitemap / индекса (страница 404),
 * но строка остаётся в БД — вернуть можно установив publish_status='live' обратно.
 * Скрипт не вызывает Claude / OpenAI / fetcher, работает только со строками в БД.
 *
 * Запуск:
 *   npx tsx scripts/withdraw-off-topic.ts                 — dry-run (read-only аудит)
 *   npx tsx scripts/withdraw-off-topic.ts --apply         — записать withdrawn
 *   npx tsx scripts/withdraw-off-topic.ts --include-borderline --apply
 */

import { config as loadDotenv } from 'dotenv'
import { resolve } from 'path'

loadDotenv({ path: resolve(process.cwd(), '.env.local') })
loadDotenv({ path: resolve(process.cwd(), '.env') })

import { createClient } from '@supabase/supabase-js'

import type { Article } from '../lib/supabase'

// Явно не-AI потребительский/IT-контент, ранжирующийся по off-topic запросам.
const DEFINITE_SLUGS: string[] = [
  'luchshie-nas-ustroystva-2026-goda-ot-219-do-1042-sravnenie-p',
  'material-files-besplatnyy-faylovyy-menedzher-dlya-android-ko',
  'sony-wh-1000xm6-protiv-bose-quietcomfort-ultra-2-sravnenie-f',
  'chetyre-nastroyki-sony-wh-1000xm6-kotorye-realno-uluchshayut',
  'nordvpn-v-2026-godu-6400-serverov-protokol-nordwhisper-i-15',
  'nordvpn-priznan-samym-bystrym-vpn-dlya-puteshestviy-po-rezul',
  'ispolzovanie-rs-232-porta-televizora-dlya-avtomatizatsii-dom',
  'fitbit-air-protiv-whoop-google-vykhodit-na-rynok-fitnes-bras',
  // — Волна 2 (2026-06-10): наушники/аудио/ТВ —
  'airpods-pro-3-s-datchikom-pulsa-protiv-airpods-max-2',
  'samsung-vypustila-micro-rgb-televizor-r95h',
  'android-umeet-translirovat-zvuk-srazu-na-dve-pary-naushnikov',
  'pochemu-sony-proigrala-apple-v-gonke-prostranstvennogo-zvuka',
  'memorial-dey-luchshie-predlozheniya-na-naushniki',
  '60-120-ili-165-gts',
  'mini-led-protiv-oled',
  'lg-b5-oled-77-dyuymovyy-televizor-so-skidkoy',
  'roku-i-tcl-sudyat-za-obnovleniya',
  'monitory-s-chastotoy-1000-gts',
  // — Волна 2: VPN-подборки —
  'luchshie-vpn-dlya-puteshestviy-2026',
  'vpn-servisy-v-2026-godu-nordvpn-i-expressvpn',
  'luchshie-vpn-dlya-malogo-biznesa',
  'besplatnye-vpn-v-2026-godu',
  'luchshie-vpn-rasshireniya-dlya-chrome',
  'vpn-dlya-iphone-v-2026-godu',
  'surfshark-vypustil-sobstvennyy-vpn-protokol-dausos',
  // — Волна 2: гаджеты/распродажи —
  'google-gotovit-fitnes-braslet-fitbit-air',
  'amazon-prime-so-skidkoy-50',
  'amazon-prime-day-2026-pereezzhaet',
  'ecovacs-x8-pro-omni',
  'luchshie-roboty-pylesosy-2026-goda',
  'roborock-protiv-ecovacs',
  'remarkable-paper-pure-protiv-kindle-scribe',
  'remarkable-paper-pure-planshet-za-399',
  'bez-noutbuka-xr-garnitury-planshety',
  'macbook-neo-za-599-vynudil-windows',
  'tuxedo-infinitybook-max-15-linux-noutbuk',
  // — Волна 2: Windows/Linux без AI-грани —
  'ubuntu-26-04-protiv-fedora-44',
  'cachyos-distributiv-arch-linux',
  'obnaruzhena-tretya-za-dve-nedeli-kriticheskaya-uyazvimost',
  'chetvyortaya-uyazvimost-yadra-linux',
  'zero-day-eksployt-yellowkey-obkhodit-bitlocker',
  'microsoft-nauchila-windows-update-avtomaticheski-otkatyvat',
  'microsoft-vypustila-svoyu-pervuyu-distributiv-linux',
  'microsoft-menyaet-windows-update',
  'kak-besplatno-obnovit-windows-10-do-windows-11',
]

// IT/dev-материалы с возможной AI/agentic-гранью — по умолчанию НЕ трогаем.
const BORDERLINE_SLUGS: string[] = [
  'falcongaze-securetower-xenon',
  'flutter-3-44-agentnaya-goryachaya-perezagruzka-swift-package',
  // Волна 2 (2026-06-10): есть AI-грань (AI-продукт/функция) — по умолчанию не трогаем.
  'meta-vpervye-ustroila-rasprodazhu-ray-ban-s-ii',
  'google-vypustila-desktopnoe-prilozhenie-dlya-windows',
]

interface Args {
  apply: boolean
  includeBorderline: boolean
}

function parseArgs(argv: string[]): Args {
  const args: Args = { apply: false, includeBorderline: false }
  for (const arg of argv) {
    if (arg === '--apply') args.apply = true
    else if (arg === '--dry-run') args.apply = false
    else if (arg === '--include-borderline') args.includeBorderline = true
  }
  return args
}

function startsWithAny(slug: string | null, prefixes: string[]): boolean {
  if (!slug) return false
  return prefixes.some((p) => slug === p || slug.startsWith(p))
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const supabaseUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_KEY
  if (!supabaseUrl || !serviceKey) throw new Error('SUPABASE_URL и SUPABASE_SERVICE_KEY должны быть заданы')
  const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } })

  const targetSlugs = args.includeBorderline ? [...DEFINITE_SLUGS, ...BORDERLINE_SLUGS] : DEFINITE_SLUGS
  const auditSlugs = [...DEFINITE_SLUGS, ...BORDERLINE_SLUGS]

  // Точные slug'и БД могут быть длиннее (capSlug режет по word-boundary), поэтому
  // подтягиваем по префиксу через .or(ilike) — читаем все кандидаты, сверяем глазами.
  const { data, error } = await supabase
    .from('articles')
    .select('id, slug, ru_title, lead, primary_category, publish_status, original_url')
    .or(auditSlugs.map((s) => `slug.ilike.${s}%`).join(','))
  if (error) throw new Error(`articles query failed: ${error.message}`)

  const rows = (data ?? []) as Array<
    Pick<Article, 'id' | 'slug' | 'ru_title' | 'lead' | 'primary_category' | 'publish_status' | 'original_url'>
  >

  console.log(`Найдено строк: ${rows.length} (ожидалось до ${auditSlugs.length})\n`)
  for (const r of rows) {
    const tier = startsWithAny(r.slug, DEFINITE_SLUGS) ? 'DEFINITE' : startsWithAny(r.slug, BORDERLINE_SLUGS) ? 'BORDERLINE' : 'OTHER'
    console.log(`[${tier}] (${r.publish_status}) /${r.primary_category}/${r.slug}`)
    console.log(`   title: ${r.ru_title ?? '—'}`)
    console.log(`   lead:  ${(r.lead ?? '—').slice(0, 160)}`)
    console.log(`   src:   ${r.original_url ?? '—'}\n`)
  }

  const toWithdraw = rows.filter(
    (r) => r.publish_status === 'live' && startsWithAny(r.slug, targetSlugs),
  )

  console.log(`К снятию (live → withdrawn): ${toWithdraw.length}`)
  for (const r of toWithdraw) console.log(`   - ${r.slug}`)

  if (!args.apply) {
    console.log('\nDry-run. Для записи добавьте --apply.')
    return
  }

  let updated = 0
  for (const r of toWithdraw) {
    const { error: upErr } = await supabase
      .from('articles')
      .update({ publish_status: 'withdrawn' })
      .eq('id', r.id)
      .eq('publish_status', 'live')
    if (upErr) {
      console.error(`   ✗ ${r.slug}: ${upErr.message}`)
      continue
    }
    updated++
    console.log(`   ✓ withdrawn: ${r.slug}`)
  }
  console.log(`\nОбновлено строк: ${updated}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
