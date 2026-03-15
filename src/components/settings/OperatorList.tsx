'use client'

import { useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { type OperatorRole, type SettingsOperator } from '@/components/settings/types'
import NewOperatorModal from '@/components/settings/NewOperatorModal'

interface Props {
  businessId: string
  initialOperators: SettingsOperator[]
}

function roleLabel(role: OperatorRole): string {
  if (role === 'manager') return 'Manager'
  if (role === 'custom') return 'Custom'
  return 'Cashier'
}

export default function OperatorList({ businessId, initialOperators }: Props) {
  const supabase = useMemo(() => createClient(), [])
  const [operatorList, setOperatorList] = useState<SettingsOperator[]>(initialOperators)
  const [showNewOperatorModal, setShowNewOperatorModal] = useState(false)
  const [operatorError, setOperatorError] = useState('')
  const [operatorSuccess, setOperatorSuccess] = useState('')
  const [deletingOperatorId, setDeletingOperatorId] = useState<string | null>(null)

  async function handleDeleteOperator(operator: SettingsOperator) {
    const confirmed = window.confirm(`Eliminar operador ${operator.name}?`)
    if (!confirmed) {
      return
    }

    setDeletingOperatorId(operator.id)
    setOperatorError('')
    setOperatorSuccess('')

    const { error: deleteError } = await supabase
      .from('operators')
      .delete()
      .eq('id', operator.id)
      .eq('business_id', businessId)

    setDeletingOperatorId(null)

    if (deleteError) {
      setOperatorError(deleteError.message)
      return
    }

    setOperatorSuccess('Operador eliminado correctamente.')
    setOperatorList(prev => prev.filter(item => item.id !== operator.id))
  }

  return (
    <div className="rounded-xl bg-card border border-border/60 p-6 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold text-foreground">Operadores</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Creá subusuarios con PIN para cambiar el operador activo durante el turno.
          </p>
        </div>
        <Button
          type="button"
          size="sm"
          className="shrink-0 rounded-lg text-xs bg-primary hover:bg-primary/90 text-primary-foreground"
          onClick={() => setShowNewOperatorModal(true)}
        >
          + Nuevo operario
        </Button>
      </div>

      <div className="mt-5 space-y-2">
        {operatorList.map(operator => (
          <div
            key={operator.id}
            className="flex items-center justify-between rounded-lg border border-border/60 bg-background px-3 py-2"
          >
            <div>
              <p className="text-sm font-medium text-foreground">{operator.name}</p>
              <p className="text-xs uppercase tracking-wide text-muted-foreground">{roleLabel(operator.role)}</p>
            </div>
            <Button
              type="button"
              variant="outline"
              className="h-8 px-3 text-xs"
              disabled={deletingOperatorId === operator.id}
              onClick={() => handleDeleteOperator(operator)}
            >
              {deletingOperatorId === operator.id ? 'Eliminando...' : 'Eliminar'}
            </Button>
          </div>
        ))}
      </div>

      {operatorError && (
        <p className="mt-4 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {operatorError}
        </p>
      )}

      {operatorSuccess && (
        <p className="mt-4 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700 dark:border-green-500/30 dark:bg-green-500/10 dark:text-green-400">
          {operatorSuccess}
        </p>
      )}

      <NewOperatorModal
        open={showNewOperatorModal}
        onClose={() => setShowNewOperatorModal(false)}
        businessId={businessId}
        onCreated={operator => {
          setOperatorList(prev =>
            [...prev, operator].sort((a, b) => a.name.localeCompare(b.name))
          )
        }}
      />
    </div>
  )
}
