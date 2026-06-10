'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Archive, BadgePercent, Pause, Pencil, Play, Plus } from 'lucide-react'
import PageHeader from '@/components/shared/PageHeader'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import ConfirmModal from '@/components/shared/ConfirmModal'
import PromotionModal from '@/components/promotions/PromotionModal'
import { createClient } from '@/lib/supabase/client'
import { promoBadgeLabel, type Promotion } from '@/lib/promotions'
import {
  describePromotion,
  getPromotionStatus,
  type NamedRef,
  type PromoProductRef,
  type PromotionStatus,
} from '@/components/promotions/types'
import { useToast } from '@/hooks/useToast'
import { translateDbError } from '@/lib/errors'

type StatusFilter = 'all' | PromotionStatus

const STATUS_CHIPS: { value: StatusFilter; label: string }[] = [
  { value: 'all', label: 'Todas' },
  { value: 'activa', label: 'Activas' },
  { value: 'programada', label: 'Programadas' },
  { value: 'vencida', label: 'Vencidas' },
  { value: 'pausada', label: 'Pausadas' },
  { value: 'archivada', label: 'Archivadas' },
]

const STATUS_BADGE_CLASSES: Record<PromotionStatus, string> = {
  activa: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300',
  programada: 'bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300',
  vencida: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-500/15 dark:text-zinc-400',
  pausada: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300',
  archivada: 'bg-zinc-100 text-zinc-500 dark:bg-zinc-500/10 dark:text-zinc-500',
}

const STATUS_LABELS: Record<PromotionStatus, string> = {
  activa: 'Activa',
  programada: 'Programada',
  vencida: 'Vencida',
  pausada: 'Pausada',
  archivada: 'Archivada',
}

function formatDateShort(iso: string): string {
  return new Date(iso).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit' })
}

interface Props {
  businessId: string
  operatorId: string | null
  readOnly: boolean
  initialPromotions: Promotion[]
  products: PromoProductRef[]
  categories: NamedRef[]
  brands: NamedRef[]
}

