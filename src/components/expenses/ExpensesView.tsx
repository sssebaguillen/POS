'use client'

import { useEffect, useMemo, useState } from 'react'
import { usePathname } from 'next/navigation'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronLeft, Plus } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import posthog from 'posthog-js'
import { trackFeatureUsed } from '@/lib/analytics'
import { Button } from '@/components/ui/button'
import PageHeader from '@/components/shared/PageHeader'
import DateRangeFilter from '@/components/shared/DateRangeFilter'
import { usePillIndicator } from '@/hooks/usePillIndicator'
import { resolveDateRange, buildDateParams, periodNeedsCustomDates, type DateRangePeriod } from '@/lib/date-utils'
import ExportCSVButton from '@/components/shared/ExportCSVButton'
import ExpenseSummaryCards from './ExpenseSummaryCards'
import ExpensesTable from './ExpensesTable'
import NewExpensePanel from './NewExpensePanel'
import EditExpensePanel from './EditExpensePanel'
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
  canUpdateStock?: boolean
}

interface ExpensesQueryData {
  balance: BusinessBalance
  expenses: Expense[]
}

export default function ExpensesView({
  expenses: initialExpenses,
  balance: initialBalance,
  suppliers: initialSuppliers,
  businessId,
  period: initialPeriod,
  from: initialFrom,
  to: initialTo,
  canUpdateStock = false,
}: Props) {
  useEffect(() => { trackFeatureUsed('expenses') }, [])

  const pathname = usePathname()
  const queryClient = useQueryClient()
  const supabase = useMemo(() => createClient(), [])
  const [showSuppliers, setShowSuppliers] = useState(false)
  const [panelOpen, setPanelOpen] = useState(false)
  const [editingExpense, setEditingExpense] = useState<Expense | null>(null)
  const [period, setPeriod] = useState<DateRangePeriod>(initialPeriod)
  const [from, setFrom] = useState(initialFrom)
  const [to, setTo] = useState(initialTo)
  const [selectedCategory, setSelectedCategory] = useState<ExpenseCategory | undefined>(undefined)
  const [suppliers, setSuppliers] = useState<Supplier[]>(initialSuppliers)
  const [mountedAt] = useState(() => Date.now())
  const { setRef, indicator } = usePillIndicator(selectedCategory ?? 'todos')

  const isInitialPeriod = period === initialPeriod && from === initialFrom && to === initialTo

  const { data, isFetching } = useQuery<ExpensesQueryData>({
    queryKey: ['expenses', businessId, period, from, to],
    queryFn: async () => {
      const resolvedRange = resolveDateRange(period, from, to)
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

      const balance = (balanceResult.data as unknown as BusinessBalance | null) ?? {
        income: 0,
        expenses: 0,
        profit: 0,
        margin: 0,
        by_category: {},
        period_from: resolvedRange.from ?? '',
        period_to: resolvedRange.to ?? '',
      }
      const expensesData = expensesResult.data as unknown as { data: Expense[]; total: number } | null

      return { balance, expenses: expensesData?.data ?? [] }
    },
    initialData: isInitialPeriod
      ? { balance: initialBalance, expenses: initialExpenses }
      : undefined,
    initialDataUpdatedAt: isInitialPeriod ? mountedAt : undefined,
  })

  const allExpenses = useMemo(() => data?.expenses ?? [], [data?.expenses])
  const fullBalance = data?.balance ?? initialBalance

  function syncDateUrl(nextPeriod: DateRangePeriod, nextFrom?: string, nextTo?: string) {
    if (typeof window === 'undefined') return
    const query = buildDateParams(nextPeriod, nextFrom, nextTo)
    window.history.replaceState(window.history.state, '', `${pathname}?${query}`)
  }

  function handlePeriodChange(nextPeriod: DateRangePeriod, nextFrom?: string, nextTo?: string) {
    const resolvedFrom = periodNeedsCustomDates(nextPeriod) ? nextFrom : undefined
    const resolvedTo = periodNeedsCustomDates(nextPeriod) ? nextTo : undefined
    setPeriod(nextPeriod)
    setFrom(resolvedFrom)
    setTo(resolvedTo)
    syncDateUrl(nextPeriod, resolvedFrom, resolvedTo)
  }

  function handleExpenseDeleted(id: string) {
    queryClient.setQueryData<ExpensesQueryData>(
      ['expenses', businessId, period, from, to],
      (old) => old ? { ...old, expenses: old.expenses.filter(e => e.id !== id) } : old
    )
    void queryClient.invalidateQueries({ queryKey: ['expenses'] })
  }

  function handleExpenseUpdated() {
    void queryClient.invalidateQueries({ queryKey: ['expenses'] })
  }

  function handleExpenseCreated() {
    posthog.capture('expense_created')
    void queryClient.invalidateQueries({ queryKey: ['expenses'] })
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
            className="h-9 px-4 rounded-lg text-sm font-semibold bg-primary hover:bg-primary/90 text-primary-foreground gap-2 shrink-0"
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
                key="expenses-date-filter"
                value={period}
                from={from}
                to={to}
                onChange={handlePeriodChange}
              />

              {/* Category filter */}
              <div className="pill-tabs flex-wrap relative">
                {indicator && (
                  <span
                    className="pill-tab-indicator"
                    style={{
                      transform: `translateX(${indicator.left}px)`,
                      width: indicator.width,
                    }}
                  />
                )}
                <button
                  ref={setRef('todos')}
                  onClick={() => setSelectedCategory(undefined)}
                  className={`pill-tab${!selectedCategory ? ' pill-tab-active' : ''}`}
                >
                  Todos
                </button>
                {EXPENSE_CATEGORIES.map(cat => (
                  <button
                    key={cat}
                    ref={setRef(cat)}
                    onClick={() => setSelectedCategory(cat)}
                    className={`pill-tab${selectedCategory === cat ? ' pill-tab-active' : ''}`}
                  >
                    {EXPENSE_CATEGORY_LABELS[cat]}
                  </button>
                ))}
              </div>

              <ExpenseSummaryCards balance={displayBalance} isFiltered={!!selectedCategory} />

              <div className="flex items-center justify-between">
                <button
                  onClick={() => setShowSuppliers(true)}
                  className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                >
                  Gestionar proveedores →
                </button>
                <div className="flex items-center gap-3">
                  {isFetching && <span className="text-xs text-hint">Actualizando...</span>}
                  <ExportCSVButton data={csvData} filename="gastos" label="Exportar" />
                </div>
              </div>

              <div className={isFetching ? 'opacity-60 transition-opacity' : 'transition-opacity'}>
                <ExpensesTable
                  expenses={filteredExpenses}
                  businessId={businessId}
                  supabaseClient={supabase}
                  onDeleted={handleExpenseDeleted}
                  onEdit={setEditingExpense}
                />
              </div>
            </>
          )}

          {showSuppliers && (
            <>
              <nav className="flex items-center gap-2 text-sm" aria-label="Navegación de sección">
                <button
                  onClick={() => setShowSuppliers(false)}
                  className="inline-flex items-center gap-1 text-hint hover:text-foreground transition-colors"
                >
                  <ChevronLeft size={14} />
                  Gastos
                </button>
                <span className="text-faint" aria-hidden="true">/</span>
                <span className="font-semibold text-foreground">Proveedores</span>
              </nav>
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
          canUpdateStock={canUpdateStock}
        />
      )}

      {editingExpense && (
        <EditExpensePanel
          expense={editingExpense}
          businessId={businessId}
          supabaseClient={supabase}
          onUpdated={handleExpenseUpdated}
          onClose={() => setEditingExpense(null)}
          canUpdateStock={canUpdateStock}
        />
      )}
    </div>
  )
}
