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

  if (
    lower.includes('row-level security') ||
    lower.includes('row level security') ||
    lower.includes('permission denied') ||
    lower.includes('not authorized') ||
    lower.includes('insufficient_privilege')
  ) {
    return 'No tienes permisos para realizar esta acción. Solicita acceso al dueño.'
  }

  if (lower.includes('violates not-null') || lower.includes('null value in column')) {
    return 'Falta un dato obligatorio. Revisa los campos marcados.'
  }

  if (lower.includes('violates check constraint') || lower.includes('check constraint')) {
    return 'Alguno de los valores ingresados no es válido. Revisa precio, costo y stock.'
  }

  if (lower.includes('value too long')) {
    return 'Un campo supera el largo máximo permitido. Acórtalo e inténtalo de nuevo.'
  }

  if (
    lower.includes('fetch') ||
    lower.includes('network') ||
    lower.includes('failed to fetch') ||
    lower.includes('timeout') ||
    lower.includes('econnrefused')
  ) {
    return 'No se pudo conectar. Revisa tu conexión a internet e inténtalo de nuevo.'
  }

  if (lower.includes('storage') || lower.includes('payload too large') || lower.includes('exceeded')) {
    return 'No se pudo guardar el archivo. Verifica que pese menos de 2 MB e inténtalo de nuevo.'
  }

  return fallback
}
