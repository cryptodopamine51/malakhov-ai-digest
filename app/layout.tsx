import type { Metadata } from 'next'
import { Onest, Golos_Text, IBM_Plex_Mono } from 'next/font/google'
import Script from 'next/script'
import './globals.css'
import Header from '../src/components/Header'
import Footer from '../src/components/Footer'

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

const SITE_URL = 'https://news.malakhovai.ru'

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: 'Malakhov AI Дайджест',
    template: '%s | Malakhov AI Дайджест',
  },
  description: 'Лучшие новости об искусственном интеллекте на русском языке',
  alternates: {
    canonical: SITE_URL,
  },
  openGraph: {
    siteName: 'Malakhov AI Дайджест',
    locale: 'ru_RU',
    type: 'website',
    images: ['/og-default.png'],
  },
}

const METRIKA_ID = process.env.NEXT_PUBLIC_METRIKA_ID

const themeScript = `
(function(){
  try {
    var t = localStorage.getItem('theme');
    if (t === 'dark' || (!t && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
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
  return (
    <html
      lang="ru"
      className={`${onest.variable} ${golos.variable} ${ibmMono.variable}`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="font-sans flex min-h-screen flex-col bg-base text-ink">
        <Header />
        <main className="flex-1">{children}</main>
        <Footer />
        {METRIKA_ID && (
          <Script id="yandex-metrika" strategy="afterInteractive">
            {`(function(m,e,t,r,i,k,a){m[i]=m[i]||function(){(m[i].a=m[i].a||[]).push(arguments)};m[i].l=1*new Date();for(var j=0;j<document.scripts.length;j++){if(document.scripts[j].src===r){return;}}k=e.createElement(t),a=e.getElementsByTagName(t)[0],k.async=1,k.src=r,a.parentNode.insertBefore(k,a)})(window,document,'script','https://mc.yandex.ru/metrika/tag.js','ym');ym(${METRIKA_ID},'init',{clickmap:true,trackLinks:true,accurateTrackBounce:true,webvisor:true});`}
          </Script>
        )}
      </body>
    </html>
  )
}
