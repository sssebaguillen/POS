'use client'

import {
  ShoppingCart, Tag, Package, Orange, Coffee, Cow, Drop, Carrot,
  Cookie, Hamburger, Wine, BeerBottle, Pill, TShirt, Scissors, Wrench, Lightning, Sparkle,
  PawPrint, Baby, Book, MusicNotes, GameController, Barbell, Flower, House, Car, Bicycle,
  Stethoscope, GraduationCap, Gift, Star,
} from '@phosphor-icons/react/dist/ssr'
// IconProps no se re-exporta desde /dist/ssr; el import type-only se borra en
// compilación (no ejecuta createContext), así que tomarlo del entry principal es seguro.
import type { IconProps } from '@phosphor-icons/react'

const ICON_MAP = {
  ShoppingCart, Tag, Package, Apple: Orange, Coffee, Beef: Cow, Milk: Drop, Carrot,
  Cookie, Sandwich: Hamburger, Wine, Beer: BeerBottle, Pill, Shirt: TShirt, Scissors, Wrench, Zap: Lightning, Sparkles: Sparkle,
  PawPrint, Baby, Book, Music: MusicNotes, Gamepad2: GameController, Dumbbell: Barbell, Flower2: Flower, Home: House, Car, Bike: Bicycle,
  Stethoscope, GraduationCap, Gift, Star,
} as const

export type IconName = keyof typeof ICON_MAP

export function DynamicIcon({ name, ...props }: { name: string } & IconProps) {
  const LucideIcon = ICON_MAP[name as IconName]
  if (!LucideIcon) return <Tag {...props} />
  return <LucideIcon {...props} />
}

function isEmoji(icon: string): boolean {
  return /[^\x00-\x7F]/.test(icon) || icon.length <= 2
}

type CategoryIconPreviewProps = {
  icon: string
  color?: string
  size?: number
  className?: string
}

export default function CategoryIconPreview({
  icon,
  color = '#7a3e10',
  size = 20,
  className,
}: CategoryIconPreviewProps) {
  if (isEmoji(icon)) {
    return (
      <span className={className} style={{ fontSize: size, lineHeight: 1 }}>
        {icon}
      </span>
    )
  }
  return <DynamicIcon name={icon} size={size} color={color} className={className} />
}
