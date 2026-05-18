'use client'

import { ShoppingCart } from 'lucide-react'
import { useCartStore } from '@/lib/store/cart.store'
import { formatMoney } from '@/lib/format'

interface Props {
  onOpen: () => void
}

export default function CartFAB({ onOpen }: Props) {
  const itemCount = useCartStore(s => s.items.length)
  const total = useCartStore(s => s.total())

  const isEmpty = itemCount === 0

  return (
    <button
      type="button"
      onClick={onOpen}
      aria-hidden={isEmpty}
      tabIndex={isEmpty ? -1 : 0}
      aria-label="Abrir carrito"
      className={[
        'fixed right-4 z-50 flex items-center gap-2 px-4 py-3 rounded-full bg-primary text-primary-foreground shadow-lg hover:bg-primary/90 font-semibold text-sm',
        'transition-all duration-300 ease-out',
        isEmpty
          ? 'opacity-0 translate-y-4 pointer-events-none scale-95'
          : 'opacity-100 translate-y-0 pointer-events-auto scale-100',
      ].join(' ')}
      style={{ bottom: 'calc(1.5rem + env(safe-area-inset-bottom))' }}
    >
      <ShoppingCart size={18} />
      <span>{itemCount}</span>
      <span className="opacity-70">·</span>
      <span>{formatMoney(total)}</span>
    </button>
  )
}
