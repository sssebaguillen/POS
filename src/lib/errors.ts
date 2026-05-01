export function translateDbError(message: string, fallback: string): string {
  const lower = message.toLowerCase()

  if (lower.includes('sku') && (lower.includes('unique') || lower.includes('duplicate'))) {
    return 'Ya existe un producto con ese SKU en este negocio.'
  }

  if (lower.includes('barcode') && (lower.includes('unique') || lower.includes('duplicate'))) {
    return 'Ya existe un producto con ese código de barras.'
  }

  if (lower.includes('stock') && (lower.includes('insufficient') || lower.includes('insuficiente'))) {
    return 'Stock insuficiente para completar la operación.'
  }

  if (lower.includes('duplicate key') || lower.includes('unique constraint')) {
    return 'Ya existe un registro con esos datos.'
  }

  if (lower.includes('foreign key') || lower.includes('violates foreign')) {
    return 'No se puede eliminar porque tiene registros asociados.'
  }

  return fallback
}
