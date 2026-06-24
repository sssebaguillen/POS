'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useInfiniteQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query'
import { Plus, UsersThree, MagnifyingGlass, CircleNotch, WarningCircle } from '@phosphor-icons/react/dist/ssr'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import ConfirmModal from '@/components/shared/ConfirmModal'
import PageHeader from '@/components/shared/PageHeader'
import PopNumber from '@/components/shared/PopNumber'
import { useFormatMoney } from '@/lib/context/CurrencyContext'
import { cn } from '@/lib/utils'
import type { Customer } from '@/lib/types'
import NewCustomerModal from './NewCustomerModal'
import EditCustomerModal from './EditCustomerModal'
import SettlePaymentModal from './SettlePaymentModal'
import CustomerDetailPanel from './CustomerDetailPanel'

type CreditFilter = 'all' | 'enabled' | 'disabled' | 'with_debt'

const CREDIT_FILTERS: { value: CreditFilter; label: string }[] = [
  { value: 'all', label: 'Todos' },
  { value: 'enabled', label: 'Habilitado' },
  { value: 'disabled', label: 'Deshabilitado' },
  { value: 'with_debt', label: 'Con deuda' },
]

type SortKey = 'name' | 'debt_desc'

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: 'name', label: 'Nombre (A-Z)' },
  { value: 'debt_desc', label: 'Deuda (mayor primero)' },
]

const PAGE_SIZE = 50

interface CustomersListPage {
  data: Customer[]
  total: number
}

interface Props {
  businessId: string
  operatorId: string | null
  initialCustomers: Customer[]
  initialTotal: number
  accountsReceivable: { total: number; debtors: number }
}

