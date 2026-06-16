'use client'

import { useState } from 'react'
import { Sparkles, Loader2, Check, X, AlertCircle } from 'lucide-react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { Button } from '@/components/ui/button'
import { formatMoney } from '@/lib/format'
import { EXPENSE_CATEGORY_LABELS, type ExpenseCategory, type ExpenseAttachmentType } from './types'

export interface ExpenseSuggestion {
  supplier_name: string | null
  date: string | null
  amount: number | null
  category: ExpenseCategory
  description: string | null
}

interface Attachment {
  url: string
  type: ExpenseAttachmentType
  name: string
  file?: File
}

interface Props {
  attachment: Attachment
  supabaseClient: SupabaseClient
  onApply: (suggestion: ExpenseSuggestion) => void
}

type Status = 'idle' | 'loading' | 'result' | 'empty' | 'error' | 'applied'

// Solo escaneamos documentos de texto (PDF con capa de texto + planillas). La foto/imagen
// queda para fase 2 (requiere visión).
function isScannable(type: ExpenseAttachmentType): boolean {
  return type === 'pdf' || type === 'spreadsheet'
}

async function spreadsheetToText(file: File): Promise<string> {
  const isCsv = file.type === 'text/csv' || file.name.toLowerCase().endsWith('.csv')
  if (isCsv) return await file.text()
  // Excel: convertir la primera hoja a CSV. xlsx se importa dinámico para no engordar el bundle.
  const XLSX = await import('@e965/xlsx')
  const buf = await file.arrayBuffer()
  const wb = XLSX.read(buf, { type: 'array' })
  const firstSheet = wb.Sheets[wb.SheetNames[0]]
  return firstSheet ? XLSX.utils.sheet_to_csv(firstSheet) : ''
}

export default function ExpenseScanCard({ attachment, supabaseClient, onApply }: Props) {
  const [status, setStatus] = useState<Status>('idle')
  const [suggestion, setSuggestion] = useState<ExpenseSuggestion | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  if (!isScannable(attachment.type)) return null

  async function handleScan() {
    setStatus('loading')
    setErrorMsg(null)
    try {
      let body: Record<string, unknown>
      if (attachment.type === 'pdf') {
        body = { mode: 'pdf', storagePath: attachment.url }
      } else {
        if (!attachment.file) {
          setStatus('error')
          setErrorMsg('Volvé a subir la planilla para poder escanearla.')
          return
        }
        const text = await spreadsheetToText(attachment.file)
        if (!text.trim()) {
          setStatus('empty')
          return
        }
        body = { mode: 'text', text }
      }

      const { data, error } = await supabaseClient.functions.invoke('extract-expense', { body })
      if (error) {
        setStatus('error')
        setErrorMsg('No pudimos analizar el documento. Probá de nuevo en un momento.')
        return
      }
      const result = data as { success: boolean; suggestion: ExpenseSuggestion | null }
      if (!result?.success) {
        setStatus('error')
        setErrorMsg('No pudimos analizar el documento. Probá de nuevo en un momento.')
        return
      }
      if (!result.suggestion) {
        setStatus('empty')
        return
      }
      const sug = result.suggestion
      // MVP header-only: esta card vive en la rama no-mercadería (sin line-items). Si la IA
      // clasifica como mercadería, lo registramos como gasto a proveedor (monto único). El
      // auto-completado de mercadería con items es fase 2.
      if (sug.category === 'mercaderia') sug.category = 'proveedores'
      setSuggestion(sug)
      setStatus('result')
    } catch {
      setStatus('error')
      setErrorMsg('No pudimos leer el archivo. Probá de nuevo.')
    }
  }

  if (status === 'idle' || status === 'error' || status === 'empty') {
    return (
      <div className="space-y-2">
        <Button
          type="button"
          variant="outline"
          onClick={handleScan}
          className="w-full h-9 rounded-lg text-sm gap-2"
        >
          <Sparkles size={15} className="text-primary" />
          Escanear con IA
        </Button>
        {status === 'error' && errorMsg && (
          <p className="flex items-start gap-1.5 text-xs text-destructive">
            <AlertCircle size={13} className="mt-px shrink-0" /> {errorMsg}
          </p>
        )}
        {status === 'empty' && (
          <p className="flex items-start gap-1.5 text-xs text-hint">
            <AlertCircle size={13} className="mt-px shrink-0" />
            No pudimos extraer texto del documento. Completá los campos manualmente.
          </p>
        )}
      </div>
    )
  }

  if (status === 'loading') {
    return (
      <div className="flex items-center justify-center gap-2 h-9 rounded-lg border border-edge bg-surface-alt text-sm text-hint">
        <Loader2 size={15} className="animate-spin text-primary" />
        Analizando documento...
      </div>
    )
  }

  if (status === 'applied') {
    return (
      <button
        type="button"
        onClick={() => { setStatus('idle'); setSuggestion(null) }}
        className="flex items-center gap-1.5 text-xs text-hint hover:text-body transition-colors"
      >
        <Check size={13} className="text-success" />
        Sugerencia aplicada — escanear de nuevo
      </button>
    )
  }

  // status === 'result'
  const s = suggestion!
  const rows: { label: string; value: string }[] = []
  if (s.supplier_name) rows.push({ label: 'Proveedor', value: s.supplier_name })
  if (s.date) rows.push({ label: 'Fecha', value: s.date })
  if (s.amount != null) rows.push({ label: 'Monto', value: formatMoney(s.amount) })
  rows.push({ label: 'Categoría', value: EXPENSE_CATEGORY_LABELS[s.category] })
  if (s.description) rows.push({ label: 'Descripción', value: s.description })

  return (
    <div className="rounded-xl border border-primary/25 bg-primary/[0.04] p-3 space-y-3">
      <div className="flex items-center gap-1.5 text-xs font-medium text-primary">
        <Sparkles size={13} />
        Sugerencia de la IA — revisá antes de aplicar
      </div>
      <dl className="space-y-1">
        {rows.map(r => (
          <div key={r.label} className="flex gap-2 text-sm">
            <dt className="text-hint w-24 shrink-0">{r.label}</dt>
            <dd className="text-body min-w-0 break-words">{r.value}</dd>
          </div>
        ))}
      </dl>
      <div className="flex gap-2">
        <Button
          type="button"
          onClick={() => { onApply(s); setStatus('applied') }}
          className="flex-1 h-8 rounded-lg text-xs font-semibold gap-1.5"
        >
          <Check size={14} /> Aplicar
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={() => { setStatus('idle'); setSuggestion(null) }}
          className="h-8 rounded-lg text-xs gap-1.5 text-hint"
        >
          <X size={14} /> Descartar
        </Button>
      </div>
    </div>
  )
}
