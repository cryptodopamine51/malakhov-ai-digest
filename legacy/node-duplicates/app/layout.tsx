import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'
import Header from '../components/Header'
import Footer from '../components/Footer'

const inter = Inter({
  subsets: ['latin', 'cyrillic'],
  display: 'swap',
})

export const metadata: Metadata = {
  title: {
    default: 'Malakhov AI Дайджест',
    template: '%s | Malakhov AI Дайджест',
  },
  description: 'Лучшие новости об искусственном интеллекте на русском языке',
  openGraph: {
    siteName: 'Malakhov AI Дайджест',
    locale: 'ru_RU',
    type: 'website',
    images: ['/og-default.png'],
  },
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="ru" className={inter.className}>
      <body className="flex min-h-screen flex-col">
        <Header />
        <main className="flex-1">{children}</main>
        <Footer />
      </body>
    </html>
  )
}
