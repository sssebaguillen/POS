'use client'

import { useState } from 'react'
import { MessageSquarePlus } from 'lucide-react'
import FeedbackModal from './FeedbackModal'
import Toast from './Toast'

interface Props {
  businessId: string
  showLabel?: boolean
}

export default function FeedbackButton({ businessId, showLabel = true }: Props) {
  const [open, setOpen] = useState(false)
  const [showToast, setShowToast] = useState(false)

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={showLabel ? undefined : 'Comentarios'}
        aria-label="Comentarios"
        className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-xs text-hint hover:text-body hover:bg-hover-bg transition-colors"
      >
        {showLabel && <span>Comentarios</span>}
        <MessageSquarePlus size={12} />

      </button>

      <FeedbackModal
        open={open}
        onOpenChange={setOpen}
        businessId={businessId}
        onSuccess={() => setShowToast(true)}
      />

      {showToast && (
        <Toast
          message="¡Gracias! Tu mensaje llegó."
          onDismiss={() => setShowToast(false)}
        />
      )}
    </>
  )
}
