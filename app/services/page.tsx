import type { Metadata } from 'next'
import Link from 'next/link'
import AuthorCard from '../../src/components/AuthorCard'
import {
  CONTACTS_URL,
  EDITOR_NAME,
  EDITOR_URL,
  PERSONAL_TELEGRAM_URL,
  SITE_NAME,
  SITE_URL,
  absoluteUrl,
} from '../../lib/site'

export const revalidate = 86400

const TITLE = 'Внедрение ИИ в бизнес — консультация и сопровождение'
const DESCRIPTION =
  'Проектирую и внедряю ИИ-системы для автоматизации бизнес-процессов: аудит, пилотные проекты, полное внедрение. Начинаем с консультации. Мурманск, Россия.'

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: '/services' },
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    url: absoluteUrl('/services'),
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: TITLE,
    description: DESCRIPTION,
  },
  other: {
    'twitter:url': absoluteUrl('/services'),
  },
}

function consultUrl(content: string): string {
  const url = new URL(CONTACTS_URL)
  url.searchParams.set('utm_source', 'news_malakhovai_ru')
  url.searchParams.set('utm_medium', 'services_page')
  url.searchParams.set('utm_campaign', 'ai_consultation')
  url.searchParams.set('utm_content', content)
  url.searchParams.set('lead_source', 'news_services')
  url.searchParams.set('intent', 'ai_consultation')
  return url.toString()
}

const INCLUDED = [
  {
    title: 'Аудит',
    text: 'Разбираем процессы, данные и экономику. Где ИИ даст результат, где — нет, и с чего начать без лишних трат.',
  },
  {
    title: 'Пилотный проект',
    text: 'Запускаем сфокусированное решение на одном процессе. Проверяем гипотезу на реальных данных и считаем эффект.',
  },
  {
    title: 'Полное внедрение',
    text: 'Доводим решение до продакшена: архитектура, интеграции, обучение команды и сопровождение.',
  },
]

const FOR_WHOM = [
  'Предприниматели и руководители, которые хотят автоматизировать рутину с помощью ИИ.',
  'Команды, у которых уже есть идея применения ИИ, но нет уверенности в архитектуре и экономике.',
  'Компании, которым нужен внешний эксперт, чтобы не потратить бюджет на нерабочий пилот.',
]

const HOW = [
  {
    step: '1. Консультация',
    text: 'Созваниваемся, разбираем вашу задачу и ограничения. На выходе — понимание, реально ли это и что делать первым шагом.',
  },
  {
    step: '2. Аудит и план',
    text: 'Оцениваю процессы, данные и риски. Фиксируем приоритетный сценарий, метрики успеха и бюджет.',
  },
  {
    step: '3. Пилот',
    text: 'Собираем минимальное рабочее решение и проверяем эффект на реальных данных.',
  },
  {
    step: '4. Внедрение',
    text: 'Масштабируем то, что сработало, интегрируем в процессы и передаём команде.',
  },
]

export default function ServicesPage() {
  const serviceJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'ProfessionalService',
    '@id': `${SITE_URL}/services#service`,
    name: 'Внедрение ИИ в бизнес',
    description: DESCRIPTION,
    url: `${SITE_URL}/services`,
    areaServed: 'RU',
    serviceType: ['AI-аудит', 'AI-консалтинг', 'Внедрение ИИ', 'Автоматизация бизнес-процессов'],
    provider: {
      '@type': 'Person',
      '@id': `${EDITOR_URL}#person`,
      name: EDITOR_NAME,
      url: EDITOR_URL,
    },
    offers: {
      '@type': 'Offer',
      name: 'Консультация по внедрению ИИ',
      url: CONTACTS_URL,
    },
  }

  const breadcrumbJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Главная', item: SITE_URL },
      { '@type': 'ListItem', position: 2, name: 'Услуги', item: `${SITE_URL}/services` },
    ],
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 md:py-14">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify([serviceJsonLd, breadcrumbJsonLd]) }}
      />

      <nav className="mb-6 flex items-center gap-2 text-sm text-muted" aria-label="Хлебные крошки">
        <Link href="/" className="transition-colors hover:text-ink">Главная</Link>
        <span aria-hidden>→</span>
        <span>Услуги</span>
      </nav>

      <header>
        <p className="mb-2 text-[12px] font-semibold uppercase tracking-[0.1em] text-accent">Услуги</p>
        <h1 className="font-serif text-3xl font-bold text-ink md:text-4xl">
          Внедряю ИИ в бизнес — от аудита до рабочего решения
        </h1>
        <p className="mt-5 text-lg leading-relaxed text-ink">
          Проектирую и внедряю ИИ-системы для автоматизации бизнес-процессов: аудит, пилотные
          проекты, полное внедрение. Начинаем с консультации — разбираем вашу задачу и решаем,
          где ИИ действительно окупится.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <a
            href={consultUrl('hero')}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex rounded border border-ink px-5 py-2.5 text-sm font-semibold text-ink transition-colors hover:bg-ink hover:text-[var(--base)]"
          >
            Записаться на консультацию
          </a>
          <a
            href={PERSONAL_TELEGRAM_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex rounded border border-line px-5 py-2.5 text-sm font-medium text-ink transition-colors hover:border-accent hover:text-accent"
          >
            Написать в Telegram
          </a>
        </div>
      </header>

      <section className="mt-12">
        <h2 className="font-serif text-2xl font-bold text-ink">Что входит</h2>
        <div className="mt-5 grid gap-4 md:grid-cols-3">
          {INCLUDED.map((item) => (
            <div key={item.title} className="rounded border border-line bg-surface p-5">
              <h3 className="text-base font-semibold text-ink">{item.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted">{item.text}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mt-12">
        <h2 className="font-serif text-2xl font-bold text-ink">Для кого</h2>
        <ul className="mt-5 space-y-3">
          {FOR_WHOM.map((item) => (
            <li key={item} className="flex gap-2 text-[15px] leading-relaxed text-ink">
              <span className="mt-1 flex-shrink-0 text-accent">—</span>
              <span>{item}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-12">
        <h2 className="font-serif text-2xl font-bold text-ink">Как проходит работа</h2>
        <div className="mt-5 space-y-4">
          {HOW.map((item) => (
            <div key={item.step} className="rounded border border-line p-5">
              <h3 className="text-base font-semibold text-ink">{item.step}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted">{item.text}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mt-12 rounded border border-line bg-surface p-6">
        <h2 className="font-serif text-2xl font-bold text-ink">Начнём с консультации</h2>
        <p className="mt-3 text-[15px] leading-relaxed text-muted">
          Оставьте заявку — обсудим вашу задачу и решим, какой первый шаг даст результат.
          Без презентаций, по делу.
        </p>
        <div className="mt-5 flex flex-wrap gap-3">
          <a
            href={consultUrl('footer')}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex rounded border border-ink px-5 py-2.5 text-sm font-semibold text-ink transition-colors hover:bg-ink hover:text-[var(--base)]"
          >
            Оставить заявку
          </a>
          <a
            href={PERSONAL_TELEGRAM_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex rounded border border-line px-5 py-2.5 text-sm font-medium text-ink transition-colors hover:border-accent hover:text-accent"
          >
            Личный Telegram
          </a>
        </div>
      </section>

      <AuthorCard consultationHref="contacts" className="mt-12" />

      <p className="mt-8 text-xs text-muted">
        {EDITOR_NAME}, {SITE_NAME}. Мурманск, Россия.
      </p>
    </div>
  )
}
