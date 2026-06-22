'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, UsersThree, MagnifyingGlass } from '@phosphor-icons/react/dist/ssr'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import ConfirmModal from '@/components/shared/ConfirmModal'
import PageHeader from '@/components/shared/PageHeader'
import { formatMoney } from '@/lib/format'
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

interface Props {
  businessId: string
  operatorId: string | null
  initialCustomers: Customer[]
}

export default function CustomerView({ businessId, operatorId, initialCustomers }: Props) {
  const router = useRouter()
  const supabase = useMemo(() => createClient(), [])
  const [customers, setCustomers] = useState<Customer[]>(initialCustomers)
  const [showNewModal, setShowNewModal] = useState(false)
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null)
  const [settlingCustomer, setSettlingCustomer] = useState<Customer | null>(null)
  const [viewingCustomer, setViewingCustomer] = useState<Customer | null>(null)
  const [search, setSearch] = useState('')
  const [creditFilter, setCreditFilter] = useState<CreditFilter>('all')
  const [sortKey, setSortKey] = useState<SortKey>('name')
  const [deletingCustomer, setDeletingCustomer] = useState<Customer | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)

  const filteredCustomers = useMemo(() => {
    const q = search.trim().toLowerCase()
    const filtered = customers.filter(c => {
      if (creditFilter === 'enabled' && !c.is_credit_enabled) return false
      if (creditFilter === 'disabled' && c.is_credit_enabled) return false
      if (creditFilter === 'with_debt' && !(c.credit_balance > 0)) return false
      if (!q) return true
      return (
        c.name.toLowerCase().includes(q) ||
        (c.phone?.toLowerCase().includes(q) ?? false) ||
        (c.dni?.toLowerCase().includes(q) ?? false)
      )
    })
    if (sortKey === 'debt_desc') {
      return [...filtered].sort(
        (a, b) =>
          b.credit_balance - a.credit_balance ||
          a.name.localeCompare(b.name, 'es'),
      )
    }
    return [...filtered].sort((a, b) => a.name.localeCompare(b.name, 'es'))
  }, [customers, search, creditFilter, sortKey])

  function handleCreated(customer: Customer) {
    setCustomers(prev =>
      [...prev, customer].sort((a, b) => a.name.localeCompare(b.name, 'es'))
    )
    setShowNewModal(false)
    router.refresh()
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
    setCustomers(prev => prev.filter(c => c.id !== deletingCustomer.id))
    setDeletingCustomer(null)
    setDeleting(false)
    router.refresh()
  }

  function handleUpdated(customer: Customer) {
    setCustomers(prev =>
      prev
        .map(c => (c.id === customer.id ? customer : c))
        .sort((a, b) => a.name.localeCompare(b.name, 'es'))
    )
    setEditingCustomer(null)
    router.refresh()
  }

  function handleSettled(customerId: string, nextBalance: number) {
    setCustomers(prev =>
      prev.map(c => (c.id === customerId ? { ...c, credit_balance: nextBalance } : c))
    )
    setSettlingCustomer(null)
    router.refresh()
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
          {customers.length === 0 ? (
            <div className="surface-card px-6 py-12 flex flex-col items-center justify-center text-center gap-2">
              <span className="flex items-center justify-center w-9 h-9 rounded-full bg-muted text-hint">
                <UsersThree size={18} />
              </span>
              <p className="text-sm font-medium text-heading">Todavía no hay clientes</p>
              <p className="text-xs text-hint">Agrega el primero con el botón de arriba para llevar su cuenta corriente.</p>
            </div>
          ) : filteredCustomers.length === 0 ? (
            <div className="surface-card px-6 py-12 flex flex-col items-center justify-center text-center gap-2">
              <span className="flex items-center justify-center w-9 h-9 rounded-full bg-muted text-hint">
                <MagnifyingGlass size={18} />
              </span>
              <p className="text-sm font-medium text-heading">Sin resultados</p>
              <p className="text-xs text-hint">Prueba con otra búsqueda o filtro.</p>
            </div>
          ) : (
            <div className="surface-card overflow-x-auto">
              <table className="w-full text-sm min-w-[600px]">
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
                  {filteredCustomers.map(customer => {
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
                              {formatMoney(customer.credit_balance)}
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
                          {formatMoney(customer.credit_limit)}
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
          onSettled={nb => handleSettled(settlingCustomer.id, nb)}
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