export default function CustomerView({ businessId, operatorId, initialCustomers, initialTotal, accountsReceivable }: Props) {
  const router = useRouter()
  const fmt = useFormatMoney()
  const supabase = useMemo(() => createClient(), [])
  const queryClient = useQueryClient()
  const [showNewModal, setShowNewModal] = useState(false)
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null)
  const [settlingCustomer, setSettlingCustomer] = useState<Customer | null>(null)
  const [viewingCustomer, setViewingCustomer] = useState<Customer | null>(null)
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [creditFilter, setCreditFilter] = useState<CreditFilter>('all')
  const [sortKey, setSortKey] = useState<SortKey>('name')
  const [deletingCustomer, setDeletingCustomer] = useState<Customer | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)

  // Debounce de la búsqueda para no disparar el query en cada tecla.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 300)
    return () => clearTimeout(t)
  }, [search])

  // Lista paginada server-side (búsqueda/filtro/orden resueltos en la RPC). El
  // cambio de cualquier filtro cambia la queryKey → arranca de offset 0 solo.
  const isDefaultQuery = debouncedSearch === '' && creditFilter === 'all' && sortKey === 'name'

  const { data, isFetching, isFetchingNextPage, hasNextPage, fetchNextPage, isError, refetch } =
    useInfiniteQuery<CustomersListPage>({
      queryKey: ['customers', businessId, debouncedSearch, creditFilter, sortKey],
      initialPageParam: 0,
      placeholderData: keepPreviousData,
      staleTime: 30_000,
      queryFn: async ({ pageParam }) => {
        const { data, error } = await supabase.rpc('get_customers_list', {
          p_business_id: businessId,
          p_search: debouncedSearch || null,
          p_credit_filter: creditFilter,
          p_sort: sortKey,
          p_limit: PAGE_SIZE,
          p_offset: (pageParam as number) * PAGE_SIZE,
        })
        if (error) throw new Error(error.message)
        return (data as unknown as CustomersListPage) ?? { data: [], total: 0 }
      },
      getNextPageParam: (_lastPage, allPages) => {
        const loaded = allPages.reduce((n, p) => n + p.data.length, 0)
        const total = allPages[0]?.total ?? 0
        return loaded < total ? allPages.length : undefined
      },
      initialData: isDefaultQuery
        ? { pages: [{ data: initialCustomers, total: initialTotal }], pageParams: [0] }
        : undefined,
    })

  const customers = useMemo(() => (data?.pages ?? []).flatMap(p => p.data), [data])
  const total = data?.pages[0]?.total ?? 0
  const hasActiveFilters = debouncedSearch !== '' || creditFilter !== 'all'
  const hasCustomers = initialTotal > 0 || accountsReceivable.debtors > 0 || customers.length > 0

  function reloadList() {
    void queryClient.invalidateQueries({ queryKey: ['customers', businessId] })
    router.refresh()
  }

  // Total de cuentas por cobrar — exacto, agregado server-side por
  // get_accounts_receivable_summary (misma fuente que la tarjeta del dashboard,
  // sin el tope silencioso de PostgREST que tendría sumar la lista en memoria).
  // Es el número de negocio "cuánto me deben"; se refresca con router.refresh()
  // tras cada alta/edición/cobro.
  const receivable = accountsReceivable

  function handleCreated() {
    setShowNewModal(false)
    reloadList()
  }

  async function handleDeleteConfirm() {
    if (!deletingCustomer) return
    setDeleting(true)
    setDeleteError(null)
    const { data, error } = await supabase.rpc('delete_customer', {
      p_customer_id: deletingCustomer.id,
      p_operator_id: operatorId,
    })
    const result = data as { success: boolean; error?: string } | null
    if (error || !result?.success) {
      setDeleteError(result?.error ?? error?.message ?? 'No se pudo eliminar el cliente.')
      setDeleting(false)
      return
    }
    setDeletingCustomer(null)
    setDeleting(false)
    reloadList()
  }

  function handleUpdated() {
    setEditingCustomer(null)
    reloadList()
  }

  function handleSettled() {
    setSettlingCustomer(null)
    reloadList()
  }

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      <PageHeader title="Clientes">
        <Button
          onClick={() => setShowNewModal(true)}
          className="h-9 px-4 rounded-lg text-sm font-semibold bg-primary hover:bg-primary/90 text-primary-foreground gap-2 shrink-0"
        >
          <Plus size={15} />
          Nuevo cliente
        </Button>
      </PageHeader>

      <div className="bg-surface border-b border-edge/60 px-5 py-3">
        <div className="flex flex-wrap items-center gap-3">
          <Input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Buscar por nombre, teléfono o DNI..."
            className="h-9 max-w-xs rounded-lg text-sm"
          />
          <div className="flex flex-wrap gap-1.5">
            {CREDIT_FILTERS.map(f => {
              const active = creditFilter === f.value
              return (
                <button
                  key={f.value}
                  type="button"
                  onClick={() => setCreditFilter(f.value)}
                  className={cn(
                    'pill-tab',
                    active && 'bg-primary/10 text-primary border border-primary/20 dark:bg-primary/15 dark:border-primary/30',
                  )}
                >
                  {f.label}
                </button>
              )
            })}
          </div>
          <div className="flex flex-wrap items-center gap-1.5 md:ml-auto">
            <span className="text-xs text-hint">Ordenar:</span>
            {SORT_OPTIONS.map(s => {
              const active = sortKey === s.value
              return (
                <button
                  key={s.value}
                  type="button"
                  onClick={() => setSortKey(s.value)}
                  className={cn(
                    'pill-tab',
                    active && 'bg-primary/10 text-primary border border-primary/20 dark:bg-primary/15 dark:border-primary/30',
                  )}
                >
                  {s.label}
                </button>
              )
            })}
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="px-5 pt-4 pb-6">
          {hasCustomers && (
            <div className="surface-card overflow-hidden mb-4">
              <div className="grid grid-cols-2">
                <div className="px-6 py-4 border-r border-edge/40">
                  <p className="text-label text-hint mb-2">Por cobrar</p>
                  <PopNumber
                    value={fmt(receivable.total)}
                    className={cn(
                      'font-display text-xl font-bold leading-none tabular-nums',
                      receivable.total > 0 ? 'text-destructive' : 'text-foreground',
                    )}
                  />
                </div>
                <div className="px-6 py-4">
                  <p className="text-label text-hint mb-2">Deudores</p>
                  <PopNumber
                    value={String(receivable.debtors)}
                    className="font-display text-xl font-bold leading-none tabular-nums text-foreground"
                  />
                </div>
              </div>
            </div>
          )}
          {isError ? (
            <div className="surface-card px-6 py-12 flex flex-col items-center justify-center text-center gap-2">
              <span className="flex items-center justify-center w-9 h-9 rounded-full bg-muted text-hint">
                <WarningCircle size={18} />
              </span>
              <p className="text-sm font-medium text-heading">No se pudo cargar la lista</p>
              <p className="text-xs text-hint">Revisa tu conexión e intenta de nuevo.</p>
              <Button
                type="button"
                variant="outline"
                className="h-8 px-3 text-xs mt-1"
                onClick={() => void refetch()}
              >
                Reintentar
              </Button>
            </div>
          ) : customers.length === 0 && isFetching ? (
            <div className="surface-card px-6 py-12 flex flex-col items-center justify-center text-center gap-2 text-hint">
              <CircleNotch size={20} className="animate-spin" />
              <p className="text-xs">Cargando clientes…</p>
            </div>
          ) : customers.length === 0 ? (
            hasActiveFilters ? (
              <div className="surface-card px-6 py-12 flex flex-col items-center justify-center text-center gap-2">
                <span className="flex items-center justify-center w-9 h-9 rounded-full bg-muted text-hint">
                  <MagnifyingGlass size={18} />
                </span>
                <p className="text-sm font-medium text-heading">Sin resultados</p>
                <p className="text-xs text-hint">Prueba con otra búsqueda o filtro.</p>
              </div>
            ) : (
              <div className="surface-card px-6 py-12 flex flex-col items-center justify-center text-center gap-2">
                <span className="flex items-center justify-center w-9 h-9 rounded-full bg-muted text-hint">
                  <UsersThree size={18} />
                </span>
                <p className="text-sm font-medium text-heading">Todavía no hay clientes</p>
                <p className="text-xs text-hint">Agrega el primero con el botón de arriba para llevar su cuenta corriente.</p>
              </div>
            )
          ) : (
            <div className="surface-card overflow-x-auto" aria-busy={isFetching && !isFetchingNextPage}>
              <table className={cn('w-full text-sm min-w-[600px] transition-opacity', isFetching && !isFetchingNextPage && 'opacity-60')}>
                <thead className="border-b border-edge/60">
                  <tr className="text-xs text-hint font-medium">
                    <th className="text-foreground text-left px-4 py-3">Nombre</th>
                    <th className="text-foreground text-left px-4 py-3 hidden md:table-cell">Teléfono</th>
                    <th className="text-foreground text-left px-4 py-3">Crédito</th>
                    <th className="text-foreground text-right px-4 py-3">Deuda actual</th>
                    <th className="text-foreground text-right px-4 py-3 hidden md:table-cell">Límite</th>
                    <th className="text-foreground text-right px-4 py-3">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {customers.map(customer => {
                    const hasDebt = customer.credit_balance > 0
                    const hasLimit = customer.credit_limit > 0
                    return (
                      <tr
                        key={customer.id}
                        className="border-b border-edge/40 hover:bg-hover-bg transition-colors"
                      >
                        <td className="px-4 py-3 font-medium text-heading max-w-[220px]">
                          <span className="truncate block">{customer.name}</span>
                        </td>
                        <td className="px-4 py-3 text-body hidden md:table-cell">
                          {customer.phone ?? '—'}
                        </td>
                        <td className="px-4 py-3">
                          {customer.is_credit_enabled ? (
                            <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border border-emerald-500/20">
                              Habilitado
                            </span>
                          ) : (
                            <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-muted text-hint border border-edge">
                              Deshabilitado
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums">
                          <div className="flex items-center justify-end gap-2">
                            <span className={hasDebt ? 'text-destructive font-semibold' : 'text-hint'}>
                              {fmt(customer.credit_balance)}
                            </span>
                            {hasDebt && (
                              <button
                                type="button"
                                onClick={() => setSettlingCustomer(customer)}
                                className="rounded-full border border-primary/30 bg-primary/5 px-2.5 py-0.5 text-xs font-medium text-primary hover:bg-primary/10 transition-[transform,background-color] duration-150 ease-[var(--ease-out)] active:scale-[0.97]"
                              >
                                Cobrar
                              </button>
                            )}
                          </div>
                        </td>
                        <td className={`px-4 py-3 text-right tabular-nums hidden md:table-cell ${hasLimit ? 'text-body' : 'text-hint'}`}>
                          {fmt(customer.credit_limit)}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <Button
                              type="button"
                              variant="outline"
                              className="h-8 px-3 text-xs"
                              onClick={() => setViewingCustomer(customer)}
                            >
                              Ver
                            </Button>
                            <Button
                              type="button"
                              variant="outline"
                              className="h-8 px-3 text-xs"
                              onClick={() => setEditingCustomer(customer)}
                            >
                              Editar
                            </Button>
                            <Button
                              type="button"
                              variant="destructive"
                              className="h-8 px-3 text-xs"
                              onClick={() => { setDeleteError(null); setDeletingCustomer(customer) }}
                            >
                              Eliminar
                            </Button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              {hasNextPage && (
                <div className="px-3 pb-3 pt-1">
                  <button
                    type="button"
                    onClick={() => fetchNextPage()}
                    disabled={isFetchingNextPage}
                    className="w-full h-9 rounded-lg border border-edge text-sm text-body hover:bg-hover-bg disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    {isFetchingNextPage ? 'Cargando…' : `Cargar más (${customers.length} de ${total})`}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <NewCustomerModal
        open={showNewModal}
        onClose={() => setShowNewModal(false)}
        businessId={businessId}
        operatorId={operatorId}
        onCreated={handleCreated}
      />

      {editingCustomer && (
        <EditCustomerModal
          open={editingCustomer !== null}
          onClose={() => setEditingCustomer(null)}
          customer={editingCustomer}
          operatorId={operatorId}
          onUpdated={handleUpdated}
        />
      )}

      {settlingCustomer && (
        <SettlePaymentModal
          customer={settlingCustomer}
          operatorId={operatorId}
          onSettled={() => handleSettled()}
          onClose={() => setSettlingCustomer(null)}
        />
      )}

      {viewingCustomer && (
        <CustomerDetailPanel
          customer={viewingCustomer}
          businessId={businessId}
          onClose={() => setViewingCustomer(null)}
        />
      )}

      <ConfirmModal
        open={deletingCustomer !== null}
        title="¿Eliminar cliente?"
        message="Esta acción no se puede deshacer. Si el cliente tiene ventas o deuda registrada, será archivado pero no eliminado permanentemente."
        loading={deleting}
        loadingLabel="Eliminando..."
        error={deleteError}
        onConfirm={() => { void handleDeleteConfirm() }}
        onCancel={() => { setDeletingCustomer(null); setDeleteError(null) }}
      />
    </div>
  )
}
