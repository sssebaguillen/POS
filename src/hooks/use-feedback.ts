'use client'

import { useCallback, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

export type FeedbackType = 'bug' | 'sugerencia' | 'otro'

export interface SubmitInput {
  type: FeedbackType
  message: string
  contactEmail?: string | null
  screenshot?: File | null
}

const MAX_SCREENSHOT_BYTES = 5 * 1024 * 1024
const ALLOWED_MIME = ['image/png', 'image/jpeg', 'image/webp', 'image/gif']

export function useFeedback(businessId: string) {
  const supabase = useMemo(() => createClient(), [])
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = useCallback(
    async (input: SubmitInput): Promise<boolean> => {
      setError(null)
      const message = input.message.trim()
      if (message.length < 10 || message.length > 1000) {
        setError('El mensaje debe tener entre 10 y 1000 caracteres.')
        return false
      }

      setIsSubmitting(true)
      try {
        let attachmentPath: string | null = null

        if (input.screenshot) {
          const file = input.screenshot
          if (!ALLOWED_MIME.includes(file.type)) {
            setError('Formato no permitido. Solo PNG, JPEG, WebP o GIF.')
            return false
          }
          if (file.size > MAX_SCREENSHOT_BYTES) {
            setError('La imagen no puede superar 5 MB.')
            return false
          }
          const ext = (file.name.split('.').pop() ?? 'png').toLowerCase()
          const path = `${businessId}/${crypto.randomUUID()}.${ext}`
          const { data, error: uploadError } = await supabase.storage
            .from('feedback-attachments')
            .upload(path, file, { upsert: false, contentType: file.type })
          if (uploadError || !data) {
            setError(uploadError?.message ?? 'No se pudo subir la imagen.')
            return false
          }
          attachmentPath = data.path
        }

        const res = await fetch('/api/feedback', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: input.type,
            message,
            contactEmail: input.contactEmail ?? null,
            route: typeof window !== 'undefined' ? window.location.pathname : null,
            attachmentPath,
          }),
        })

        if (!res.ok) {
          const payload = (await res.json().catch(() => null)) as { error?: string } | null
          setError(payload?.error ?? 'No se pudo enviar el feedback.')
          return false
        }

        return true
      } catch (err) {
        console.error('[useFeedback] submit failed', err)
        setError('Error inesperado al enviar el feedback.')
        return false
      } finally {
        setIsSubmitting(false)
      }
    },
    [businessId, supabase]
  )

  return { submit, isSubmitting, error, clearError: () => setError(null) }
}
