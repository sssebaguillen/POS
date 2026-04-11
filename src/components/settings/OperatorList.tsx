'use client'

import { useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { type SettingsOperator } from '@/components/settings/types'
import { OPERATOR_ROLE_LABELS } from '@/lib/constants/domain'
import NewOperatorModal from '@/components/settings/NewOperatorModal'
import EditOperatorModal from '@/components/settings/EditOperatorModal'
import ConfirmModal from '@/components/shared/ConfirmModal'
import { useToast } from '@/hooks/useToast'
import Toast from '@/components/shared/Toast'

type ConfirmState = { title: string; message: string; onConfirm: () => void } | null

interface Props {
  businessId: string
  initialOperators: SettingsOperator[]
  isOwner: boolean
  canManageOperators: boolean
}

export default function OperatorList({
  businessId,
  initialOperators,
  isOwner,
  canManageOperators,
}: Props) {
  const supabase = useMemo(() => createClient(), [])
  const [operatorList, setOperatorList] = useState<SettingsOperator[]>(initialOperators)
  const [showNewOperatorModal, setShowNewOperatorModal] = useState(false)
  const [editingOperator, setEditingOperator] = useState<SettingsOperator | null>(null)
  const [deletingOperatorId, setDeletingOperatorId] = useState<string | null>(null)
  const [pendingConfirm, setPendingConfirm] = useState<ConfirmState>(null)
  const { toast, showToast, dismissToast } = useToast()

  function handleDeleteOperator(operator: SettingsOperator) {
    setPendingConfirm({
      title: `Eliminar operador "${operator.name}"`,
      message: 'Esta accion no se puede deshacer.',
      onConfirm: async () => {
        setDeletingOperatorId(operator.id)

        const { error: deleteError } = await supabase
          .from('operators')
          .delete()
          .eq('id', operator.id)
          .eq('business_id', businessId)

        setDeletingOperatorId(null)

        if (deleteError) {
          showToast({ message: deleteError.message })
          return
        }

        showToast({ message: 'Operador eliminado correctamente.' })
        setOperatorList(prev => prev.filter(item => item.id !== operator.id))
      },
    })
  }

  return (
    <div className="surface-card p-6 self-start">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold text-foreground">Operadores</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Creá subusuarios con PIN para cambiar el operador activo durante el turno.
          </p>
        </div>
        <Button
          type="button"
          className="h-9 px-4 rounded-lg text-sm font-semibold bg-primary hover:bg-primary/90 text-primary-foreground shrink-0"
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
              <p className="text-xs uppercase tracking-wide text-muted-foreground">{OPERATOR_ROLE_LABELS[operator.role]}</p>
            </div>
            <div className="flex items-center gap-2">
              {(isOwner || canManageOperators) && (
                <Button
                  type="button"
                  variant="outline"
                  className="h-8 px-3 text-xs"
                  onClick={() => setEditingOperator(operator)}
                >
                  Editar
                </Button>
              )}

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
          </div>
        ))}
      </div>

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

      {editingOperator && (
        <EditOperatorModal
          operator={editingOperator}
          businessId={businessId}
          isOwner={isOwner}
          canManageOperators={canManageOperators}
          onClose={() => setEditingOperator(null)}
          onUpdated={updatedOperator => {
            setOperatorList(prev =>
              prev
                .map(operator => (operator.id === updatedOperator.id ? updatedOperator : operator))
                .sort((a, b) => a.name.localeCompare(b.name))
            )
          }}
          onSuccess={message => showToast({ message })}
          onError={message => showToast({ message })}
        />
      )}

      <ConfirmModal
        open={pendingConfirm !== null}
        title={pendingConfirm?.title ?? ''}
        message={pendingConfirm?.message ?? ''}
        onConfirm={() => { pendingConfirm?.onConfirm(); setPendingConfirm(null) }}
        onCancel={() => setPendingConfirm(null)}
      />

      {toast && <Toast message={toast.message} duration={toast.duration} onUndo={toast.onUndo} onDismiss={dismissToast} />}
    </div>
  )
}
