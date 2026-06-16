'use client'

import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { ChangelogChangeType, ChangelogRelease } from '@/hooks/use-changelog'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  releases: ChangelogRelease[]
  hiddenPatchCount: number
  onClose: () => void
}

const TYPE_LABEL: Record<ChangelogChangeType, string> = {
  new: 'Nuevo',
  fix: 'Fix',
  improvement: 'Mejora',
}

const TYPE_CLASS: Record<ChangelogChangeType, string> = {
  new: 'bg-success/10 text-success border border-success/20',
  fix: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20',
  improvement: 'bg-sky-500/10 text-sky-600 dark:text-sky-400 border border-sky-500/20',
}

const DATE_FORMATTER = new Intl.DateTimeFormat('es-AR', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
})

function formatDate(value: string): string {
  const parsed = new Date(`${value}T00:00:00`)
  if (Number.isNaN(parsed.getTime())) return value
  return DATE_FORMATTER.format(parsed)
}

export default function ChangelogModal({ open, onOpenChange, releases, hiddenPatchCount, onClose }: Props) {
  const latest = releases[0]

  function handleClose() {
    onClose()
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose(); onOpenChange(next) }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-lg font-semibold text-heading font-display tracking-tight">
            {latest ? `Novedades — v${latest.version}` : 'Novedades'}
          </DialogTitle>
        </DialogHeader>

        <div className="max-h-[60vh] overflow-y-auto -mx-4 px-4 space-y-6">
          {releases.map((release, idx) => (
            <section key={release.version} className={cn(idx > 0 && 'border-t border-edge pt-5')}>
              <div className="mb-3">
                <p className="text-xs font-semibold text-heading mb-0.5">
                  v{release.version} · {release.label}
                </p>
                <p className="text-xs text-hint">{formatDate(release.date)}</p>
              </div>
              <ul className="space-y-2.5">
                {release.changes.map((change, i) => (
                  <li key={i} className="flex items-start gap-2.5">
                    <span
                      className={cn(
                        'shrink-0 inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide leading-none mt-0.5',
                        TYPE_CLASS[change.type]
                      )}
                    >
                      {TYPE_LABEL[change.type]}
                    </span>
                    <span className="text-sm text-body leading-relaxed">{change.text}</span>
                  </li>
                ))}
              </ul>
            </section>
          ))}

          {hiddenPatchCount > 0 && (
            <p className="border-t border-edge pt-4 text-xs text-hint">
              + {hiddenPatchCount} {hiddenPatchCount === 1 ? 'corrección anterior' : 'correcciones anteriores'}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button onClick={handleClose}>Entendido</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
