'use client'

import { useState, useEffect } from 'react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { DynamicIcon } from '@/components/inventory/CategoryIconPreview'
import { cn } from '@/lib/utils'

export const CATEGORY_ICONS = [
  { name: 'ShoppingCart',  label: 'Carrito'    },
  { name: 'Tag',           label: 'Etiqueta'   },
  { name: 'Package',       label: 'Paquete'    },
  { name: 'Apple',         label: 'Alimentos'  },
  { name: 'Coffee',        label: 'Bebidas'    },
  { name: 'Beef',          label: 'Carnes'     },
  { name: 'Milk',          label: 'Lácteos'    },
  { name: 'Carrot',        label: 'Verduras'   },
  { name: 'Cookie',        label: 'Dulces'     },
  { name: 'Sandwich',      label: 'Comidas'    },
  { name: 'Wine',          label: 'Vinos'      },
  { name: 'Beer',          label: 'Cervezas'   },
  { name: 'Pill',          label: 'Farmacia'   },
  { name: 'Shirt',         label: 'Ropa'       },
  { name: 'Scissors',      label: 'Peluquería' },
  { name: 'Wrench',        label: 'Ferretería' },
  { name: 'Zap',           label: 'Electrónica'},
  { name: 'Sparkles',      label: 'Limpieza'   },
  { name: 'PawPrint',      label: 'Mascotas'   },
  { name: 'Baby',          label: 'Bebés'      },
  { name: 'Book',          label: 'Libros'     },
  { name: 'Music',         label: 'Música'     },
  { name: 'Gamepad2',      label: 'Juegos'     },
  { name: 'Dumbbell',      label: 'Deporte'    },
  { name: 'Flower2',       label: 'Flores'     },
  { name: 'Home',          label: 'Hogar'      },
  { name: 'Car',           label: 'Autos'      },
  { name: 'Bike',          label: 'Bicicletas' },
  { name: 'Stethoscope',   label: 'Salud'      },
  { name: 'GraduationCap', label: 'Educación'  },
  { name: 'Gift',          label: 'Regalos'    },
  { name: 'Star',          label: 'Destacados' },
] as const

export const ICON_COLOR_PRESETS = [
  '#7a3e10', '#b45309', '#16a34a', '#2563eb',
  '#7c3aed', '#db2777', '#dc2626', '#0891b2', '#374151',
]

interface IconPickerPanelProps {
  selectedIcon: string
  selectedColor: string
  onConfirm: (icon: string, color: string) => void
  onCancel: () => void
}

export default function IconPickerPanel({
  selectedIcon,
  selectedColor,
  onConfirm,
  onCancel,
}: IconPickerPanelProps) {
  const [localIcon, setLocalIcon] = useState(selectedIcon)
  const [localColor, setLocalColor] = useState(selectedColor)
  const [search, setSearch] = useState('')

  useEffect(() => {
    setLocalIcon(selectedIcon)
    setLocalColor(selectedColor)
    setSearch('')
  }, [selectedIcon, selectedColor])

  const filtered = CATEGORY_ICONS.filter(i =>
    !search.trim() || i.label.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div className="flex flex-col">
      {/* Sub-header with back arrow */}
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-edge/60">
        <button
          type="button"
          onClick={onCancel}
          className="p-1 rounded-md hover:bg-hover-bg transition-[transform,background-color,color] duration-150 ease-[var(--ease-out)] active:scale-90 text-hint text-base leading-none"
          aria-label="Volver"
        >
          ←
        </button>
        <span className="text-sm font-semibold text-heading">Elegir icono</span>
      </div>

      {/* Search */}
      <div className="px-4 pt-3 pb-2">
        <Input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Buscar icono…"
          className="h-8 text-sm bg-surface border-edge focus-visible:ring-ring/50 focus-visible:border-ring"
          autoFocus
        />
      </div>

      {/* Icon grid */}
      <div className="px-4 pb-2 max-h-52 overflow-y-auto">
        <div className="grid grid-cols-4 gap-2">
          {filtered.map(({ name, label }) => (
            <button
              key={name}
              type="button"
              onClick={() => setLocalIcon(name)}
              className={cn(
                'flex flex-col items-center justify-center gap-1 rounded-lg p-2 h-16',
                'border transition-colors hover:bg-accent',
                localIcon === name ? 'border-2 bg-accent/60' : 'border-transparent',
              )}
              style={localIcon === name ? { borderColor: localColor } : undefined}
              aria-label={label}
              aria-pressed={localIcon === name}
            >
              <DynamicIcon name={name} size={22} color={localColor} />
              <span className="text-[10px] text-subtle leading-tight truncate w-full text-center px-0.5">
                {label}
              </span>
            </button>
          ))}
          {filtered.length === 0 && (
            <p className="col-span-4 py-4 text-center text-sm text-hint">Sin resultados</p>
          )}
        </div>
      </div>

      {/* Color presets */}
      <div className="px-4 py-2.5 border-t border-edge/60">
        <p className="text-[11px] font-medium text-subtle mb-2">Color del icono</p>
        <div className="flex items-center gap-2 flex-wrap">
          {ICON_COLOR_PRESETS.map(hex => (
            <button
              key={hex}
              type="button"
              onClick={() => setLocalColor(hex)}
              className={cn(
                'w-6 h-6 rounded-full border-2 transition-all hover:scale-110',
                localColor === hex ? 'scale-110 border-heading' : 'border-transparent',
              )}
              style={{ backgroundColor: hex }}
              aria-label={hex}
              aria-pressed={localColor === hex}
            />
          ))}
          <input
            type="color"
            value={localColor}
            onChange={e => setLocalColor(e.target.value)}
            className="w-6 h-6 rounded-full cursor-pointer border-0 p-0 bg-transparent"
            title="Color personalizado"
          />
        </div>
      </div>

      {/* Live preview */}
      <div className="px-4 py-2 border-t border-edge/60">
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-muted/50 w-fit">
          <DynamicIcon name={localIcon} size={18} color={localColor} />
          <span className="text-sm font-medium" style={{ color: localColor }}>Vista previa</span>
        </div>
      </div>

      {/* Footer */}
      <div className="px-4 py-3 border-t border-edge flex justify-end gap-2">
        <Button
          type="button"
          variant="ghost"
          className="h-9 px-4 rounded-lg text-sm"
          onClick={onCancel}
        >
          Cancelar
        </Button>
        <Button
          type="button"
          className="h-9 px-4 rounded-lg text-sm bg-primary hover:bg-primary/90 text-primary-foreground"
          onClick={() => onConfirm(localIcon, localColor)}
        >
          Confirmar
        </Button>
      </div>
    </div>
  )
}
