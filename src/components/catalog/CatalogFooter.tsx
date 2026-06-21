'use client'

import Image from 'next/image'
import Link from 'next/link'
import { SealPercent, ChatCircle } from '@phosphor-icons/react/dist/ssr'
import type { CatalogBusiness } from '@/components/catalog/types'

interface CatalogFooterProps {
  business: CatalogBusiness
  slug: string
}

export default function CatalogFooter({ business, slug }: CatalogFooterProps) {
  const whatsapp = business.whatsapp?.trim() ?? ''

  return (
    <footer className="mt-12 border-t border-border bg-card">
      {/* Asimétrico e identidad-primero: el bloque del negocio ocupa el ancho y
          el contacto vive ahí mismo; la navegación queda como columna fina. Sin
          la grilla de 3 columnas iguales que hacía ver a un local chico como una
          cadena. */}
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-8 px-4 py-10 md:flex-row md:items-start md:justify-between md:gap-12 md:px-6">
        {/* Identidad + contacto */}
        <div className="min-w-0 md:max-w-md">
          <div className="flex items-center gap-2.5">
            {business.logoUrl ? (
              <span className="relative block h-10 w-10 shrink-0 overflow-hidden rounded-xl border border-border/70">
                <Image
                  src={business.logoUrl}
                  alt={business.name}
                  fill
                  className="object-cover"
                  sizes="40px"
                />
              </span>
            ) : (
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary text-base font-bold text-primary-foreground">
                {business.name.charAt(0).toUpperCase()}
              </span>
            )}
            <p className="truncate text-base font-bold text-foreground">{business.name}</p>
          </div>
          {business.description && (
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{business.description}</p>
          )}
          <div className="mt-4">
            {whatsapp ? (
              <a
                href={`https://wa.me/${whatsapp}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-2 text-sm font-medium text-foreground transition-[transform,background-color,border-color,color] duration-150 ease-[var(--ease-out)] hover:border-primary/40 hover:text-primary active:scale-[0.97]"
              >
                <ChatCircle className="h-4 w-4" />
                Escribir por WhatsApp
              </a>
            ) : (
              <p className="text-sm text-muted-foreground">
                Este negocio aún no publicó datos de contacto. Puedes hacer tu pedido desde el carrito.
              </p>
            )}
          </div>
        </div>

        {/* Navegación — columna fina */}
        <nav aria-label="Navegación del catálogo" className="shrink-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Catálogo
          </p>
          <ul className="mt-3 space-y-2">
            <li>
              <Link
                href={`/catalogo/${slug}`}
                className="text-sm text-muted-foreground transition-colors duration-150 hover:text-foreground"
              >
                Inicio
              </Link>
            </li>
            <li>
              <Link
                href={`/catalogo/${slug}/promotions`}
                className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors duration-150 hover:text-foreground"
              >
                <SealPercent className="h-3.5 w-3.5" />
                Ofertas
              </Link>
            </li>
          </ul>
        </nav>
      </div>
    </footer>
  )
}
