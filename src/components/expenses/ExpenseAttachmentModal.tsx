'use client'

import { useEffect, useState } from 'react'
import { ExternalLink, FileSpreadsheet, FileText, ImageIcon, Loader2, X } from 'lucide-react'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import type { ExpenseAttachmentType } from './types'

interface Props {
  open: boolean
  signedUrl: string
  type: ExpenseAttachmentType | null
  name: string | null
  onClose: () => void
}

function AttachmentIcon({ type }: { type: ExpenseAttachmentType | null }) {
  if (type === 'pdf') return <FileText size={16} className="text-destructive shrink-0" />
  if (type === 'image') return <ImageIcon size={16} className="text-primary shrink-0" />
  if (type === 'spreadsheet') return <FileSpreadsheet size={16} className="text-body shrink-0" />
  return <FileText size={16} className="text-hint shrink-0" />
}

type PdfViewState =
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'fetched'; blobUrl: string; iframeReady: boolean }

function PreviewContent({ signedUrl, type, name }: { signedUrl: string; type: ExpenseAttachmentType | null; name: string | null }) {
  // PDFs are fetched as a blob and served via a local object URL.
  // This avoids iframe CSP restrictions on cross-origin URLs and bypasses
  // any X-Frame-Options headers that Supabase Storage may send.
  const [pdfState, setPdfState] = useState<PdfViewState>({ kind: 'loading' })

  useEffect(() => {
    if (type !== 'pdf') return
    let cancelled = false
    let objectUrl: string | null = null

    fetch(signedUrl)
      .then(res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return res.blob()
      })
      .then(blob => {
        if (cancelled) return
        objectUrl = URL.createObjectURL(blob)
        setPdfState({ kind: 'fetched', blobUrl: objectUrl, iframeReady: false })
      })
      .catch(() => {
        if (!cancelled) setPdfState({ kind: 'error' })
      })

    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [signedUrl, type])

  if (type === 'pdf') {
    if (pdfState.kind === 'error') {
      return (
        <div className="flex-1 min-h-0 flex flex-col items-center justify-center gap-3 p-8 bg-surface">
          <FileText size={40} className="text-hint opacity-50" />
          <p className="text-sm text-body text-center">No se pudo cargar el documento.</p>
          <p className="text-xs text-hint text-center">
            Usa el botón &ldquo;Abrir&rdquo; para verlo en una nueva pestaña.
          </p>
        </div>
      )
    }
    return (
      <div className="relative flex-1 min-h-0">
        {(pdfState.kind !== 'fetched' || !pdfState.iframeReady) && (
          <div className="absolute inset-0 flex items-center justify-center bg-surface">
            <Loader2 size={24} className="animate-spin text-primary" />
          </div>
        )}
        {pdfState.kind === 'fetched' && (
          <iframe
            src={pdfState.blobUrl}
            title={name ?? 'Adjunto'}
            className="w-full h-full border-0"
            onLoad={() => setPdfState(s => s.kind === 'fetched' ? { ...s, iframeReady: true } : s)}
          />
        )}
      </div>
    )
  }

  if (type === 'image') {
    return (
      <div className="flex-1 min-h-0 flex items-center justify-center p-4 bg-surface overflow-auto">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={signedUrl}
          alt={name ?? 'Adjunto'}
          className="max-w-full max-h-full object-contain rounded-lg"
        />
      </div>
    )
  }

  // spreadsheet, other, or unknown — no inline preview available
  return (
    <div className="flex-1 min-h-0 flex flex-col items-center justify-center gap-3 p-8 bg-surface">
      <FileSpreadsheet size={40} className="text-hint opacity-50" />
      <p className="text-sm text-body text-center">
        Este tipo de archivo no se puede previsualizar.
      </p>
      <p className="text-xs text-hint text-center">
        Usa el botón &ldquo;Abrir en nueva pestaña&rdquo; para descargarlo.
      </p>
    </div>
  )
}

export default function ExpenseAttachmentModal({ open, signedUrl, type, name, onClose }: Props) {
  return (
    <Dialog open={open} onOpenChange={next => { if (!next) onClose() }}>
      <DialogContent
        showCloseButton={false}
        className="flex flex-col p-0 overflow-hidden sm:max-w-3xl"
        style={{ height: type === 'image' ? 'auto' : '85vh', maxHeight: '85vh' }}
      >
        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-edge/60 shrink-0">
          <AttachmentIcon type={type} />
          <DialogTitle className="flex-1 text-sm font-medium text-heading truncate">
            {name ?? 'Adjunto'}
          </DialogTitle>
          <a
            href={signedUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 text-xs text-hint hover:text-body transition-colors px-2 py-1 rounded-lg hover:bg-hover-bg"
            title="Abrir en nueva pestaña"
          >
            <ExternalLink size={13} />
            <span className="hidden sm:inline">Abrir</span>
          </a>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            className="p-1.5 rounded-lg hover:bg-hover-bg transition-[transform,background-color,color] duration-150 ease-[var(--ease-out)] active:scale-95 text-hint"
            title="Cerrar"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <PreviewContent signedUrl={signedUrl} type={type} name={name} />
      </DialogContent>
    </Dialog>
  )
}
