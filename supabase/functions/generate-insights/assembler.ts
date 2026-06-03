// P12 — assembler de dos niveles. Por negocio: N1 detecta candidatos sobre agregados (barato),
// N2 profundiza solo lo que saltó (dirigido). El cálculo numérico es 100% SQL; el LLM narra y prioriza.
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2'
import type { LlmProvider } from './llm.ts'
import {
  buildN1UserPrompt,
  buildN2UserPrompt,
  N1_SCHEMA,
  N2_SCHEMA,
  SYSTEM_PROMPT,
} from './prompts.ts'
import type {
  InsightRow,
  LlmInsight,
  RecentInsight,
  Surface,
  TargetEntityType,
} from './types.ts'

const MAX_DEEP_DIVE = 4 // tope de productos a profundizar por negocio (controla costo/tokens N2)
const HISTORY_MONTHS = 6 // ventana del historial profundo (acota tokens del prompt N2)
const RECENT_LOOKBACK = 25 // cuántos insights recientes alimentar al modelo (anti-repetición)
const DEDUP_WINDOW_DAYS = 14 // no re-emitir un insight activo para la misma entidad dentro de esta ventana

type Json = Record<string, unknown>

// Mapea el dominio del insight a su anclaje determinístico (no se confía al LLM).
const KIND_MAP: Record<string, { entity_type: TargetEntityType; surface: Surface; keepRef: boolean }> = {
  payment: { entity_type: 'payment', surface: 'stats', keepRef: true },
  channel: { entity_type: 'channel', surface: 'dashboard', keepRef: false },
  stock: { entity_type: 'stock', surface: 'inventory', keepRef: true },
  global: { entity_type: 'global', surface: 'global', keepRef: false },
}

function asArray<T = Json>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : []
}

function isValidInsight(i: LlmInsight): boolean {
  return (
    !!i &&
    ['info', 'opportunity', 'anomaly'].includes(i.severity) &&
    typeof i.title === 'string' &&
    i.title.trim().length > 0 &&
    typeof i.body === 'string' &&
    i.body.trim().length > 0 &&
    Array.isArray(i.rationale) &&
    i.rationale.filter((r) => typeof r === 'string' && r.trim().length > 0).length > 0
  )
}

async function rpc(supabase: SupabaseClient, fn: string, args: Json): Promise<Json> {
  const { data, error } = await supabase.rpc(fn, args)
  if (error) throw new Error(`rpc ${fn}: ${error.message}`)
  return (data ?? {}) as Json
}

// Recorta cada señal a lo material para mantener el prompt N1 chico.
function trimSignals(raw: {
  demand: Json
  payment: Json
  channel: Json
  margin: Json
  dead: Json
  over: Json
}) {
  return {
    product_demand_shifts: {
      window: raw.demand.window,
      summary: raw.demand.summary,
      products: asArray(raw.demand.data).slice(0, 10),
    },
    payment_mix: {
      window: raw.payment.window,
      totals: raw.payment.totals,
      methods: raw.payment.data,
    },
    channel: raw.channel,
    margin: {
      totals: (raw.margin as Json).totals,
      worst_products: asArray(raw.margin.data).slice(0, 10),
    },
    dead_stock: {
      summary: raw.dead.summary,
      products: asArray(raw.dead.data).slice(0, 10),
    },
    overstock: {
      summary: raw.over.summary,
      products: asArray(raw.over.data).slice(0, 10),
    },
  }
}

export interface AssembleResult {
  rows: InsightRow[]
  n1Candidates: number
  deepDived: number
}

