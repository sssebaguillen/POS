// Helpers compartidos para exportar a CSV (usados por ExportCSVButton y
// exports a medida que necesitan armar las filas de forma asíncrona).

export function toCSV(data: Record<string, unknown>[]): string {
  if (data.length === 0) return ''
  const headers = Object.keys(data[0])
  const escape = (val: unknown): string => {
    const str = val === null || val === undefined ? '' : String(val)
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return `"${str.replace(/"/g, '""')}"`
    }
    return str
  }
  const rows = data.map(row => headers.map(h => escape(row[h])).join(','))
  return [headers.join(','), ...rows].join('\n')
}

export function downloadCSV(data: Record<string, unknown>[], filename: string): void {
  if (data.length === 0) return
  const csv = toCSV(data)
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename.endsWith('.csv') ? filename : `${filename}.csv`
  link.click()
  URL.revokeObjectURL(url)
}
