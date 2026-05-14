'use client'

import {
  ShoppingCart, Tag, Package, Apple, Coffee, Beef, Milk, Carrot,
  Cookie, Sandwich, Wine, Beer, Pill, Shirt, Scissors, Wrench, Zap, Sparkles,
  PawPrint, Baby, Book, Music, Gamepad2, Dumbbell, Flower2, Home, Car, Bike,
  Stethoscope, GraduationCap, Gift, Star,
} from 'lucide-react'
import type { LucideProps } from 'lucide-react'

const ICON_MAP = {
  ShoppingCart, Tag, Package, Apple, Coffee, Beef, Milk, Carrot,
  Cookie, Sandwich, Wine, Beer, Pill, Shirt, Scissors, Wrench, Zap, Sparkles,
  PawPrint, Baby, Book, Music, Gamepad2, Dumbbell, Flower2, Home, Car, Bike,
  Stethoscope, GraduationCap, Gift, Star,
} as const

export type IconName = keyof typeof ICON_MAP

export function DynamicIcon({ name, ...props }: { name: string } & LucideProps) {
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
