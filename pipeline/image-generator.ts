/**
 * pipeline/image-generator.ts
 *
 * Слой B: DALL-E 3 → сжатие Sharp (WebP 1200×630) → Cloudflare R2.
 * SEO: filename = {slug}.webp, cache 1 год, alt задаётся в компоненте из ru_title.
 */

import OpenAI from 'openai'
import sharp from 'sharp'
import { uploadWebpWithVariants } from '../lib/r2-images'

// 16:9 стандартный размер OG-изображения
const OUTPUT_WIDTH = 1200
const OUTPUT_HEIGHT = 630
const WEBP_QUALITY = 82

export async function generateAndStoreImage(
  renderPrompt: string,
  slug: string
): Promise<string> {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

  // 1. Генерируем изображение через DALL-E 3
  const response = await openai.images.generate({
    model: 'dall-e-3',
    prompt: renderPrompt,
    size: '1792x1024', // ближайший к 16:9 формат
    quality: 'standard',
    n: 1,
    response_format: 'url',
  })

  const imageUrl = response.data?.[0]?.url
  if (!imageUrl) throw new Error('DALL-E 3 returned no URL')

  // 2. Скачиваем изображение
  const imageResponse = await fetch(imageUrl)
  if (!imageResponse.ok) throw new Error(`Failed to download image: ${imageResponse.status}`)
  const rawBuffer = Buffer.from(await imageResponse.arrayBuffer())

  // 3. Сжимаем через Sharp → WebP (≈80-120KB вместо ~2MB)
  const compressed = await sharp(rawBuffer)
    .resize(OUTPUT_WIDTH, OUTPUT_HEIGHT, {
      fit: 'cover',
      position: 'centre',
    })
    .webp({ quality: WEBP_QUALITY, effort: 4 })
    .toBuffer()

  const sizeKB = Math.round(compressed.length / 1024)
  console.log(`  → Compressed: ${sizeKB}KB WebP ${OUTPUT_WIDTH}×${OUTPUT_HEIGHT}`)

  // 4. Загружаем в Cloudflare R2 (egress бесплатен — отдача обложек не жжёт квоту)
  // SEO: slug как основа (keyword-rich) + timestamp чтобы URL был уникальным.
  // Уникальный URL важен: при регенерации старый URL может быть закэширован CDN на 1 год.
  const filename = `${slug}-${Date.now()}.webp`

  return uploadWebpWithVariants(filename, compressed, {
    contentType: 'image/webp',
    cacheControl: '31536000', // 1 год кэш в CDN — безопасно, т.к. URL всегда новый
  })
}
