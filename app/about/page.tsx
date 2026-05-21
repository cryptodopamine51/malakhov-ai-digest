import type { Metadata } from 'next'
import Link from 'next/link'
import { SITE_NAME, SITE_TELEGRAM_URL, SITE_URL, absoluteUrl } from '../../lib/site'

export const revalidate = 86400

const TITLE = 'Об издании'
const DESCRIPTION =
  'Malakhov AI Дайджест — русскоязычный редакционный дайджест об искусственном интеллекте. Кто его делает, как формируется лента, какие источники мы используем и как с нами связаться.'

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: '/about' },
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    url: absoluteUrl('/about'),
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: TITLE,
    description: DESCRIPTION,
  },
  other: {
    'twitter:url': absoluteUrl('/about'),
  },
}

export default function AboutPage() {
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'AboutPage',
    name: TITLE,
    description: DESCRIPTION,
    url: `${SITE_URL}/about`,
    isPartOf: {
      '@type': 'WebSite',
      name: SITE_NAME,
      url: SITE_URL,
    },
    publisher: {
      '@type': 'Organization',
      name: SITE_NAME,
      url: SITE_URL,
      sameAs: [SITE_TELEGRAM_URL],
    },
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 md:py-14">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      <h1 className="mb-6 font-serif text-3xl font-bold text-ink md:text-4xl">
        {TITLE}
      </h1>

      <section className="space-y-5 text-base leading-relaxed text-ink">
        <p>
          <strong>{SITE_NAME}</strong> — русскоязычный редакционный дайджест об искусственном
          интеллекте. Мы публикуем материалы о ключевых релизах AI-моделей, исследованиях, продуктах,
          стартапах, инвестициях и применении ИИ в России. Каждый день редакция отбирает важные
          события из англоязычных и российских источников, переводит и адаптирует их на русский язык
          с фактической первоисточниковой опорой.
        </p>

        <h2 className="mt-8 font-serif text-2xl font-bold text-ink">Редакционная политика</h2>
        <p>
          Мы строим материалы вокруг фактов из первоисточника: компании, продукта, числа, даты,
          модели, института или конкретного метода. Цифры, имена, цитаты и оценки не выдумываются;
          там, где источник недостаточен, мы оставляем тему без раскрытия, а не натягиваем ложную
          глубину. По чувствительным темам — регуляторика, медицина, геополитика, инвестиции — мы
          применяем дополнительную проверку и разделяем факты и интерпретацию.
        </p>
        <p>
          Ключевые принципы редакции — отсутствие clickbait, явное указание первоисточника,
          чистый канонический URL и совпадение JSON-LD с видимой страницей. Внутренний редакционный
          стандарт фиксирует эти правила и обновляется одновременно с изменениями pipeline.
        </p>

        <h2 className="mt-8 font-serif text-2xl font-bold text-ink">Технология</h2>
        <p>
          Сайт работает на Next.js 15 и развёрнут на Vercel. Контент хранится в PostgreSQL (Supabase),
          обогащение материалов происходит через Anthropic Claude по строгому редакционному
          контракту с валидатором и automatic media sanitiser. Sitemap, RSS, llms.txt и Google News
          sitemap живут на канонично-фиксированном домене `news.malakhovai.ru`.
        </p>

        <h2 className="mt-8 font-serif text-2xl font-bold text-ink">Контакты и соцсети</h2>
        <ul className="list-disc space-y-1 pl-6">
          <li>
            Telegram-канал:{' '}
            <a
              href={SITE_TELEGRAM_URL}
              className="text-accent hover:underline"
              target="_blank"
              rel="noopener"
            >
              {SITE_TELEGRAM_URL.replace(/^https?:\/\//, '')}
            </a>
          </li>
          <li>
            Источники, которые мы регулярно отслеживаем:{' '}
            <Link href="/sources" className="text-accent hover:underline">/sources</Link>
          </li>
          <li>
            Юридические уведомления:{' '}
            <Link href="/privacy-policy" className="text-accent hover:underline">/privacy-policy</Link>,{' '}
            <Link href="/cookie-policy" className="text-accent hover:underline">/cookie-policy</Link>,{' '}
            <Link href="/consent" className="text-accent hover:underline">/consent</Link>
          </li>
        </ul>

        <p className="pt-6 text-sm text-muted">
          Если на странице есть фактическая ошибка или неточный перевод, напишите редакции через
          Telegram-канал. Мы поправим материал в течение дня и зафиксируем изменения в metadata
          статьи (`dateModified`).
        </p>
      </section>
    </div>
  )
}
