import type { Metadata } from 'next'
import { Onest, Golos_Text, IBM_Plex_Mono } from 'next/font/google'
import './globals.css'
import Header from '../src/components/Header'
import Footer from '../src/components/Footer'
import Analytics from '../src/components/Analytics'
import ConsentManager from '../src/components/ConsentManager'
import { SITE_DESCRIPTION, SITE_NAME, SITE_URL } from '../lib/site'

const onest = Onest({
  subsets: ['latin', 'cyrillic'],
  variable: '--font-onest',
  display: 'swap',
  weight: ['400', '500', '600', '700', '800', '900'],
})

const golos = Golos_Text({
  subsets: ['latin', 'cyrillic'],
  variable: '--font-golos',
  display: 'swap',
})

const ibmMono = IBM_Plex_Mono({
  subsets: ['latin', 'cyrillic'],
  variable: '--font-mono',
  display: 'swap',
  weight: ['400', '500', '600', '700'],
})

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: SITE_NAME,
    template: `%s | ${SITE_NAME}`,
  },
  description: SITE_DESCRIPTION,
  verification: {
    yandex: '6b43a6ebf41ca61b',
  },
  alternates: {
    canonical: SITE_URL,
    types: {
      'application/rss+xml': `${SITE_URL}/rss.xml`,
    },
  },
  openGraph: {
    siteName: SITE_NAME,
    title: SITE_NAME,
    description: SITE_DESCRIPTION,
    locale: 'ru_RU',
    type: 'website',
    url: SITE_URL,
    images: ['/og-default.png'],
  },
  twitter: {
    card: 'summary_large_image',
    title: SITE_NAME,
    description: SITE_DESCRIPTION,
    images: ['/og-default.png'],
  },
  other: {
    'twitter:url': SITE_URL,
  },
  robots: {
    index: true,
    follow: true,
  },
}

const METRIKA_ID = process.env.NEXT_PUBLIC_METRIKA_ID

const themeScript = `
(function(){
  try {
    var t = localStorage.getItem('theme');
    if (t === 'dark') {
      document.documentElement.setAttribute('data-theme', 'dark');
    }
  } catch(e){}
})();
`

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  const jsonLd = [
    {
      '@context': 'https://schema.org',
      '@type': 'Organization',
      name: SITE_NAME,
      url: SITE_URL,
      logo: `${SITE_URL}/og-default.png`,
    },
    {
      '@context': 'https://schema.org',
      '@type': 'WebSite',
      name: SITE_NAME,
      url: SITE_URL,
      inLanguage: 'ru-RU',
      description: SITE_DESCRIPTION,
      publisher: {
        '@type': 'Organization',
        name: SITE_NAME,
        url: SITE_URL,
      },
    },
  ]

  return (
    <html
      lang="ru"
      className={`${onest.variable} ${golos.variable} ${ibmMono.variable}`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
      </head>
      <body className="font-sans flex min-h-screen flex-col bg-base text-ink">
        <Header />
        <main className="flex-1">{children}</main>
        <Footer />
        <ConsentManager />
        {METRIKA_ID && <Analytics metrikaId={METRIKA_ID} />}
      </body>
    </html>
  )
}
