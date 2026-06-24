export function translateDbError(message: string, fallback: string): string {
  const lower = message.toLowerCase()

  // App-level RPC errors: our SECURITY DEFINER functions return coded strings
  // (e.g. "403: Permisos de inventario insuficientes", "Contexto de negocio
  // inválido", "Sesión inválida"). These carry internal detail and must never
  // reach the user verbatim — map them to neutral, user-facing copy.
  if (
    lower.startsWith('403') ||
    lower.includes('permisos de inventario') ||
    lower.includes('permisos insuficientes') ||
    lower.includes('sin permiso')
  ) {
    return 'No tienes permisos para realizar esta acción. Solicita acceso al dueño.'
  }

  if (
    lower.includes('contexto de negocio') ||
    lower.includes('sesión inválida') ||
    lower.includes('sesion invalida') ||
    lower.includes('sesión de operador') ||
    lower.includes('sesion de operador')
  ) {
    return 'Tu sesión expiró o no es válida. Inicia sesión nuevamente.'
  }

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

export const ERR = {
  // EXP — Gastos
  EXP1:  'No se pudo guardar el gasto. Intenta de nuevo. (EXP-1)',
  EXP2:  'Sin permiso para operar este gasto. (EXP-2)',
  EXP3:  'No se encontró el gasto. (EXP-3)',
  EXP41: 'La descripción es obligatoria. (EXP-41)',
  EXP42: 'El monto debe ser mayor a 0. (EXP-42)',
  EXP43: 'Agrega al menos un producto. (EXP-43)',
  EXP44: 'Cada producto debe tener una cantidad de al menos 1. (EXP-44)',
  EXP5:  'Conflicto de costo: otro proceso modificó el costo de un producto. (EXP-5)',
  // INV — Inventario
  INV1:  'No se pudo guardar. Intenta de nuevo. (INV-1)',
  INV2:  'Sin permiso para realizar esta operación de inventario. (INV-2)',
  INV3:  'No se encontró el registro. (INV-3)',
  INV41: 'El nombre es obligatorio. (INV-41)',
  INV42: 'El precio debe ser un número válido. (INV-42)',
  INV5:  'No se puede eliminar: tiene registros asociados. (INV-5)',
  INV6:  'No se pudo actualizar la lista. Intenta de nuevo. (INV-6)',
  // POS — Punto de Venta
  POS1:  'No se pudo registrar la venta. Intenta de nuevo. (POS-1)',
  POS2:  'Sin permiso para realizar ventas. (POS-2)',
  POS3:  'No se pudo identificar el negocio. Inicia sesión nuevamente. (POS-3)',
  POS61: 'No se pudo abrir la impresión del ticket. (POS-61)',
  POS62: 'No se pudo abrir el diálogo de impresión. (POS-62)',
  POS63: 'No se pudo imprimir en la impresora térmica. (POS-63)',
  POS64: 'No se pudo abrir el menú para compartir. (POS-64)',
  // PRL — Listas de Precios
  PRL1:  'No se pudo guardar la lista de precios. Intenta de nuevo. (PRL-1)',
  PRL41: 'El nombre es obligatorio. (PRL-41)',
  PRL42: 'El margen debe ser un número mayor a 0. (PRL-42)',
  PRL43: 'Indica qué hacer con los productos que no coinciden con este margen. (PRL-43)',
  PRL5:  'Conflicto: algunos productos tienen precio manual que entraría en conflicto. (PRL-5)',
  // OPR — Operarios
  OPR1:  'No se pudo guardar el operario. Intenta de nuevo. (OPR-1)',
  OPR2:  'Sin permiso para gestionar operarios. (OPR-2)',
  OPR3:  'No se encontró el operario. (OPR-3)',
  OPR41: 'El nombre es obligatorio. (OPR-41)',
  OPR42: 'El PIN debe contener exactamente 4 o 6 dígitos. (OPR-42)',
  OPR43: 'Completa ambos campos de PIN para continuar. (OPR-43)',
  OPR44: 'Los PIN ingresados no coinciden. (OPR-44)',
  OPR71: 'Contraseña incorrecta. (OPR-71)',
  OPR72: 'PIN incorrecto. (OPR-72)',
  OPR73: 'No se pudo obtener el email de la cuenta. (OPR-73)',
  OPR74: 'Ocurrió un error al enviar el correo. Intenta de nuevo. (OPR-74)',
  // SET — Configuración
  SET1:  'No se pudo guardar la configuración. Intenta de nuevo. (SET-1)',
  SET41: 'El slug debe usar solo letras minúsculas, números o guiones, y tener entre 3 y 50 caracteres. (SET-41)',
  SET42: 'El slug ya está en uso. (SET-42)',
  SET43: 'El nombre del negocio es obligatorio. (SET-43)',
  SET6:  'No se pudo guardar el archivo. Verifica que pese menos de 2 MB e intenta de nuevo. (SET-6)',
  SET61: 'Formato no permitido. Usa JPEG, PNG, WebP o SVG. (SET-61)',
  SET62: 'El archivo supera el máximo de 2 MB. (SET-62)',
  // AUT — Autenticación
  AUT1:  'No se pudo actualizar la contraseña. Intenta de nuevo. (AUT-1)',
  AUT41: 'La contraseña debe tener al menos 8 caracteres. (AUT-41)',
  AUT42: 'Las contraseñas no coinciden. (AUT-42)',
  AUT71: 'El enlace expiró o ya fue usado. Solicita uno nuevo desde el login. (AUT-71)',
  // CST — Clientes
  CST1:  'No se pudo guardar el cliente. Intenta de nuevo. (CST-1)',
  CST2:  'Sin permiso para gestionar clientes. (CST-2)',
  CST3:  'No se encontró el cliente. (CST-3)',
  CST41: 'El nombre es obligatorio. (CST-41)',
  CST42: 'El límite de crédito debe ser un número mayor o igual a 0. (CST-42)',
} as const
