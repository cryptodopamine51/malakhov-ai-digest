/**
 * pipeline/generate-images.ts
 *
 * CLI-скрипт: находит статьи без нормальной картинки → генерирует через DALL-E 3 → сохраняет.
 *
 * Запуск: npx tsx pipeline/generate-images.ts [--limit=N]
 *
 * «Без нормальной картинки» = cover_image_url IS NULL или это habr.com/share/ URL
 * (социальные sharing-ссылки, которые не работают как изображения).
 */

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { createClient } from '@supabase/supabase-js'
import { generateImagePrompt } from './image-director'
import { generateAndStoreImage } from './image-generator'
import { getArticleUrl } from '../lib/article-slugs'
import { readSiteUrlFromEnv } from '../lib/site'

// Лимит по умолчанию — 3 статьи для теста
const DEFAULT_LIMIT = 3

interface ArticleRow {
  id: string
  slug: string
  ru_title: string
  ru_text: string | null
  editorial_body: string | null
  topics: string[] | null
  primary_category: string | null
  cover_image_url: string | null
}

function parseLimit(): number {
  const arg = process.argv.find((a) => a.startsWith('--limit='))
  return arg ? parseInt(arg.split('=')[1], 10) : DEFAULT_LIMIT
}

async function main() {
  const limit = parseLimit()
  console.log(`\n🎨 Image generator — limit: ${limit} articles\n`)

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!
  )

  // Статьи: опубликованные, quality_ok, с slug и ru_title,
  // без картинки или с habr.com/share/ (битые sharing-ссылки)
  const { data: articles, error } = await supabase
    .from('articles')
    .select('id, slug, ru_title, ru_text, editorial_body, topics, primary_category, cover_image_url')
    .eq('published', true)
    .eq('quality_ok', true)
    .not('slug', 'is', null)
    .not('ru_title', 'is', null)
    .or('cover_image_url.is.null,cover_image_url.like.%habr.com/share%')
    .order('score', { ascending: false })
    .limit(limit)

  if (error) {
    console.error('DB query failed:', error)
    process.exit(1)
  }

  if (!articles || articles.length === 0) {
    console.log('✓ No articles need image generation')
    return
  }

  const SITE_URL = readSiteUrlFromEnv(process.env.NEXT_PUBLIC_SITE_URL) || 'https://news.malakhovai.ru'
  const results: { title: string; url: string; imageUrl: string }[] = []

  for (const article of articles as ArticleRow[]) {
    console.log(`📰 ${article.ru_title}`)
    console.log(`   Slug: ${article.slug}`)

    try {
      // Шаг 1: Claude строит визуальный prompt
      console.log('   → Visual Director (Claude)...')
      const { render_prompt, scene_type, visual_metaphor, mood, asymmetry_level } = await generateImagePrompt(article)
      console.log(`   → Scene: ${scene_type} | Mood: ${mood} | Asymmetry: ${asymmetry_level}`)
      console.log(`   → Metaphor: ${visual_metaphor}`)
      console.log(`   → Prompt: ${render_prompt.slice(0, 100)}...`)

      // Шаг 2: DALL-E 3 + Sharp + Supabase Storage
      console.log('   → Rendering (DALL-E 3)...')
      const publicUrl = await generateAndStoreImage(render_prompt, article.slug)
      console.log(`   → Stored: ${publicUrl}`)

      // Шаг 3: Обновляем cover_image_url в БД
      const { error: updateError } = await supabase
        .from('articles')
        .update({ cover_image_url: publicUrl })
        .eq('id', article.id)

      if (updateError) throw updateError

      const articleUrl = getArticleUrl(SITE_URL, article.slug, article.primary_category)
      results.push({ title: article.ru_title, url: articleUrl, imageUrl: publicUrl })
      console.log(`   ✓ Done: ${articleUrl}\n`)

    } catch (err) {
      console.error(`   ✗ Failed for "${article.ru_title}":`, (err as Error).message)
    }
  }

  // Итоговые ссылки
  if (results.length > 0) {
    console.log('\n━━━ Результат ━━━')
    for (const r of results) {
      console.log(`\n📖 ${r.title}`)
      console.log(`   Статья: ${r.url}`)
      console.log(`   Картинка: ${r.imageUrl}`)
    }
  }

  console.log(`\n✓ Готово: ${results.length}/${articles.length} статей обработано`)
}

main().catch((err) => {
  console.error('Fatal error:', err)
  process.exit(1)
})
