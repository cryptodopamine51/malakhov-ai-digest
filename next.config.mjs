import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

/** @type {import('next').NextConfig} */
const nextConfig = {
  outputFileTracingRoot: __dirname,
  images: {
    // 2026-05-22 hotfix: Vercel image optimization endpoint начал возвращать HTTP 402
    // `OPTIMIZED_IMAGE_REQUEST_PAYMENT_REQUIRED` для всех cover-URL — исчерпан месячный
    // лимит трансформаций на Hobby tier (~5k/month). Каждая ArticleCard эмитит 10
    // размеров в srcSet, и при росте трафика лимит улетает за пару дней. Обходим оптимизатор:
    // браузер грузит исходник напрямую (Supabase Storage / theverge.com / zdnet.com / ...).
    // Cost: нет автоматического AVIF/WebP и нет per-device-resize, но обложки видимы сразу.
    // Альтернатива оптимизатору — адаптивные R2-варианты + нативный <img srcset> за флагом
    // NEXT_PUBLIC_R2_IMAGE_VARIANTS (см. docs/ARTICLE_SYSTEM.md → Responsive cover variants).
    // Возврат к Vercel-оптимизатору — только после апгрейда на Pro.
    unoptimized: true,
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**',
      },
    ],
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ]
  },
}

export default nextConfig