export default function PromotionsView({
  businessId,
  operatorId,
  readOnly,
  initialPromotions,
  products,
  categories,
  brands,
}: Props) {
  const router = useRouter()
  const supabase = useMemo(() => createClient(), [])
  const { showToast } = useToast()
  const [promotions, setPromotions] = useState<Promotion[]>(initialPromotions)
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<Promotion | null>(null)
  const [confirmArchive, setConfirmArchive] = useState<Promotion | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const productNames = useMemo(() => new Map(products.map(p => [p.id, p.name])), [products])
  const categoryNames = useMemo(() => new Map(categories.map(c => [c.id, c.name])), [categories])
  const brandNames = useMemo(() => new Map(brands.map(b => [b.id, b.name])), [brands])

  function scopeLabel(promo: Promotion): string {
    if (promo.product_id) return productNames.get(promo.product_id) ?? 'Producto'
    if (promo.category_id) return `Categoría: ${categoryNames.get(promo.category_id) ?? '—'}`
    return `Marca: ${brandNames.get(promo.brand_id ?? '') ?? '—'}`
  }

  function vigenciaLabel(promo: Promotion): string {
    if (!promo.starts_at && !promo.ends_at) return 'Sin límite'
    if (promo.starts_at && promo.ends_at) return `${formatDateShort(promo.starts_at)} – ${formatDateShort(promo.ends_at)}`
    if (promo.starts_at) return `Desde ${formatDateShort(promo.starts_at)}`
    return `Hasta ${formatDateShort(promo.ends_at!)}`
  }

  const counts = useMemo(() => {
    const map = new Map<StatusFilter, number>([['all', promotions.length]])
    for (const promo of promotions) {
      const status = getPromotionStatus(promo)
      map.set(status, (map.get(status) ?? 0) + 1)
    }
    return map
  }, [promotions])

  const filtered = useMemo(() => {
    if (statusFilter === 'all') return promotions.filter(p => getPromotionStatus(p) !== 'archivada')
    return promotions.filter(p => getPromotionStatus(p) === statusFilter)
  }, [promotions, statusFilter])

  async function refresh() {
    const { data } = await supabase
      .from('promotions')
      .select('id, business_id, name, kind, percent, offer_price, group_size, affected_units, pay_percent, product_id, category_id, brand_id, starts_at, ends_at, is_active, show_in_catalog, archived_at, created_at')
      .eq('business_id', businessId)
      .order('created_at', { ascending: false })
    if (data) {
      const { normalizePromotion } = await import('@/lib/promotions')
      setPromotions(data.map(normalizePromotion))
    }
    router.refresh()
  }

  async function handleToggleActive(promo: Promotion) {
    if (readOnly || busyId) return
    setBusyId(promo.id)
    const { data, error } = await supabase.rpc('update_promotion', {
      p_operator_id: operatorId,
      p_business_id: businessId,
      p_promotion_id: promo.id,
      p_name: promo.name,
      p_kind: promo.kind,
      p_percent: promo.percent,
      p_offer_price: promo.offer_price,
      p_group_size: promo.group_size,
      p_affected_units: promo.affected_units,
      p_pay_percent: promo.pay_percent,
      p_product_id: promo.product_id,
      p_category_id: promo.category_id,
      p_brand_id: promo.brand_id,
      p_starts_at: promo.starts_at,
      p_ends_at: promo.ends_at,
      p_show_in_catalog: promo.show_in_catalog,
      p_is_active: !promo.is_active,
    })
    setBusyId(null)
    const result = data as { success?: boolean; error?: string } | null
    if (error || !result?.success) {
      showToast({ message: translateDbError(error?.message ?? result?.error ?? '', 'No se pudo actualizar la promoción'), variant: 'error' })
      return
    }
    showToast({ message: promo.is_active ? 'Promoción pausada' : 'Promoción reanudada' })
    void refresh()
  }

  async function handleArchive(promo: Promotion) {
    setConfirmArchive(null)
    if (readOnly || busyId) return
    setBusyId(promo.id)
    const { data, error } = await supabase.rpc('archive_promotion', {
      p_operator_id: operatorId,
      p_business_id: businessId,
      p_promotion_id: promo.id,
    })
    setBusyId(null)
    const result = data as { success?: boolean; error?: string } | null
    if (error || !result?.success) {
      showToast({ message: translateDbError(error?.message ?? result?.error ?? '', 'No se pudo archivar la promoción'), variant: 'error' })
      return
    }
    showToast({ message: 'Promoción archivada' })
    void refresh()
  }

  return (
    <div className="p-6 space-y-5">
      <PageHeader title="Promociones">
        {!readOnly && (
          <Button
            onClick={() => { setEditing(null); setModalOpen(true) }}
            className="h-9 px-4 rounded-lg text-sm font-semibold bg-primary hover:bg-primary/90 text-primary-foreground"
          >
            <Plus size={16} className="mr-1.5" />
            Nueva promoción
          </Button>
        )}
      </PageHeader>

      {/* Chips de estado */}
      <div className="flex items-center gap-1.5 overflow-x-auto">
        {STATUS_CHIPS.map(chip => {
          const count = counts.get(chip.value) ?? 0
          if (chip.value !== 'all' && count === 0 && statusFilter !== chip.value) return null
          return (
            <button
              key={chip.value}
              onClick={() => setStatusFilter(chip.value)}
              className={`pill-tab shrink-0 ${statusFilter === chip.value ? 'bg-primary/10 text-primary border border-primary/20' : ''}`}
            >
              {chip.label}
              {chip.value !== 'all' && count > 0 && <span className="ml-1 tabular-nums">{count}</span>}
            </button>
          )
        })}
      </div>

      {filtered.length === 0 ? (
        <div className="surface-card p-12 text-center text-hint select-none">
          <BadgePercent size={40} className="mx-auto mb-3 opacity-40" />
          {promotions.length === 0 ? (
            <>
              <p className="text-sm font-medium text-body">Aún no hay promociones</p>
              <p className="text-xs mt-1">
                Crea ofertas como &quot;20% off&quot;, &quot;2x1&quot; o un precio especial. Aplican en el punto de venta
                y se destacan en tu catálogo online.
              </p>
            </>
          ) : (
            <p className="text-sm">No hay promociones con este estado</p>
          )}
        </div>
      ) : (
        <div className="surface-card overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nombre</TableHead>
                <TableHead>Promo</TableHead>
                <TableHead>Alcance</TableHead>
                <TableHead>Vigencia</TableHead>
                <TableHead>Catálogo</TableHead>
                <TableHead>Estado</TableHead>
                {!readOnly && <TableHead className="text-right">Acciones</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map(promo => {
                const status = getPromotionStatus(promo)
                const isArchived = status === 'archivada'
                return (
                  <TableRow key={promo.id} className={isArchived ? 'opacity-60' : ''}>
                    <TableCell className="font-medium text-heading">{promo.name}</TableCell>
                    <TableCell>
                      <span className="inline-flex items-center gap-1.5">
                        <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300">
                          {promoBadgeLabel(promo)}
                        </span>
                        <span className="text-xs text-subtle">{describePromotion(promo)}</span>
                      </span>
                    </TableCell>
                    <TableCell className="text-sm text-body max-w-[220px] truncate">{scopeLabel(promo)}</TableCell>
                    <TableCell className="text-xs text-subtle tabular-nums whitespace-nowrap">{vigenciaLabel(promo)}</TableCell>
                    <TableCell className="text-xs text-subtle">{promo.show_in_catalog ? 'Destacada' : '—'}</TableCell>
                    <TableCell>
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium ${STATUS_BADGE_CLASSES[status]}`}>
                        {STATUS_LABELS[status]}
                      </span>
                    </TableCell>
                    {!readOnly && (
                      <TableCell className="text-right">
                        {!isArchived && (
                          <div className="inline-flex items-center gap-1">
                            <button
                              onClick={() => { setEditing(promo); setModalOpen(true) }}
                              disabled={busyId !== null}
                              className="p-1.5 rounded-md text-hint hover:text-primary hover:bg-hover-bg transition-colors"
                              aria-label="Editar promoción"
                              title="Editar"
                            >
                              <Pencil size={14} />
                            </button>
                            <button
                              onClick={() => handleToggleActive(promo)}
                              disabled={busyId !== null}
                              className="p-1.5 rounded-md text-hint hover:text-primary hover:bg-hover-bg transition-colors"
                              aria-label={promo.is_active ? 'Pausar promoción' : 'Reanudar promoción'}
                              title={promo.is_active ? 'Pausar' : 'Reanudar'}
                            >
                              {promo.is_active ? <Pause size={14} /> : <Play size={14} />}
                            </button>
                            <button
                              onClick={() => setConfirmArchive(promo)}
                              disabled={busyId !== null}
                              className="p-1.5 rounded-md text-hint hover:text-red-500 hover:bg-hover-bg transition-colors"
                              aria-label="Archivar promoción"
                              title="Archivar"
                            >
                              <Archive size={14} />
                            </button>
                          </div>
                        )}
                      </TableCell>
                    )}
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      )}

      <PromotionModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        businessId={businessId}
        operatorId={operatorId}
        products={products}
        categories={categories}
        brands={brands}
        existingPromotions={promotions}
        initial={editing}
        onSaved={() => { void refresh() }}
      />

      {confirmArchive && (
        <ConfirmModal
          open
          title="Archivar promoción"
          message={`"${confirmArchive.name}" dejará de aplicar y no se puede desarchivar. El historial de ventas que la usaron se conserva.`}
          confirmLabel="Archivar"
          onConfirm={() => handleArchive(confirmArchive)}
          onCancel={() => setConfirmArchive(null)}
        />
      )}
    </div>
  )
}
