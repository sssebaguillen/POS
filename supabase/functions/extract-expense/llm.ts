// extract-expense — proveedor LLM solo-texto, auto-contenido (no comparte con generate-insights
// para no tocar P12). Mismo patrón: el modelo es config, no arquitectura. Hoy Groq (free-tier,
// key managed); Gemini queda implementado como alternativa para switch por env var.

export interface LlmProvider {
  readonly model: string
  // Devuelve JSON parseado. Lanza si el proveedor falla o el JSON es inválido.
  completeJson(systemPrompt: string, userPrompt: string, schema: unknown): Promise<unknown>
}

// --- Gemini (Google Generative Language API, REST) ---
class GeminiProvider implements LlmProvider {
  constructor(
    readonly model: string,
    private readonly apiKey: string,
  ) {}

  async completeJson(systemPrompt: string, userPrompt: string, schema: unknown): Promise<unknown> {
    const url =
      `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
        generationConfig: {
          temperature: 0.1,
          responseMimeType: 'application/json',
          responseSchema: schema,
        },
      }),
    })

    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      throw new Error(`Gemini ${res.status}: ${detail.slice(0, 500)}`)
    }

    const payload = await res.json()
    const text: string | undefined = payload?.candidates?.[0]?.content?.parts?.[0]?.text
    if (!text) {
      const reason = payload?.candidates?.[0]?.finishReason ?? 'empty'
      throw new Error(`Gemini sin contenido (finishReason=${reason})`)
    }
    return JSON.parse(text)
  }
}

// Retry-After de Groq viene en segundos (ej. "24.035"); devuelve ms o null.
function parseRetryAfterMs(header: string | null): number | null {
  if (!header) return null
  const secs = Number(header)
  return Number.isFinite(secs) ? Math.ceil(secs * 1000) : null
}

// --- Groq (OpenAI-compatible chat completions, JSON mode) ---
class GroqProvider implements LlmProvider {
  constructor(
    readonly model: string,
    private readonly apiKey: string,
  ) {}

  async completeJson(systemPrompt: string, userPrompt: string, _schema: unknown): Promise<unknown> {
    // El free-tier de Groq limita tokens-por-minuto. Ante un 429 esperamos lo que indique
    // Retry-After y reintentamos una vez (esto es user-triggered, así que el cap es corto).
    const MAX_RETRIES = 1
    const RETRY_CAP_MS = 8_000

    for (let attempt = 0; ; attempt++) {
      const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          temperature: 0.1,
          response_format: { type: 'json_object' }, // exige que el prompt mencione "JSON" (lo hace)
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
        }),
      })

      if (res.status === 429 && attempt < MAX_RETRIES) {
        const waitMs = Math.min(parseRetryAfterMs(res.headers.get('retry-after')) ?? 3_000, RETRY_CAP_MS)
        await res.body?.cancel()
        await new Promise((r) => setTimeout(r, waitMs))
        continue
      }

      if (!res.ok) {
        const detail = await res.text().catch(() => '')
        throw new Error(`Groq ${res.status}: ${detail.slice(0, 500)}`)
      }

      const payload = await res.json()
      const text: string | undefined = payload?.choices?.[0]?.message?.content
      if (!text) {
        const reason = payload?.choices?.[0]?.finish_reason ?? 'empty'
        throw new Error(`Groq sin contenido (finish_reason=${reason})`)
      }
      return JSON.parse(text)
    }
  }
}

// Selector por string de modelo: 'gemini*' → Gemini; cualquier otro → Groq (default).
export function makeProvider(model: string): LlmProvider {
  if (model.startsWith('gemini')) {
    const apiKey = Deno.env.get('GEMINI_API_KEY')
    if (!apiKey) throw new Error('Missing GEMINI_API_KEY')
    return new GeminiProvider(model, apiKey)
  }
  const apiKey = Deno.env.get('GROQ_API_KEY')
  if (!apiKey) throw new Error('Missing GROQ_API_KEY')
  return new GroqProvider(model, apiKey)
}
