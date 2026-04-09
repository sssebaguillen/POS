'use client'

interface Props {
  error: Error
  reset: () => void
}

export default function SettingsError({ error }: Props) {
  return (
    <div className="flex flex-col h-screen overflow-hidden">
      <div className="flex-1 overflow-y-auto p-6">
        <div className="surface-card p-6">
          <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            {error.message}
          </p>
        </div>
      </div>
    </div>
  )
}
