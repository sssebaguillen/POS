// extract-expense — Edge Function user-triggered (NO cron). El dueño sube un comprobante a
// `expense-receipts` y esta función extrae los datos del encabezado del gasto para pre-llenar el
// formulario. Solo texto: PDF con capa de texto (unpdf) o Excel/CSV ya parseado client-side.
//
// Seguridad: corre con el JWT del usuario (verify_jwt en config). El business_id se DERIVA del
// usuario autenticado (no se confía en el cliente). Para PDF se baja el archivo con la propia
// sesión del dueño (RLS de storage scopeada por carpeta, regla 35) y se valida que el path
// pertenezca a su negocio (regla 23).
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { extractText, getDocumentProxy } from 'npm:unpdf@0.12.1'
import { makeProvider } from './llm.ts'
import { SYSTEM_PROMPT, EXTRACTION_SCHEMA, VALID_CATEGORIES } from './prompts.ts'

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const MAX_TEXT_CHARS = 12_000

interface RequestBody {
  mode?: 'pdf' | 'text'
  storagePath?: string // mode 'pdf': path dentro de expense-receipts: "{businessId}/{uuid}.pdf"
  text?: string // mode 'text': Excel/CSV ya parseado a texto client-side
}

interface Suggestion {
  supplier_name: string | null
  date: string | null
  amount: number | null
  category: string
  description: string | null
}

function jsonResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  })
}

function normalizeSuggestion(raw: unknown): Suggestion {
  const r = (raw ?? {}) as Record<string, unknown>

  const str = (v: unknown): string | null => {
    if (typeof v !== 'string') return null
    const t = v.trim()
    return t.length > 0 ? t : null
  }

  let amount: number | null = null
  if (typeof r.amount === 'number' && Number.isFinite(r.amount) && r.amount > 0) {
    amount = r.amount
  } else if (typeof r.amount === 'string') {
    const n = parseFloat(r.amount.replace(/[^0-9.-]/g, ''))
    amount = Number.isFinite(n) && n > 0 ? n : null
  }

  const dateStr = str(r.date)
  const date = dateStr && /^\d{4}-\d{2}-\d{2}$/.test(dateStr) ? dateStr : null

  const cat = typeof r.category === 'string' ? r.category : 'otro'
  const category = (VALID_CATEGORIES as readonly string[]).includes(cat) ? cat : 'otro'

  return {
    supplier_name: str(r.supplier_name),
    date,
    amount,
    category,
    description: str(r.description),
  }
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS })
  }
  if (request.method !== 'POST') {
    return jsonResponse({ success: false, error: 'Method not allowed' }, 405)
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  if (!supabaseUrl || !anonKey) {
    return jsonResponse({ success: false, error: 'Missing Supabase environment' }, 500)
  }

  const authHeader = request.headers.get('Authorization')
  if (!authHeader) return jsonResponse({ success: false, error: 'Unauthorized' }, 401)

  // Cliente con la sesión del usuario → RLS aplica como el dueño (lectura de su propia carpeta).
  const supabase = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const { data: userData, error: userError } = await supabase.auth.getUser()
  if (userError || !userData.user) {
    return jsonResponse({ success: false, error: 'Unauthorized' }, 401)
  }

  // business_id derivado del usuario autenticado — nunca del cliente.
  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('business_id')
    .eq('id', userData.user.id)
    .single()
  if (profileError || !profile?.business_id) {
    return jsonResponse({ success: false, error: 'No business context' }, 403)
  }
  const businessId = profile.business_id as string

  let body: RequestBody = {}
  try {
    body = (await request.json()) as RequestBody
  } catch {
    return jsonResponse({ success: false, error: 'Invalid JSON body' }, 400)
  }

  // --- Reúne el texto del comprobante según el modo ---
  let documentText = ''

  if (body.mode === 'text') {
    if (typeof body.text !== 'string' || body.text.trim().length === 0) {
      return jsonResponse({ success: false, error: 'Empty text' }, 400)
    }
    documentText = body.text
  } else if (body.mode === 'pdf') {
    const path = body.storagePath
    if (!path || typeof path !== 'string') {
      return jsonResponse({ success: false, error: 'Missing storagePath' }, 400)
    }
    // Defensa en profundidad: el primer segmento del path debe ser el negocio del usuario (reglas 23/35).
    if (path.split('/')[0] !== businessId) {
      return jsonResponse({ success: false, error: 'Forbidden path' }, 403)
    }
    const { data: file, error: downloadError } = await supabase.storage
      .from('expense-receipts')
      .download(path)
    if (downloadError || !file) {
      return jsonResponse({ success: false, error: 'Could not read file' }, 404)
    }
    try {
      const bytes = new Uint8Array(await file.arrayBuffer())
      const pdf = await getDocumentProxy(bytes)
      const { text } = await extractText(pdf, { mergePages: true })
      documentText = typeof text === 'string' ? text : ''
    } catch {
      // PDF corrupto o cifrado → tratamos como sin texto extraíble.
      documentText = ''
    }
    // PDF escaneado (imagen sin capa de texto): no hay nada que mandar al modelo.
    if (documentText.trim().length === 0) {
      return jsonResponse({ success: true, suggestion: null, reason: 'no_text_layer' })
    }
  } else {
    return jsonResponse({ success: false, error: 'Invalid mode' }, 400)
  }

  documentText = documentText.slice(0, MAX_TEXT_CHARS)

  // --- Extracción vía LLM de texto ---
  const model = Deno.env.get('EXTRACT_EXPENSE_MODEL') ?? 'llama-3.3-70b-versatile'
  let raw: unknown
  try {
    const provider = makeProvider(model)
    raw = await provider.completeJson(
      SYSTEM_PROMPT,
      `TEXTO DEL COMPROBANTE:\n\n${documentText}`,
      EXTRACTION_SCHEMA,
    )
  } catch (e) {
    return jsonResponse({ success: false, error: (e as Error).message }, 502)
  }

  return jsonResponse({
    success: true,
    suggestion: normalizeSuggestion(raw),
    source: body.mode,
  })
})
