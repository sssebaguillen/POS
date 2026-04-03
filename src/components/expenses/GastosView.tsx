'use client'

import { useMemo, useRef, useState } from 'react'
import { usePathname } from 'next/navigation'
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
  period: DateRangePeriod
  from?: string
  to?: string
}

function resolveDateRange(
  period: DateRangePeriod,
  from?: string,
  to?: string
): { from: string | null; to: string | null } {
  if (period === 'personalizado' || period === 'trimestre' || period === 'año') {
    return {
      from: from ?? null,
      to: to ?? null,
    }
  }

  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  const today = `${year}-${month}-${day}`

  if (period === 'hoy') {
    return { from: today, to: today }
  }

  if (period === 'semana') {
    const start = new Date(now)
    const weekday = start.getDay()
    const diff = weekday === 0 ? -6 : 1 - weekday
    start.setDate(start.getDate() + diff)

    const startYear = start.getFullYear()
    const startMonth = String(start.getMonth() + 1).padStart(2, '0')
    const startDay = String(start.getDate()).padStart(2, '0')

    return {
      from: `${startYear}-${startMonth}-${startDay}`,
      to: today,
    }
  }

  return {
    from: `${year}-${month}-01`,
    to: today,
  }
}

function buildDateParams(period: DateRangePeriod, from?: string, to?: string): string {
  const params = new URLSearchParams()
  params.set('period', period)

  if ((period === 'personalizado' || period === 'trimestre' || period === 'año') && from && to) {
    params.set('from', from)
    params.set('to', to)
  }

  return params.toString()
}

