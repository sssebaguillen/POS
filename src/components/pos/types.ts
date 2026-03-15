import type { Product } from '@/lib/types'

export interface PosCategory {
  id: string
  name: string
  icon: string
}

export interface ProductWithCategory extends Product {
  brand?: { id: string; name: string } | null
  categories?: { name: string; icon: string } | null
}