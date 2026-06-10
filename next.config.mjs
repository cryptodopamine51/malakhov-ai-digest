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
    // размеров в srcSet, и при росте трафика лимит улетает за пару дней. Обходим оптимизатор.
    // 2026-06-10: канонический путь раздачи — R2 WebP + варианты -400/-800 через нативный
    // <img srcset> (NEXT_PUBLIC_R2_IMAGE_VARIANTS=on), внешние hotlink-обложки зеркалятся в R2
    // (pipeline/cover-mirror.ts + scripts/mirror-covers-to-r2.ts). Оптимизатор остаётся
    // выключенным намеренно: на Hobby он не нужен и опасен лимитом.
    unoptimized: true,
    // Узкий whitelist на случай включения оптимизатора в будущем: при unoptimized=true
    // hostname-валидация не применяется, но wildcard '**' оставлял бы /_next/image открытым
    // прокси (SSRF) сразу после флипа флага. R2-домен + локальные ассеты покрывают всё
    // после cover-mirror; статьи с незазеркаленным внешним cover рендерятся через
    // unoptimized-путь и от whitelist не зависят.
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**.r2.dev',
      },
      {
        protocol: 'https',
        hostname: 'news.malakhovai.ru',
      },
    ],
  },
  experimental: {
    // SSG/ISR pages call Supabase during build. Default static generation
    // concurrency (8) can overload the free/pro PostgREST pool and cause
    // statement timeouts during deploy, so keep build-time DB pressure modest.
    staticGenerationMaxConcurrency: 2,
    staticGenerationMinPagesPerWorker: 10,
    staticGenerationRetryCount: 3,
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
