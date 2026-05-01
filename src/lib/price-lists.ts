import type { PriceList, PriceListOverride } from '@/lib/types'

// Resolution: cost>0 → cost×multiplier; cost=0,price>0 → price; both=0 → 0
export function calculateProductPrice(
  cost: number,
  price: number,
  productId: string,
  brandId: string | null,
  priceList: PriceList,
  overrides: PriceListOverride[]
): number {
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
