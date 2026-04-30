'use client'

import { useMemo, useState } from 'react'
import { Plus } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import PageHeader from '@/components/shared/PageHeader'
import SuppliersPanel from './SuppliersPanel'
import type { Supplier } from './types'

interface Props {
  businessId: string
  initialSuppliers: Supplier[]
}

export default function ProvidersView({ businessId, initialSuppliers }: Props) {
  const supabase = useMemo(() => createClient(), [])
  const [suppliers, setSuppliers] = useState<Supplier[]>(initialSuppliers)
  const [showForm, setShowForm] = useState(false)

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      <PageHeader
        title="Proveedores"
        breadcrumbs={[{ label: 'Gastos', href: '/expenses' }]}
      >
        <Button
          onClick={() => setShowForm(prev => !prev)}
          className="h-9 px-4 rounded-lg text-sm font-semibold bg-primary hover:bg-primary/90 text-primary-foreground gap-2 shrink-0"
        >
          <Plus size={15} />
          Nuevo proveedor
        </Button>
      </PageHeader>
      <div className="flex-1 overflow-y-auto">
        <div className="px-5 pt-4 pb-6">
          <SuppliersPanel
            suppliers={suppliers}
            businessId={businessId}
            supabaseClient={supabase}
            onSuppliersChange={setSuppliers}
            showForm={showForm}
            onShowFormChange={setShowForm}
          />
        </div>
      </div>
    </div>
  )
}
