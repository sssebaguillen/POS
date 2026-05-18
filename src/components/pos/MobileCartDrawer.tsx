'use client'

import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet'
import CartPanel from '@/components/pos/CartPanel'
import type { PriceList, PriceListOverride } from '@/lib/types'
import type { Permissions } from '@/lib/operator'

interface Props {
  open: boolean
  onClose: () => void
  businessId: string | null
  businessName: string
  freeLineEnabled: boolean
  activePriceList: PriceList | null
  priceListOverrides: PriceListOverride[]
  operatorId: string | null
  permissions: Permissions
}

export default function MobileCartDrawer({
  open,
  onClose,
  businessId,
  businessName,
  freeLineEnabled,
  activePriceList,
  priceListOverrides,
  operatorId,
  permissions,
}: Props) {
  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o) onClose() }}>
      <SheetContent
        side="bottom"
        className="h-[90dvh] p-0 rounded-t-2xl flex flex-col bg-surface"
        showCloseButton={false}
      >
        <SheetTitle className="sr-only">Carrito de venta</SheetTitle>
        <div className="flex justify-center pt-2 pb-1 shrink-0">
          <div className="h-1.5 w-10 rounded-full bg-edge" />
        </div>
        <div className="flex-1 min-h-0 flex flex-col">
          <CartPanel
            businessId={businessId}
            businessName={businessName}
            freeLineEnabled={freeLineEnabled}
            activePriceList={activePriceList}
            priceListOverrides={priceListOverrides}
            operatorId={operatorId}
            permissions={permissions}
          />
        </div>
      </SheetContent>
    </Sheet>
  )
}
