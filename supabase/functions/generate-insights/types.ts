// P12 — tipos compartidos del assembler de IA proactiva.

export type Severity = 'info' | 'opportunity' | 'anomaly'

export type TargetEntityType =
  | 'product'
  | 'payment'
  | 'customer'
  | 'supplier'
  | 'stock'
  | 'channel'
  | 'global'

export type Surface =
  | 'inventory_row'
  | 'inventory'
  | 'stats'
  | 'dashboard'
  | 'cash_close'
  | 'pos'
  | 'customers'
  | 'suppliers'
  | 'expenses'
  | 'orders'
  | 'global'

// Fila lista para insertar en ai_insights. status default lo pone la DB.
export interface InsightRow {
  business_id: string
  severity: Severity
  target_entity_type: TargetEntityType
  target_entity_id: string | null
  surface: Surface
  title: string
  body: string
  rationale: string[] // "porque X, Y, Z" con números — NOT NULL en la tabla
  source_model: string
}

// Lo que el LLM devuelve por insight (el assembler completa entity_type/surface de forma determinística).
export interface LlmInsight {
  target_ref: string | null // product_id, código de método ('cash'), o null para agregados
  severity: Severity
  title: string
  body: string
  rationale: string[]
}

// Insight de producto reciente para anti-repetición (se le pasa al modelo).
export interface RecentInsight {
  target_entity_type: TargetEntityType
  target_entity_id: string | null
  title: string
  status: string
  created_at: string
}
