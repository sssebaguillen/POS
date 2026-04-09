export interface InventoryCategory {
  id: string
  name: string
  icon: string
}

export interface InventoryBrand {
  id: string
  name: string
}

export type SortField = 'name' | 'price' | 'cost' | 'stock' | 'margin'
export type SortDir = 'asc' | 'desc'
export interface SortOption {
  field: SortField
  dir: SortDir
}

export interface InventoryProduct {
  id: string
  name: string
  price: number
  cost: number
  stock: number
  min_stock: number
  is_active: boolean
  show_in_catalog?: boolean | null
  category_id: string | null
  sku: string | null
  brand_id?: string | null
  brand?: {
    id: string
    name: string
  } | null
  barcode: string | null
  image_url?: string | null
  image_source?: 'upload' | 'url' | null
  categories?: {
    name: string
    icon: string
  } | null
}

export interface ProductCardProps {
  product: InventoryProduct
  readOnly: boolean
  loadingId: string | null
  selectionMode: boolean
  isSelected: boolean
  onToggleSelect: (id: string) => void
  onEdit: (product: InventoryProduct) => void
  onToggleActive: (product: InventoryProduct) => void
  onDelete: (product: InventoryProduct) => void
  onQuickCategory: (product: InventoryProduct) => void
  onQuickBrand: (product: InventoryProduct) => void
}

export function getStatus(product: InventoryProduct): 'ok' | 'low' | 'out' | 'discontinued' {
  if (!product.is_active) return 'discontinued'
  if (product.stock <= 0) return 'out'
  if (product.stock <= product.min_stock) return 'low'
  return 'ok'
}

export const statusConfig = {
  ok: {
    label: 'EN STOCK',
    border: 'border-emerald-300 dark:border-emerald-800/50',
    hoverBorder: 'hover:border-emerald-300 dark:hover:border-emerald-800/50',
    badge: 'bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800/50',
    bar: 'bg-emerald-500',
  },
  low: {
    label: 'STOCK BAJO',
    border: 'border-amber-300 dark:border-amber-800/50',
    hoverBorder: 'hover:border-amber-300 dark:hover:border-amber-800/50',
    badge: 'bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-800/50',
    bar: 'bg-amber-500',
  },
  out: {
    label: 'SIN STOCK',
    border: 'border-red-300 dark:border-red-800/50 border-dashed',
    hoverBorder: 'hover:border-red-300 dark:hover:border-red-800/50',
    badge: 'bg-red-50 dark:bg-red-950/30 text-red-600 dark:text-red-400 border border-red-200 dark:border-red-800/50',
    bar: 'bg-red-500',
  },
  discontinued: {
    label: 'DISCONTINUADO',
    border: 'border-faint border-dashed',
    hoverBorder: 'hover:border-muted-foreground/40',
    badge: 'bg-muted text-muted-foreground',
    bar: 'bg-muted-foreground',
  },
} as const