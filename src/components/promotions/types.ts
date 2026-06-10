import type { Promotion } from '@/lib/promotions'
import { formatMoney } from '@/lib/format'

export interface PromoProductRef {
  id: string
  name: string
  has_variants: boolean
  category_id: string | null
  brand_id: string | null
}

export interface NamedRef {
  id: string
  name: string
}

export type PromotionStatus = 'activa' | 'programada' | 'vencida' | 'pausada' | 'archivada'

export function getPromotionStatus(promo: Promotion, at: Date = new Date()): PromotionStatus {
  if (promo.archived_at !== null) return 'archivada'
  if (!promo.is_active) return 'pausada'
  if (promo.ends_at !== null && new Date(promo.ends_at) < at) return 'vencida'
  if (promo.starts_at !== null && new Date(promo.starts_at) > at) return 'programada'
  return 'activa'
}

// Descripción en lenguaje natural para listados y previews.
export function describePromotion(promo: Promotion): string {
  if (promo.kind === 'percent') return `${promo.percent}% de descuento`
  if (promo.kind === 'offer_price') {
    return promo.offer_price != null && promo.offer_price > 0
      ? `Precio de oferta: ${formatMoney(promo.offer_price)}`
      : 'Precio de oferta'
  }
  const n = promo.group_size ?? 0
  const k = promo.affected_units ?? 0
  const p = promo.pay_percent ?? 0
  if (p === 0) return `Lleva ${n}, paga ${n - k}`
  if (n === 2 && k === 1) return `2da unidad al ${p}%`
  return `Cada ${n} unidades, ${k} al ${p}%`
}

// Productos cubiertos por el alcance de una promo (para el aviso de solapamiento).
export function coveredProductIds(
  scope: { product_id: string | null; category_id: string | null; brand_id: string | null },
  products: PromoProductRef[]
): Set<string> {
  const ids = new Set<string>()
  if (scope.product_id) {
    ids.add(scope.product_id)
    return ids
  }
  for (const p of products) {
    if (scope.category_id && p.category_id === scope.category_id) ids.add(p.id)
    if (scope.brand_id && p.brand_id === scope.brand_id) ids.add(p.id)
  }
  return ids
}
