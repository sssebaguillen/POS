// P12 — Edge Function generate-insights. Corre nocturna (cron, después de refresh-daily-snapshots).
// Auth por CRON_SECRET (Bearer), cliente service_role (saltea RLS para leer/escribir todos los negocios
// con ai_insights_enabled). Por negocio corre el assembler de dos niveles e inserta en ai_insights.
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { makeProvider } from './llm.ts'
import { assembleForBusiness } from './assembler.ts'

interface RequestBody {
  businessId?: string // opcional: correr un solo negocio (debug)
  dryRun?: boolean // opcional: no insertar, solo devolver lo que se generaría
}

function jsonResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function extractBearerToken(header: string | null): string | null {
  if (!header) return null
  const [scheme, token] = header.split(' ')
  return scheme === 'Bearer' && token ? token : null
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') {
    return jsonResponse({ success: false, error: 'Method not allowed' }, 405)
  }

  const cronSecret = Deno.env.get('CRON_SECRET')
  if (!cronSecret) return jsonResponse({ success: false, error: 'Missing CRON_SECRET' }, 500)
  if (extractBearerToken(request.headers.get('Authorization')) !== cronSecret) {
    return jsonResponse({ success: false, error: 'Unauthorized' }, 401)
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse({ success: false, error: 'Missing Supabase service role environment' }, 500)
  }

  let body: RequestBody = {}
  if (request.headers.get('Content-Length') !== '0') {
    try {
      body = (await request.json()) as RequestBody
    } catch {
      return jsonResponse({ success: false, error: 'Invalid JSON body' }, 400)
    }
  }

  // Modelo por nivel via env (config, no arquitectura). Default: Groq, free-tier $0.
  // Ambos niveles en 70b: mejor adherencia a las reglas de copy (el 8b se saltaba el naming de
  // "catálogo" vs "canal"). Costo sigue $0 en Groq; el trade-off es que comparten bucket de TPM,
  // mitigado por el retry de 429 en el provider. 'gemini*' → Gemini; resto → Groq (ver makeProvider).
  const n1Model = Deno.env.get('INSIGHTS_MODEL_N1') ?? 'llama-3.3-70b-versatile'
  const n2Model = Deno.env.get('INSIGHTS_MODEL_N2') ?? 'llama-3.3-70b-versatile'

  let providers: { n1: ReturnType<typeof makeProvider>; n2: ReturnType<typeof makeProvider> }
  try {
    providers = { n1: makeProvider(n1Model), n2: makeProvider(n2Model) }
  } catch (e) {
    return jsonResponse({ success: false, error: (e as Error).message }, 500)
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  // Negocios con la IA proactiva activada (opt-in en settings).
  let query = supabase
    .from('businesses')
    .select('id, name, settings')
    .eq('settings->>ai_insights_enabled', 'true')
  if (body.businessId) query = query.eq('id', body.businessId)

  const { data: businesses, error: bizError } = await query
  if (bizError) return jsonResponse({ success: false, error: bizError.message }, 500)

  const results: Array<Record<string, unknown>> = []
  let totalInserted = 0

  for (const biz of businesses ?? []) {
    try {
      const { rows, n1Candidates, deepDived } = await assembleForBusiness(
        supabase,
        { id: biz.id as string, name: (biz.name as string) ?? 'Negocio' },
        providers,
      )

      let inserted = 0
      if (!body.dryRun && rows.length > 0) {
        const { error: insErr } = await supabase.from('ai_insights').insert(rows)
        if (insErr) throw new Error(`insert: ${insErr.message}`)
        inserted = rows.length
        totalInserted += inserted
      }

      results.push({
        businessId: biz.id,
        name: biz.name,
        n1Candidates,
        deepDived,
        generated: rows.length,
        inserted,
        ...(body.dryRun ? { rows } : {}),
      })
    } catch (e) {
      // Un negocio que falla no debe romper la corrida del resto.
      results.push({ businessId: biz.id, name: biz.name, error: (e as Error).message })
    }
  }

  return jsonResponse({
    success: true,
    dryRun: !!body.dryRun,
    businessesProcessed: results.length,
    totalInserted,
    results,
  })
})
