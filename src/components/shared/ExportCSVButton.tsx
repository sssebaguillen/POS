'use client'

import { Download } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { downloadCSV } from '@/lib/csv'

interface ExportCSVButtonProps {
  data: Record<string, unknown>[]
  filename: string
  label?: string
}

export default function ExportCSVButton({ data, filename, label = 'Exportar CSV' }: ExportCSVButtonProps) {
  function handleExport() {
    downloadCSV(data, filename)
  }

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={handleExport}
      disabled={data.length === 0}
      className="gap-2"
    >
      <Download size={15} />
      {label}
    </Button>
  )
}
