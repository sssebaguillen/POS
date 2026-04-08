'use client'

import { useState, useRef, useMemo } from 'react'
import { Upload, X, FileText, FileSpreadsheet } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import type { ExpenseAttachmentType } from './types'

const ACCEPTED = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf',
  'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/csv']
const MAX_BYTES = 10 * 1024 * 1024

function getMimeAttachmentType(mimeType: string): ExpenseAttachmentType {
  if (mimeType.startsWith('image/')) return 'image'
  if (mimeType === 'application/pdf') return 'pdf'
  if (
    mimeType === 'application/vnd.ms-excel' ||
    mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
    mimeType === 'text/csv'
  ) return 'spreadsheet'
  return 'other'
}

interface UploadResult {
  url: string
  type: ExpenseAttachmentType
  name: string
}

interface Props {
  businessId: string
  onUpload: (result: UploadResult) => void
  onRemove: () => void
  current?: UploadResult | null
}

export default function ExpenseAttachmentUploader({ businessId, onUpload, onRemove, current }: Props) {
  const supabase = useMemo(() => createClient(), [])
  const [dragging, setDragging] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [localPreviewUrl, setLocalPreviewUrl] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  async function handleFile(file: File) {
    setError(null)
    if (!ACCEPTED.includes(file.type)) {
      setError('Tipo de archivo no permitido. Se aceptan: imágenes, PDF, Excel y CSV.')
      return
    }
    if (file.size > MAX_BYTES) {
      setError('El archivo es demasiado grande. El límite es 10MB.')
      return
    }
    setUploading(true)
    setProgress(20)
    const ext = file.name.split('.').pop() ?? 'bin'
    const path = `${businessId}/${crypto.randomUUID()}.${ext}`
    setProgress(50)
    const { data, error: uploadError } = await supabase.storage
      .from('expense-receipts')
      .upload(path, file, { upsert: false })
    if (uploadError || !data) {
      setError(uploadError?.message ?? 'Error al subir el archivo')
      setUploading(false)
      setProgress(0)
      return
    }
    setProgress(90)
    // Generate a short-lived signed URL for the local preview only.
    // The storage path (data.path) is what gets persisted to the DB.
    const { data: signedData } = await supabase.storage
      .from('expense-receipts')
      .createSignedUrl(data.path, 3600)
    setLocalPreviewUrl(signedData?.signedUrl ?? null)
    setProgress(100)
    setUploading(false)
    onUpload({
      url: data.path,
      type: getMimeAttachmentType(file.type),
      name: file.name,
    })
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) handleFile(file)
  }

  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) handleFile(file)
  }

  if (current) {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-edge bg-surface-alt px-4 py-3">
        {current.type === 'image' && localPreviewUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={localPreviewUrl}
            alt={current.name}
            className="h-12 w-12 rounded-lg object-cover border border-edge shrink-0"
          />
        ) : current.type === 'image' ? (
          <FileText size={28} className="text-blue-500 shrink-0" />
        ) : current.type === 'pdf' ? (
          <FileText size={28} className="text-red-500 shrink-0" />
        ) : (
          <FileSpreadsheet size={28} className="text-emerald-600 shrink-0" />
        )}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-heading truncate">{current.name}</p>
          <p className="text-xs text-hint capitalize">{current.type}</p>
        </div>
        <button
          type="button"
          onClick={() => { setLocalPreviewUrl(null); onRemove() }}
          className="p-1 rounded-lg hover:bg-hover-bg transition-colors text-hint hover:text-destructive"
        >
          <X size={16} />
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-1.5">
      <div
        onDragOver={e => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
        className={`
          border-2 border-dashed rounded-xl px-4 py-6 flex flex-col items-center gap-2 cursor-pointer transition-colors
          ${dragging ? 'border-primary bg-primary/5' : 'border-edge hover:border-primary/50 hover:bg-hover-bg'}
        `}
      >
        {uploading ? (
          <>
            <div className="h-2 w-full max-w-xs rounded-full bg-surface-alt overflow-hidden">
              <div
                className="h-2 rounded-full bg-primary transition-all duration-300"
                style={{ width: `${progress}%` }}
              />
            </div>
            <p className="text-sm text-hint">Subiendo archivo...</p>
          </>
        ) : (
          <>
            <Upload size={22} className="text-hint" />
            <p className="text-sm text-body text-center">
              Arrastrá un archivo aquí o <span className="text-primary font-medium">hacé clic para elegir</span>
            </p>
            <p className="text-xs text-hint">Imágenes, PDF, Excel, CSV — máx. 10MB</p>
          </>
        )}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED.join(',')}
        className="hidden"
        onChange={handleInputChange}
      />
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  )
}
