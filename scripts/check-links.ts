/**
 * scripts/check-links.ts
 *
 * Проверяет доступность всех опубликованных статей на сайте.
 * Запуск: npx tsx scripts/check-links.ts
 */

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { getAllSlugs } from '../lib/articles'

async function checkLink(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { method: 'HEAD' })
    return res.ok
  } catch {
    return false
  }
}

async function main() {
  const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL ?? '').replace(/\/$/, '')
  if (!siteUrl) {
    console.error('Не задан NEXT_PUBLIC_SITE_URL')
    process.exit(1)
  }

  console.log(`Сайт: ${siteUrl}`)

  const slugs = await getAllSlugs()
  console.log(`Slug'ов: ${slugs.length}`)

  const broken: string[] = []
  let ok = 0

  for (const slug of slugs) {
    const url = `${siteUrl}/articles/${slug}`
    const live = await checkLink(url)
    if (live) {
      ok++
    } else {
      broken.push(slug)
      console.log(`✗ 404: ${slug}`)
    }
  }

  console.log(`\n${ok}/${slugs.length} OK`)

  if (broken.length > 0) {
    console.log(`\nБитые ссылки (${broken.length}):`)
    broken.forEach((s) => console.log(`  /articles/${s}`))
    process.exit(1)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
