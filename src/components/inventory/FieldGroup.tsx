import type { ReactNode } from 'react'

interface FieldGroupProps {
  label: ReactNode
  required?: boolean
  error?: string
  hint?: string
  badge?: ReactNode
  children: ReactNode
}

export default function FieldGroup({ label, required, error, hint, badge, children }: FieldGroupProps) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between gap-2">
        <label className="text-label text-subtle">
          {label}
          {required && <span className="text-red-400 ml-0.5">*</span>}
        </label>
        {hint && <span className="text-caption text-emerald-600 dark:text-emerald-400 font-medium">{hint}</span>}
        {badge}
      </div>
      {children}
      {error && <p className="text-caption text-red-500">{error}</p>}
    </div>
  )
}
