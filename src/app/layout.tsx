// src/app/layout.tsx
import type { Metadata } from 'next'
import { DM_Sans, Sora } from 'next/font/google'
import './globals.css'
import { ThemeProvider } from '@/components/shared/theme'
import { SpeedInsights } from "@vercel/speed-insights/next"

const dmSans = DM_Sans({
  subsets: ['latin'],
  display: 'swap',
  preload: true,
  variable: '--font-dm-sans',
  weight: ['400', '500', '600', '700'],
})

const sora = Sora({
  subsets: ['latin'],
  display: 'swap',
  preload: true,
  variable: '--font-sora',
  weight: ['400', '500', '600'],
})

export const metadata: Metadata = {
  title: 'Pulsar POS',
  description: 'Sistema de punto de venta para PyMEs',
}

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="es" className={`${dmSans.variable} ${sora.variable}`} suppressHydrationWarning>
      <body className="font-sans antialiased">
        <ThemeProvider>{children}</ThemeProvider>
        <SpeedInsights />
      </body>
    </html>
  )
}
