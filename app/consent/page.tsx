import type { Metadata } from 'next'
import RevokeConsentButton from '../../src/components/RevokeConsentButton'
import { absoluteUrl } from '../../lib/site'

export const metadata: Metadata = {
  title: 'Отзыв согласия на обработку cookies и персональных данных',
  description:
    'Как отозвать согласие на использование cookies и обработку персональных данных на news.malakhovai.ru.',
  alternates: { canonical: '/consent' },
  openGraph: {
    title: 'Отзыв согласия на обработку cookies и персональных данных',
    description:
      'Как отозвать согласие на использование cookies и обработку персональных данных на news.malakhovai.ru.',
    type: 'website',
    url: absoluteUrl('/consent'),
  },
  other: {
    'twitter:url': absoluteUrl('/consent'),
  },
  robots: { index: true, follow: true },
}

const CONTACT_EMAIL = 'privacy@malakhovai.ru'

// TODO(legal): юристу проверить формулировки про сроки реакции и почтовый адрес для письменного отзыва.

export default function ConsentPage() {
  return (
    <article className="mx-auto max-w-3xl px-4 py-10 article-body">
      <h1 className="mb-2 font-serif text-3xl font-bold text-ink md:text-4xl">
        Отзыв согласия
      </h1>
      <p className="mb-8 text-sm text-muted">Редакция от 2026-05-01 · версия 2</p>

      <h2>1. Что вы можете сделать</h2>
      <p>
        Вы вправе в любой момент отозвать своё согласие на обработку персональных данных
        и использование аналитических cookies. После отзыва Яндекс Метрика и любая другая
        аналитика на сайте загружаться не будет, пока в вашем браузере сохранён отказ.
      </p>

      <h2>2. Через сайт</h2>
      <p>
        Нажмите кнопку ниже — сайт сохранит отказ от аналитических cookies в вашем браузере
        и перезагрузит страницу. После этого будут использоваться только необходимые cookies.
      </p>
      <p>
        <RevokeConsentButton />
      </p>

      <h2>3. Через email</h2>
      <p>
        Если вы хотите запросить удаление данных или удостовериться, что ваши данные не обрабатываются,
        напишите на <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>. Мы ответим в
        течение 30 дней — это срок, установленный 152-ФЗ.
      </p>

      <h2>4. Что произойдёт</h2>
      <ul>
        <li>В браузере будет обновлён ключ <code>consent_v1</code>;</li>
        <li>Сайт сохранит режим «только необходимые cookies»;</li>
        <li>Яндекс Метрика и другая аналитика загружаться не будут;</li>
        <li>Уже собранные обезличенные данные удаляются по запросу через email.</li>
      </ul>

      <h2>5. Связанные документы</h2>
      <ul>
        <li><a href="/privacy-policy">Политика обработки персональных данных</a></li>
        <li><a href="/cookie-policy">Политика использования cookies</a></li>
      </ul>
    </article>
  )
}
