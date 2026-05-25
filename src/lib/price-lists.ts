import type { PriceList, PriceListOverride } from '@/lib/types'

// Resolution:
// - variantPrice > 0           → variantPrice (precio explícito de variante manda)
// - cost > 0                   → cost × multiplier (override producto > override marca > lista)
// - cost = 0 && price > 0      → price
// - cost = 0 && price = 0      → 0
//
// Bajo la regla "precio explícito de variante manda" la lista de precios NO modifica
// variantes con precio > 0. Si querés que la lista aplique a la variante, dejá su
// price en 0 y un cost > 0 — entonces se calcula con el multiplicador (y los overrides
// del producto/marca del padre, si existen).
export function calculateProductPrice(
  cost: number,
  price: number,
  productId: string,
  brandId: string | null,
  priceList: PriceList,
  overrides: PriceListOverride[],
  variantPrice?: number | null
): number {
  if (variantPrice != null && variantPrice > 0) return variantPrice
  if (cost <= 0) return price
  const listOverrides = overrides.filter(o => o.price_list_id === priceList.id)
  const productOverride = listOverrides.find(o => o.product_id === productId) ?? null
  const brandOverride =
    productOverride || !brandId
      ? null
      : (listOverrides.find(o => o.product_id === null && o.brand_id === brandId) ?? null)
  const multiplier = productOverride?.multiplier ?? brandOverride?.multiplier ?? priceList.multiplier
  return cost * multiplier
}
