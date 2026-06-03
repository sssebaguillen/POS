// P12 — tipos cliente de la IA proactiva. Espejo de la fila de ai_insights (ver migración 20260602_06).

export type InsightStatus = 'new' | 'seen' | 'dismissed' | 'acted'
export type InsightSeverity = 'info' | 'opportunity' | 'anomaly'

export type InsightTargetEntityType =
  | 'product'
  | 'payment'
  | 'customer'
  | 'supplier'
  | 'stock'
  | 'channel'
  | 'global'

export type InsightSurface =
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

export interface AiInsight {
  id: string
  created_at: string
  status: InsightStatus
  severity: InsightSeverity
  target_entity_type: InsightTargetEntityType
  target_entity_id: string | null
  surface: InsightSurface
  title: string
  body: string
  rationale: string[]
  source_model: string | null
}

// Estados que el dueño todavía no resolvió → se muestran en la UI.
export const ACTIVE_INSIGHT_STATUSES: InsightStatus[] = ['new', 'seen']
