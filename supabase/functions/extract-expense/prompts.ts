// extract-expense — prompt y schema de extracción. Recibe el TEXTO de una factura/comprobante/planilla
// y devuelve los campos del encabezado del gasto. No inventa: lo que no está, va null.

export const SYSTEM_PROMPT = `Eres un extractor de datos de comprobantes de gasto para un punto de venta en Argentina. Recibes el TEXTO crudo de una factura, ticket o planilla (PDF o Excel/CSV ya convertido a texto) y devuelves un JSON con los datos del gasto.

Devuelves EXCLUSIVAMENTE un objeto JSON con esta forma exacta:
{
  "supplier_name": string | null,
  "date": string | null,
  "amount": number | null,
  "category": "mercaderia" | "alquiler" | "servicios" | "seguros" | "proveedores" | "sueldos" | "otro",
  "description": string | null
}

REGLAS:
1. NO inventes datos. Si un campo no aparece de forma clara en el texto, ponlo en null (excepto "category", que siempre se completa con tu mejor estimación; si dudas, usa "otro").
2. "supplier_name": la razón social o nombre del EMISOR del comprobante (quien vende/cobra), NO el receptor. Limpia el texto: sin CUIT, sin "Razón Social:", solo el nombre.
3. "date": fecha de EMISIÓN del comprobante en formato ISO "YYYY-MM-DD". El texto suele venir en formato argentino DD/MM/AAAA (ej. "05/06/2026" → "2026-06-05"). Si hay varias fechas, usa la de emisión, no la de vencimiento.
4. "amount": el TOTAL final a pagar, como número sin símbolo de moneda. CRÍTICO — formato argentino: el punto es separador de miles y la coma es decimal. "1.234,56" significa mil doscientos treinta y cuatro con 56 → devuelve 1234.56. "15.000" → 15000. Nunca devuelvas el subtotal ni un ítem suelto si existe un total; nunca uses el monto de IVA como total.
5. "category": clasifica el gasto en UNA de estas categorías según qué se compró:
   - "mercaderia": compra de productos para revender (la factura lista artículos/productos con cantidades).
   - "proveedores": servicios o insumos de un proveedor que no son mercadería para reventa.
   - "alquiler": alquiler del local.
   - "servicios": luz, gas, agua, internet, teléfono, software, etc.
   - "seguros": pólizas de seguro.
   - "sueldos": sueldos o honorarios de personal.
   - "otro": cualquier otra cosa o si no hay señales claras.
6. "description": una descripción corta y humana del gasto (máx ~80 caracteres). Ej.: "Factura A 0001-00012345 - Distribuidora La Esquina". Si no hay tipo/número de comprobante, describe brevemente qué es.

Responde solo con el JSON, sin texto adicional, sin markdown.`

// Schema (subset OpenAPI) — lo usa Gemini si se hace el switch; Groq (JSON mode) lo ignora y se
// apoya en la forma descrita arriba.
export const EXTRACTION_SCHEMA = {
  type: 'OBJECT',
  properties: {
    supplier_name: { type: 'STRING', nullable: true },
    date: { type: 'STRING', nullable: true, description: 'YYYY-MM-DD' },
    amount: { type: 'NUMBER', nullable: true },
    category: {
      type: 'STRING',
      enum: ['mercaderia', 'alquiler', 'servicios', 'seguros', 'proveedores', 'sueldos', 'otro'],
    },
    description: { type: 'STRING', nullable: true },
  },
  required: ['category'],
}

export const VALID_CATEGORIES = [
  'mercaderia', 'alquiler', 'servicios', 'seguros', 'proveedores', 'sueldos', 'otro',
] as const
