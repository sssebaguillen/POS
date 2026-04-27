'use client'

import { useState, useEffect } from 'react'
import { Trash2, Power, PowerOff, Tag, Stamp } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import SelectDropdown from '@/components/ui/SelectDropdown'
import ConfirmModal from '@/components/shared/ConfirmModal'
import type { InventoryCategory, InventoryBrand } from '@/components/inventory/types'

interface BulkActionBarProps {
  selectedCount: number
  categories: InventoryCategory[]
  brands: InventoryBrand[]
  loading: boolean
  onDelete: () => void
  onActivate: () => void
  onDeactivate: () => void
  onChangeCategory: (categoryId: string | null) => void
  onChangeBrand: (brandId: string | null) => void
}

export default function BulkActionBar({
  selectedCount,
  categories,
  brands,
  loading,
  onDelete,
  onActivate,
  onDeactivate,
  onChangeCategory,
  onChangeBrand,
}: BulkActionBarProps) {
  const [visible, setVisible] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [categoryOpen, setCategoryOpen] = useState(false)
  const [brandOpen, setBrandOpen] = useState(false)
  const [selectedCategoryId, setSelectedCategoryId] = useState('')
  const [selectedBrandId, setSelectedBrandId] = useState('')

  // Slide-in al montar
  useEffect(() => {
    const frame = requestAnimationFrame(() => setVisible(true))
    return () => cancelAnimationFrame(frame)
  }, [])

  const categoryOptions = [
    { value: '__none__', label: 'Sin categoría' },
    ...categories.map(c => ({ value: c.id, label: c.icon ? `${c.icon} ${c.name}` : c.name })),
  ]

  const brandOptions = [
    { value: '__none__', label: 'Sin marca' },
    ...brands.map(b => ({ value: b.id, label: b.name })),
  ]

  function handleCategoryConfirm() {
    onChangeCategory(selectedCategoryId === '__none__' ? null : selectedCategoryId)
    setCategoryOpen(false)
    setSelectedCategoryId('')
  }

  function handleBrandConfirm() {
    onChangeBrand(selectedBrandId === '__none__' ? null : selectedBrandId)
    setBrandOpen(false)
    setSelectedBrandId('')
  }

  return (
    <>
      <div className="fixed bottom-14 inset-x-0 z-40 flex items-center justify-center px-4 pointer-events-none">
        <div
          className={`surface-elevated rounded-2xl shadow-2xl border border-edge/60 px-5 py-3 flex items-center gap-3 pointer-events-auto overflow-x-auto flex-nowrap transition-all duration-300 ease-out ${
            visible ? 'opacity-100 translate-y-0' : 'opacity-0 motion-safe:translate-y-8'
          }`}
        >
          <span className="text-sm font-semibold text-heading shrink-0 whitespace-nowrap">
            {selectedCount} {selectedCount === 1 ? 'producto' : 'productos'}
          </span>

          <div className="h-5 w-px bg-edge/60 shrink-0" />

          <div className="flex items-center gap-2 shrink-0">
            <Button
              variant="outline"
              size="sm"
              className="rounded-lg text-xs gap-1.5 hover:bg-surface-alt"
              disabled={loading}
              onClick={onActivate}
            >
              <Power size={13} />
              Activar
            </Button>

            <Button
              variant="outline"
              size="sm"
              className="rounded-lg text-xs gap-1.5 hover:bg-surface-alt"
              disabled={loading}
              onClick={onDeactivate}
            >
              <PowerOff size={13} />
              Discontinuar
            </Button>

            <Popover open={categoryOpen} onOpenChange={setCategoryOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="rounded-lg text-xs gap-1.5 hover:bg-surface-alt"
                  disabled={loading}
                >
                  <Tag size={13} />
                  Categoría
                </Button>
              </PopoverTrigger>
              <PopoverContent side="top" align="center" className="w-64 p-3 space-y-3">
                <p className="text-xs font-semibold text-heading">Cambiar categoría</p>
                <SelectDropdown
                  value={selectedCategoryId}
                  onChange={setSelectedCategoryId}
                  options={categoryOptions}
                  placeholder="Seleccionar categoría"
                  usePortal
                />
                <div className="flex justify-end gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="rounded-lg text-xs"
                    onClick={() => setCategoryOpen(false)}
                  >
                    Cancelar
                  </Button>
                  <Button
                    size="sm"
                    className="rounded-lg text-xs bg-primary hover:bg-primary/90 text-primary-foreground"
                    disabled={!selectedCategoryId}
                    onClick={handleCategoryConfirm}
                  >
                    Aplicar
                  </Button>
                </div>
              </PopoverContent>
            </Popover>

            <Popover open={brandOpen} onOpenChange={setBrandOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="rounded-lg text-xs gap-1.5 hover:bg-surface-alt"
                  disabled={loading}
                >
                  <Stamp size={13} />
                  Marca
                </Button>
              </PopoverTrigger>
              <PopoverContent side="top" align="center" className="w-64 p-3 space-y-3">
                <p className="text-xs font-semibold text-heading">Cambiar marca</p>
                <SelectDropdown
                  value={selectedBrandId}
                  onChange={setSelectedBrandId}
                  options={brandOptions}
                  placeholder="Seleccionar marca"
                  usePortal
                />
                <div className="flex justify-end gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="rounded-lg text-xs"
                    onClick={() => setBrandOpen(false)}
                  >
                    Cancelar
                  </Button>
                  <Button
                    size="sm"
                    className="rounded-lg text-xs bg-primary hover:bg-primary/90 text-primary-foreground"
                    disabled={!selectedBrandId}
                    onClick={handleBrandConfirm}
                  >
                    Aplicar
                  </Button>
                </div>
              </PopoverContent>
            </Popover>

            <Button
              variant="outline"
              size="sm"
              className="rounded-lg text-xs gap-1.5 border-red-200 dark:border-red-800/50 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30"
              disabled={loading}
              onClick={() => setShowDeleteConfirm(true)}
            >
              <Trash2 size={13} />
              Eliminar
            </Button>
          </div>
        </div>
      </div>

      <ConfirmModal
        open={showDeleteConfirm}
        title={`Eliminar ${selectedCount} ${selectedCount === 1 ? 'producto' : 'productos'}`}
        message="Los productos con ventas registradas serán discontinuados en lugar de eliminarse. Esta acción no se puede deshacer."
        confirmLabel="Eliminar"
        onConfirm={() => {
          setShowDeleteConfirm(false)
          onDelete()
        }}
        onCancel={() => setShowDeleteConfirm(false)}
      />
    </>
  )
}