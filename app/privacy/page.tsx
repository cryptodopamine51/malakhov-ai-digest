import type { Metadata } from 'next'
import Link from 'next/link'
import { absoluteUrl } from '../../lib/site'

export const metadata: Metadata = {
  title: 'Политика конфиденциальности',
  description: 'Как Malakhov AI Дайджест обрабатывает данные посетителей.',
  alternates: { canonical: '/privacy' },
  openGraph: {
    title: 'Политика конфиденциальности',
    description: 'Как Malakhov AI Дайджест обрабатывает данные посетителей.',
    type: 'website',
    url: absoluteUrl('/privacy'),
  },
  other: {
    'twitter:url': absoluteUrl('/privacy'),
  },
}

export default function PrivacyPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <h1 className="mb-6 font-serif text-3xl font-bold text-ink">Политика конфиденциальности</h1>
      <div className="space-y-5 text-sm leading-relaxed text-muted">
        <p>
          Malakhov AI Дайджест не требует регистрации и не собирает персональные данные посетителей через формы аккаунта.
        </p>
        <p>
          Для базовой статистики посещений сайт может использовать Яндекс Метрику. Посетитель
          уведомляется об использовании cookies и может отозвать согласие на странице{' '}
          <Link href="/consent" className="underline hover:text-ink">/consent</Link>.
        </p>
        <p>
          Технические журналы хостинга могут содержать IP-адрес, user-agent, URL запроса и время обращения. Эти данные используются для безопасности и диагностики.
        </p>
        <p>
          По вопросам обработки данных можно написать на адрес: privacy@malakhovai.ru.
        </p>
      </div>
    </div>
  )
}
