'use client'

import Image from 'next/image'
import Link from 'next/link'
import { BadgePercent, MessageCircle } from 'lucide-react'
import type { CatalogBusiness } from '@/components/catalog/types'

interface CatalogFooterProps {
  business: CatalogBusiness
  slug: string
}

export default function CatalogFooter({ business, slug }: CatalogFooterProps) {
  const whatsapp = business.whatsapp?.trim() ?? ''

  return (
    <footer className="mt-10 border-t border-border bg-card">
      <div className="mx-auto grid w-full max-w-7xl gap-8 px-4 py-8 md:grid-cols-3 md:px-6 md:py-10">
        {/* Identidad del negocio */}
        <div className="min-w-0">
          <div className="flex items-center gap-2.5">
            {business.logoUrl ? (
              <span className="relative block h-9 w-9 shrink-0 overflow-hidden rounded-lg border border-border/70">
                <Image
                  src={business.logoUrl}
                  alt={business.name}
                  fill
                  unoptimized
                  className="object-cover"
                  sizes="36px"
                />
              </span>
            ) : (
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary text-sm font-bold text-primary-foreground">
                {business.name.charAt(0).toUpperCase()}
              </span>
            )}
            <p className="truncate text-base font-bold text-foreground">{business.name}</p>
          </div>
          {business.description && (
            <p className="mt-3 text-sm text-muted-foreground">{business.description}</p>
          )}
        </div>

        {/* Navegación */}
        <nav aria-label="Navegación del catálogo">
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
                <BadgePercent className="h-3.5 w-3.5" />
                Ofertas
              </Link>
            </li>
          </ul>
        </nav>

        {/* Contacto */}
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Contacto
          </p>
          {whatsapp ? (
            <a
              href={`https://wa.me/${whatsapp}`}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-3 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors duration-150 hover:text-foreground"
            >
              <MessageCircle className="h-3.5 w-3.5" />
              Escribir por WhatsApp
            </a>
          ) : (
            <p className="mt-3 text-sm text-muted-foreground">
              Este negocio aún no publicó datos de contacto. Puedes hacer tu pedido desde el carrito.
            </p>
          )}
        </div>
      </div>
    </footer>
  )
}
