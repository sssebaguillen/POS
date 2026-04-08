'use client'

import { useEffect, useState } from 'react'
import { ExternalLink, FileSpreadsheet, FileText, ImageIcon, Loader2, X } from 'lucide-react'
import type { ExpenseAttachmentType } from './types'

interface Props {
  signedUrl: string
  type: ExpenseAttachmentType | null
  name: string | null
  onClose: () => void
}

function AttachmentIcon({ type }: { type: ExpenseAttachmentType | null }) {
  if (type === 'pdf') return <FileText size={16} className="text-red-500 shrink-0" />
  if (type === 'image') return <ImageIcon size={16} className="text-blue-500 shrink-0" />
  if (type === 'spreadsheet') return <FileSpreadsheet size={16} className="text-emerald-600 shrink-0" />
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
            Usá el botón &ldquo;Abrir&rdquo; para verlo en una nueva pestaña.
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
        Usá el botón &ldquo;Abrir en nueva pestaña&rdquo; para descargarlo.
      </p>
    </div>
  )
}

export default function ExpenseAttachmentModal({ signedUrl, type, name, onClose }: Props) {
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="surface-elevated rounded-2xl w-full max-w-3xl flex flex-col overflow-hidden"
        style={{ height: type === 'image' ? 'auto' : '85vh', maxHeight: '85vh' }}
      >
        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-edge/60 shrink-0">
          <AttachmentIcon type={type} />
          <p className="flex-1 text-sm font-medium text-heading truncate">
            {name ?? 'Adjunto'}
          </p>
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
            className="p-1 rounded-lg hover:bg-hover-bg transition-colors text-hint hover:text-body"
            title="Cerrar"
          >
            <X size={18} />
          </button>
        </div>

        {/* Content */}
        <PreviewContent signedUrl={signedUrl} type={type} name={name} />
      </div>
    </div>
  )
}
