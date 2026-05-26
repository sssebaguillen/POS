import type { CartItem, PriceList, PriceListOverride } from '@/lib/types'

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

// Display-side wrapper around calculateProductPrice. When priceList is null (no active list),
// falls back to the variant's explicit price if present, otherwise the base price. This is the
// "what should the user see right now" entry point — use it from product cards, variant rows,
// and any non-cart display.
export function resolveDisplayPrice(args: {
  cost: number
  price: number
  productId: string
  brandId: string | null
  priceList: PriceList | null
  overrides: PriceListOverride[]
  variantPrice?: number | null
}): number {
  const { cost, price, productId, brandId, priceList, overrides, variantPrice } = args
  if (!priceList) {
    if (variantPrice != null && variantPrice > 0) return variantPrice
    return price
  }
  return calculateProductPrice(cost, price, productId, brandId, priceList, overrides, variantPrice)
}

// Cart-side wrapper. Honors `priceIsManual` (manual line overrides skip price-list math)
// and derives cost/price from the variant if present. Free-line items (product === null)
// return their stored unit_price unchanged.
export function resolveCartItemPrice(args: {
  item: CartItem
  priceList: PriceList | null
  overrides: PriceListOverride[]
}): number {
  const { item, priceList, overrides } = args
  if (!item.product) return item.unit_price
  if (item.priceIsManual || !priceList) return item.unit_price
  const isVariant = !!item.variant_id
  const cost = isVariant ? (item.variant_cost ?? 0) : item.product.cost
  const basePrice = isVariant ? (item.variant_base_price ?? item.unit_price) : item.product.price
  return resolveDisplayPrice({
    cost,
    price: basePrice,
    productId: item.product.id,
    brandId: item.product.brand_id,
    priceList,
    overrides,
    variantPrice: isVariant ? basePrice : null,
  })
}
