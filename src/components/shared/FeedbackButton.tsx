'use client'

import { useState } from 'react'
import { ChatCircleDots } from '@phosphor-icons/react/dist/ssr'
import FeedbackModal from './FeedbackModal'
import { useToast } from '@/hooks/useToast'

interface Props {
  businessId: string
  showLabel?: boolean
}

export default function FeedbackButton({ businessId, showLabel = true }: Props) {
  const [open, setOpen] = useState(false)
  const { showToast } = useToast()

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={showLabel ? undefined : 'Comentarios'}
        aria-label="Comentarios"
        className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-xs text-hint hover:text-body hover:bg-hover-bg transition-[transform,background-color,color] duration-150 ease-[var(--ease-out)] active:scale-[0.97]"
      >
        {showLabel && <span>Comentarios</span>}
        <ChatCircleDots size={12} />

      </button>

      <FeedbackModal
        open={open}
        onOpenChange={setOpen}
        businessId={businessId}
        onSuccess={() => showToast({ message: '¡Gracias! Tu mensaje llegó.' })}
      />
    </>
  )
}