export async function assembleForBusiness(
  supabase: SupabaseClient,
  business: { id: string; name: string },
  providers: { n1: LlmProvider; n2: LlmProvider },
): Promise<AssembleResult> {
  // 1) Reunir señales N1 (RPCs en paralelo, como service_role gracias al guard dual-use).
  const [demand, payment, channel, margin, dead, over] = await Promise.all([
    rpc(supabase, 'get_product_demand_shifts', { p_business_id: business.id }),
    rpc(supabase, 'get_payment_mix_shift', { p_business_id: business.id }),
    rpc(supabase, 'get_channel_signals', { p_business_id: business.id }),
    rpc(supabase, 'get_margin_analysis', { p_business_id: business.id, p_limit: 10 }),
    rpc(supabase, 'get_dead_stock', { p_business_id: business.id, p_limit: 10 }),
    rpc(supabase, 'get_overstock', { p_business_id: business.id, p_limit: 10 }),
  ])

  const signals = trimSignals({ demand, payment, channel, margin, dead, over })

  // 2) Insights recientes para anti-repetición (prompt) + dedup estructural.
  const { data: recentRaw } = await supabase
    .from('ai_insights')
    .select('target_entity_type, target_entity_id, title, status, created_at')
    .eq('business_id', business.id)
    .order('created_at', { ascending: false })
    .limit(RECENT_LOOKBACK)
  const recent = (recentRaw ?? []) as RecentInsight[]

  // Conjunto de entidades con insight activo (new|seen) dentro de la ventana de dedup.
  const dedupCutoff = Date.now() - DEDUP_WINDOW_DAYS * 86_400_000
  const activeKeys = new Set(
    recent
      .filter((r) => (r.status === 'new' || r.status === 'seen') && Date.parse(r.created_at) >= dedupCutoff)
      .map((r) => `${r.target_entity_type}:${r.target_entity_id ?? ''}`),
  )

  // 3) N1: el modelo prioriza productos a profundizar y emite los dominios no-producto.
  const candidateIds = new Set(
    [...asArray(demand.data), ...asArray(margin.data)].map((p) => String((p as Json).id)),
  )

  const n1 = (await providers.n1.completeJson(
    SYSTEM_PROMPT,
    buildN1UserPrompt({ businessName: business.name, signals, recentInsights: recent }),
    N1_SCHEMA,
  )) as { product_ids_to_deepen?: unknown; insights?: unknown }

  const rows: InsightRow[] = []

  // 3a) Insights no-producto de N1.
  for (const ins of asArray<LlmInsight & { kind?: string }>(n1.insights)) {
    if (!isValidInsight(ins)) continue
    const map = KIND_MAP[ins.kind ?? 'global']
    if (!map) continue
    rows.push({
      business_id: business.id,
      severity: ins.severity,
      target_entity_type: map.entity_type,
      target_entity_id: map.keepRef ? (ins.target_ref ?? null) : null,
      surface: map.surface,
      title: ins.title.trim(),
      body: ins.body.trim(),
      rationale: ins.rationale.filter((r) => r.trim().length > 0),
      source_model: providers.n1.model,
    })
  }

  // 4) N2: profundización de productos. Solo ids válidos (que salieron como candidatos), tope MAX_DEEP_DIVE.
  const deepIds = asArray<string>(n1.product_ids_to_deepen)
    .map((id) => String(id))
    .filter((id) => candidateIds.has(id))
    .slice(0, MAX_DEEP_DIVE)

  let deepDived = 0
  if (deepIds.length > 0) {
    const histories = await Promise.all(
      deepIds.map((id) =>
        rpc(supabase, 'get_product_history', {
          p_business_id: business.id,
          p_product_id: id,
          p_months: HISTORY_MONTHS,
        })
      ),
    )
    deepDived = histories.length

    const n2 = (await providers.n2.completeJson(
      SYSTEM_PROMPT,
      buildN2UserPrompt({ businessName: business.name, histories, recentInsights: recent }),
      N2_SCHEMA,
    )) as { insights?: unknown }

    for (const ins of asArray<LlmInsight>(n2.insights)) {
      if (!isValidInsight(ins)) continue
      const pid = ins.target_ref ? String(ins.target_ref) : null
      // El producto debe ser uno de los que profundizamos (evita ids alucinados).
      if (!pid || !deepIds.includes(pid)) continue
      rows.push({
        business_id: business.id,
        severity: ins.severity,
        target_entity_type: 'product',
        target_entity_id: pid,
        surface: 'inventory_row',
        title: ins.title.trim(),
        body: ins.body.trim(),
        rationale: ins.rationale.filter((r) => r.trim().length > 0),
        source_model: providers.n2.model,
      })
    }
  }

  // 5) Dedup estructural: descartar si ya hay un insight activo para esa entidad en la ventana.
  const deduped = rows.filter(
    (r) => !activeKeys.has(`${r.target_entity_type}:${r.target_entity_id ?? ''}`),
  )

  return { rows: deduped, n1Candidates: candidateIds.size, deepDived }
}
