// Promos y ofertas — espejo TS de los helpers SQL (regla 11: mantener en sync).
//   findApplicablePromo      ↔ find_applicable_promotion
//   applyUnitPromo           ↔ apply_unit_promo
//   computeQuantityDiscount  ↔ compute_quantity_promo_discount
// Plan y semántica: docs/todo/promotions.md

export type PromotionKind = 'percent' | 'offer_price' | 'quantity'

export interface Promotion {
  id: string
  business_id: string
  name: string
  kind: PromotionKind
  percent: number | null
  offer_price: number | null
  group_size: number | null
  affected_units: number | null
  pay_percent: number | null
  product_id: string | null
  category_id: string | null
  brand_id: string | null
  starts_at: string | null
  ends_at: string | null
  is_active: boolean
  show_in_catalog: boolean
  archived_at: string | null
  created_at: string
}

export function normalizePromotion(row: Record<string, unknown>): Promotion {
  return {
    id: row.id as string,
    business_id: row.business_id as string,
    name: row.name as string,
    kind: row.kind as PromotionKind,
    percent: row.percent != null ? Number(row.percent) : null,
    offer_price: row.offer_price != null ? Number(row.offer_price) : null,
    group_size: row.group_size != null ? Number(row.group_size) : null,
    affected_units: row.affected_units != null ? Number(row.affected_units) : null,
    pay_percent: row.pay_percent != null ? Number(row.pay_percent) : null,
    product_id: (row.product_id as string | null) ?? null,
    category_id: (row.category_id as string | null) ?? null,
    brand_id: (row.brand_id as string | null) ?? null,
    starts_at: (row.starts_at as string | null) ?? null,
    ends_at: (row.ends_at as string | null) ?? null,
    is_active: Boolean(row.is_active),
    show_in_catalog: Boolean(row.show_in_catalog),
    archived_at: (row.archived_at as string | null) ?? null,
    created_at: row.created_at as string,
  }
}

const round2 = (v: number) => Math.round(v * 100) / 100

export function isPromotionLive(promo: Promotion, at: Date = new Date()): boolean {
  if (!promo.is_active || promo.archived_at !== null) return false
  if (promo.starts_at !== null && new Date(promo.starts_at) > at) return false
  if (promo.ends_at !== null && new Date(promo.ends_at) < at) return false
  return true
}

// Promo vigente más aplicable. Resolución determinística (espejo SQL): más
// específica gana (producto > categoría > marca); a igual especificidad, la más
// reciente. Sin stacking: una línea matchea UNA promo.
export function findApplicablePromo(args: {
  promotions: Promotion[]
  productId: string
  categoryId: string | null
  brandId: string | null
  at?: Date
}): Promotion | null {
  const { promotions, productId, categoryId, brandId, at = new Date() } = args
  const specificity = (p: Promotion) => (p.product_id !== null ? 0 : p.category_id !== null ? 1 : 2)
  let best: Promotion | null = null
  for (const promo of promotions) {
    if (!isPromotionLive(promo, at)) continue
    const matches =
      (promo.product_id !== null && promo.product_id === productId) ||
      (promo.category_id !== null && promo.category_id === categoryId) ||
      (promo.brand_id !== null && promo.brand_id === brandId)
    if (!matches) continue
    if (
      best === null ||
      specificity(promo) < specificity(best) ||
      (specificity(promo) === specificity(best) && promo.created_at > best.created_at)
    ) {
      best = promo
    }
  }
  return best
}

// Precio unitario con promo unitaria aplicada. percent → precio × (1 − pct/100);
// offer_price → min(oferta, precio): una oferta nunca SUBE el precio.
// quantity (u otra) → el unitario no se toca.
export function applyUnitPromo(promo: Promotion, unitPrice: number): number {
  if (promo.kind === 'percent' && promo.percent !== null && promo.percent > 0) {
    return round2(unitPrice * (1 - promo.percent / 100))
  }
  if (promo.kind === 'offer_price' && promo.offer_price !== null && promo.offer_price > 0) {
    return Math.min(round2(promo.offer_price), round2(unitPrice))
  }
  return round2(unitPrice)
}

// Descuento de línea de una promo de cantidad:
// floor(qty / N) × K × unit_price × (1 − P/100)
export function computeQuantityDiscount(promo: Promotion, unitPrice: number, quantity: number): number {
  const { group_size: n, affected_units: k, pay_percent: p } = promo
  if (promo.kind !== 'quantity' || n === null || n < 2 || k === null || k < 1) return 0
  if (quantity < n || unitPrice <= 0) return 0
  return Math.max(round2(Math.floor(quantity / n) * k * unitPrice * (1 - (p ?? 0) / 100)), 0)
}

export interface PromoLineResult {
  unitPrice: number
  promoDiscount: number
  promotionId: string | null
  /** Precio unitario sin promo (para tachado); igual a unitPrice si no aplicó. */
  originalUnitPrice: number
}

// Aplica la promo a una línea completa. Promos unitarias bajan el unitario
// (total = qty × unitario nuevo); promos de cantidad dejan el unitario intacto
// y descuentan a nivel línea (total = qty × unitario − descuento).
export function resolvePromoLine(args: {
  promo: Promotion | null
  unitPrice: number
  quantity: number
}): PromoLineResult {
  const { promo, unitPrice, quantity } = args
  const none: PromoLineResult = {
    unitPrice,
    promoDiscount: 0,
    promotionId: null,
    originalUnitPrice: unitPrice,
  }
  if (!promo || unitPrice <= 0 || quantity <= 0) return none

  if (promo.kind === 'quantity') {
    const discount = computeQuantityDiscount(promo, unitPrice, quantity)
    if (discount <= 0) return none
    return { unitPrice, promoDiscount: discount, promotionId: promo.id, originalUnitPrice: unitPrice }
  }

  const promoUnit = applyUnitPromo(promo, unitPrice)
  if (promoUnit >= unitPrice) return none
  return {
    unitPrice: promoUnit,
    promoDiscount: round2(quantity * (unitPrice - promoUnit)),
    promotionId: promo.id,
    originalUnitPrice: unitPrice,
  }
}

// Etiqueta corta para badges/ticket: "-20%", "Oferta", "2x1", "3x2", "2da un. -50%"
export function promoBadgeLabel(promo: Promotion): string {
  if (promo.kind === 'percent') return `-${promo.percent}%`
  if (promo.kind === 'offer_price') return 'Oferta'
  const n = promo.group_size ?? 0
  const k = promo.affected_units ?? 0
  const p = promo.pay_percent ?? 0
  if (p === 0) return `${n}x${n - k}`
  if (n === 2 && k === 1) return `2da un. -${100 - p}%`
  return `${n}x${n - k} -${100 - p}%`
}
