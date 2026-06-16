export interface InventoryCategory {
  id: string
  name: string
  icon: string
  icon_color?: string
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
  has_variants?: boolean
  variant_count?: number
  default_variant_id?: string | null
  sales_count?: number
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
  onToggleCatalog: (product: InventoryProduct) => void
  onDelete: (product: InventoryProduct) => void
  onQuickCategory: (product: InventoryProduct) => void
  onQuickBrand: (product: InventoryProduct) => void
  onViewStock: (productId: string) => void
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
    border: 'border-success/40',
    hoverBorder: 'hover:border-success/40',
    badge: 'bg-success/10 text-success border border-success/20',
    bar: 'bg-success',
  },
  low: {
    label: 'STOCK BAJO',
    border: 'border-warning/40',
    hoverBorder: 'hover:border-warning/40',
    badge: 'bg-warning/10 text-warning border border-warning/20',
    bar: 'bg-warning',
  },
  out: {
    label: 'SIN STOCK',
    border: 'border-destructive/40 dark:border-destructive/50 border-dashed',
    hoverBorder: 'hover:border-destructive/40 dark:hover:border-destructive/50',
    badge: 'bg-destructive/10 dark:bg-destructive/20 text-destructive border border-destructive/30',
    bar: 'bg-destructive',
  },
  discontinued: {
    label: 'DISCONTINUADO',
    border: 'border-faint border-dashed',
    hoverBorder: 'hover:border-muted-foreground/40',
    badge: 'bg-muted text-muted-foreground',
    bar: 'bg-input',
  },
} as const