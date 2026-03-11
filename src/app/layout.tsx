import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'POS LATAM',
  description: 'Sistema de punto de venta para PyMEs',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  )
}