export default function GastosView({
  expenses: initialExpenses,
  balance: initialBalance,
  suppliers: initialSuppliers,
  businessId,
  period: initialPeriod,
  from: initialFrom,
  to: initialTo,
}: Props) {
  const pathname = usePathname()
  const supabase = useMemo(() => createClient(), [])
  const [showSuppliers, setShowSuppliers] = useState(false)
  const [panelOpen, setPanelOpen] = useState(false)
  const [period, setPeriod] = useState<DateRangePeriod>(initialPeriod)
  const [from, setFrom] = useState(initialFrom)
  const [to, setTo] = useState(initialTo)
  const [allExpenses, setAllExpenses] = useState<Expense[]>(initialExpenses)
  const [fullBalance, setFullBalance] = useState<BusinessBalance>(initialBalance)
  const [selectedCategory, setSelectedCategory] = useState<ExpenseCategory | undefined>(undefined)
  const [suppliers, setSuppliers] = useState<Supplier[]>(initialSuppliers)
  const [isLoading, setIsLoading] = useState(false)
  const requestIdRef = useRef(0)

  function syncDateUrl(nextPeriod: DateRangePeriod, nextFrom?: string, nextTo?: string) {
    if (typeof window === 'undefined') return
    const query = buildDateParams(nextPeriod, nextFrom, nextTo)
    window.history.replaceState(window.history.state, '', `${pathname}?${query}`)
  }

  async function loadExpensesView(nextPeriod: DateRangePeriod, nextFrom?: string, nextTo?: string) {
    const requestId = ++requestIdRef.current
    const resolvedRange = resolveDateRange(nextPeriod, nextFrom, nextTo)

    setPeriod(nextPeriod)
    setFrom(nextFrom)
    setTo(nextTo)
    syncDateUrl(nextPeriod, nextFrom, nextTo)
    setIsLoading(true)

    try {
      const [balanceResult, expensesResult] = await Promise.all([
        supabase.rpc('get_business_balance', {
          p_business_id: businessId,
          p_from: resolvedRange.from,
          p_to: resolvedRange.to,
        }),
        supabase.rpc('get_expenses_list', {
          p_business_id: businessId,
          p_from: resolvedRange.from,
          p_to: resolvedRange.to,
          p_limit: 5000,
          p_offset: 0,
        }),
      ])

      if (requestId !== requestIdRef.current) {
        return
      }

      const nextBalance = (balanceResult.data as unknown as BusinessBalance | null) ?? {
        income: 0,
        expenses: 0,
        profit: 0,
        margin: 0,
        by_category: {},
        period_from: resolvedRange.from ?? '',
        period_to: resolvedRange.to ?? '',
      }
      const expensesData = expensesResult.data as unknown as { data: Expense[]; total: number } | null

      setFullBalance(nextBalance)
      setAllExpenses(expensesData?.data ?? [])
    } catch (error) {
      console.error('No se pudo actualizar la vista de gastos', error)
    } finally {
      if (requestId === requestIdRef.current) {
        setIsLoading(false)
      }
    }
  }

  function handleExpenseDeleted(id: string) {
    setAllExpenses(prev => prev.filter(expense => expense.id !== id))
    void loadExpensesView(period, from, to)
  }

  function handleExpenseCreated() {
    void loadExpensesView(period, from, to)
  }

  const filteredExpenses = useMemo(() => {
    if (!selectedCategory) {
      return allExpenses
    }

    return allExpenses.filter(expense => expense.category === selectedCategory)
  }, [allExpenses, selectedCategory])

  const csvData = useMemo(() =>
    filteredExpenses.map(e => ({
      Fecha: e.date,
      Categoría: EXPENSE_CATEGORY_LABELS[e.category],
      Descripción: e.description,
      Proveedor: e.supplier?.name ?? '',
      Monto: e.amount,
      Adjunto: e.attachment_url ?? '',
    })),
    [filteredExpenses]
  )

  const displayBalance = useMemo(() => {
    const filteredExpensesTotal = filteredExpenses.reduce((total, expense) => total + Number(expense.amount), 0)
    const profit = fullBalance.income - filteredExpensesTotal
    const margin = fullBalance.income > 0 ? (profit / fullBalance.income) * 100 : 0

    return {
      ...fullBalance,
      expenses: filteredExpensesTotal,
      profit,
      margin,
    }
  }, [filteredExpenses, fullBalance])

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
                key={`${period}:${from ?? ''}:${to ?? ''}`}
                value={period}
                from={from}
                to={to}
                onChange={(nextPeriod, nextFrom, nextTo) => {
                  const resolvedFrom = (nextPeriod === 'personalizado' || nextPeriod === 'trimestre' || nextPeriod === 'año') ? nextFrom : undefined
                  const resolvedTo = (nextPeriod === 'personalizado' || nextPeriod === 'trimestre' || nextPeriod === 'año') ? nextTo : undefined
                  void loadExpensesView(nextPeriod, resolvedFrom, resolvedTo)
                }}
              />

              {/* Category filter */}
              <div className="pill-tabs flex-wrap">
                <button
                  onClick={() => setSelectedCategory(undefined)}
                  className={`pill-tab${!selectedCategory ? ' pill-tab-active' : ''}`}
                >
                  Todos
                </button>
                {EXPENSE_CATEGORIES.map(cat => (
                  <button
                    key={cat}
                    onClick={() => setSelectedCategory(cat)}
                    className={`pill-tab${selectedCategory === cat ? ' pill-tab-active' : ''}`}
                  >
                    {EXPENSE_CATEGORY_LABELS[cat]}
                  </button>
                ))}
              </div>

              <ExpenseSummaryCards balance={displayBalance} />

              <div className="flex items-center justify-between">
                <button
                  onClick={() => setShowSuppliers(true)}
                  className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                >
                  Gestionar proveedores →
                </button>
                <div className="flex items-center gap-3">
                  {isLoading && <span className="text-xs text-hint">Actualizando...</span>}
                  <ExportCSVButton data={csvData} filename="gastos" label="Exportar" />
                </div>
              </div>

              <div className={isLoading ? 'opacity-60 transition-opacity' : 'transition-opacity'}>
                <ExpensesTable
                  expenses={filteredExpenses}
                  businessId={businessId}
                  supabaseClient={supabase}
                  onDeleted={handleExpenseDeleted}
                />
              </div>
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
