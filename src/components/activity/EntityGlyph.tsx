import type { ComponentType } from 'react'
import {
  SealPercent,
  Folder,
  Tray,
  Stack,
  Package,
  Receipt,
  Gear as SettingsIcon,
  ShoppingCart,
  Tag,
  Truck,
  UserGear,
  User,
} from '@phosphor-icons/react/dist/ssr'
import CategoryIconPreview from '@/components/inventory/CategoryIconPreview'
import type { ActivityLogRow, ActivityLookups } from '@/components/activity/types'

const ENTITY_GLYPH: Record<ActivityLogRow['entity_type'], ComponentType<{ size?: number; className?: string }>> = {
  sale: ShoppingCart,
  product: Package,
  category: Folder,
  brand: Tag,
  expense: Receipt,
  supplier: Truck,
  price_list: Stack,
  promotion: SealPercent,
  setting: SettingsIcon,
  operator: UserGear,
  customer: User,
  catalog_order: Tray,
}

interface EntityGlyphProps {
  row: ActivityLogRow
  lookups: ActivityLookups
}

export default function EntityGlyph({ row, lookups }: EntityGlyphProps) {
  if (row.entity_type === 'category') {
    const category = lookups.categoryMap[row.entity_id]
    if (category?.icon) {
      return (
        <CategoryIconPreview
          icon={category.icon}
          color={category.icon_color ?? 'var(--primary)'}
          size={16}
        />
      )
    }
  }

  const Icon = ENTITY_GLYPH[row.entity_type] ?? Folder
  return <Icon size={16} className="text-hint" />
}
