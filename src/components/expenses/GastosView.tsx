'use client'

import { useState, useMemo } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { Plus } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import PageHeader from '@/components/shared/PageHeader'
import DateRangeFilter, { type DateRangePeriod } from '@/components/shared/DateRangeFilter'
import ExportCSVButton from '@/components/shared/ExportCSVButton'
import ExpenseSummaryCards from './ExpenseSummaryCards'
import ExpensesTable from './ExpensesTable'
import NewExpensePanel from './NewExpensePanel'
import SuppliersPanel from './SuppliersPanel'
import {
  EXPENSE_CATEGORY_LABELS,
  EXPENSE_CATEGORIES,
  type Expense,
  type Supplier,
  type BusinessBalance,
  type ExpenseCategory,
} from './types'

interface Props {
  expenses: Expense[]
  balance: BusinessBalance
  suppliers: Supplier[]
  businessId: string
  period: string
  from?: string
  to?: string
  category?: string
}

export default function GastosView({ expenses: initialExpenses, balance, suppliers: initialSuppliers, businessId, period, from, to, category }: Props) {
  const router = useRouter()
  const pathname = usePathname()
  const supabase = useMemo(() => createClient(), [])
  const [showSuppliers, setShowSuppliers] = useState(false)
  const [panelOpen, setPanelOpen] = useState(false)
  const [expenses, setExpenses] = useState<Expense[]>(initialExpenses)
  const [suppliers, setSuppliers] = useState<Supplier[]>(initialSuppliers)

  function navigate(newPeriod: DateRangePeriod, newFrom?: string, newTo?: string) {
    const params = new URLSearchParams()
    params.set('period', newPeriod)
    if (newPeriod === 'personalizado' && newFrom && newTo) {
      params.set('from', newFrom)
      params.set('to', newTo)
    }
    if (category) params.set('category', category)
    router.push(`${pathname}?${params.toString()}`)
  }

  function handleExpenseDeleted(id: string) {
    setExpenses(prev => prev.filter(e => e.id !== id))
  }

  function handleExpenseCreated() {
    router.refresh()
  }

  const csvData = useMemo(() =>
    expenses.map(e => ({
      Fecha: e.date,
      Categoría: EXPENSE_CATEGORY_LABELS[e.category],
      Descripción: e.description,
      Proveedor: e.supplier?.name ?? '',
      Monto: e.amount,
      Adjunto: e.attachment_url ?? '',
    })),
    [expenses]
  )

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      <PageHeader title="Gastos">
        {!showSuppliers && (
          <Button
            onClick={() => setPanelOpen(true)}
            size="sm"
            className="rounded-lg text-xs bg-primary hover:bg-primary/90 text-primary-foreground gap-2"
          >
            <Plus size={15} />
            Nuevo gasto
          </Button>
        )}
      </PageHeader>

      <div className="flex-1 overflow-y-auto">
        <div className="px-5 pt-4 pb-6 space-y-5">
          {!showSuppliers && (
            <>
              <DateRangeFilter
                value={period as DateRangePeriod}
                from={from}
                to={to}
                onChange={navigate}
              />

              {/* Category filter */}
              <div className="pill-tabs flex-wrap">
                <button
                  onClick={() => navigate(period as DateRangePeriod, from, to)}
                  className={`pill-tab${!category ? ' pill-tab-active' : ''}`}
                >
                  Todos
                </button>
                {EXPENSE_CATEGORIES.map(cat => (
                  <button
                    key={cat}
                    onClick={() => {
                      const params = new URLSearchParams()
                      params.set('period', period)
                      params.set('category', cat)
                      if (from) params.set('from', from)
                      if (to) params.set('to', to)
                      router.push(`${pathname}?${params.toString()}`)
                    }}
                    className={`pill-tab${category === cat ? ' pill-tab-active' : ''}`}
                  >
                    {EXPENSE_CATEGORY_LABELS[cat as ExpenseCategory]}
                  </button>
                ))}
              </div>

              <ExpenseSummaryCards balance={balance} />

              <div className="flex items-center justify-between">
                <button
                  onClick={() => setShowSuppliers(true)}
                  className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                >
                  Gestionar proveedores →
                </button>
                <ExportCSVButton data={csvData} filename="gastos" label="Exportar" />
              </div>

              <ExpensesTable
                expenses={expenses}
                businessId={businessId}
                supabaseClient={supabase}
                onDeleted={handleExpenseDeleted}
              />
            </>
          )}

          {showSuppliers && (
            <>
              <button
                onClick={() => setShowSuppliers(false)}
                className="text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                ← Volver a Gastos
              </button>
              <SuppliersPanel
                suppliers={suppliers}
                businessId={businessId}
                supabaseClient={supabase}
                onSuppliersChange={setSuppliers}
              />
            </>
          )}
        </div>
      </div>

      {panelOpen && (
        <NewExpensePanel
          businessId={businessId}
          supabaseClient={supabase}
          onCreated={handleExpenseCreated}
          onClose={() => setPanelOpen(false)}
        />
      )}
    </div>
  )
}
