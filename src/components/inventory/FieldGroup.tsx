import type { ReactNode } from 'react'

import { FieldErrorMessage, ShakeOnError } from '@/components/shared/ShakeError'

interface FieldGroupProps {
  label: ReactNode
  required?: boolean
  error?: string
  /** Incrementar en cada intento fallido para re-sacudir aunque el mensaje no cambie. */
  nonce?: number
  hint?: string
  badge?: ReactNode
  children: ReactNode
}

export default function FieldGroup({ label, required, error, nonce, hint, badge, children }: FieldGroupProps) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between gap-2">
        <label className="text-label text-subtle">
          {label}
          {required && <span className="text-destructive ml-0.5">*</span>}
        </label>
        {hint && <span className="text-caption text-emerald-600 dark:text-emerald-400 font-medium">{hint}</span>}
        {badge}
      </div>
      <ShakeOnError error={error} nonce={nonce}>{children}</ShakeOnError>
      <FieldErrorMessage error={error} className="text-caption" />
    </div>
  )
}
