import type { PostgrestError } from '@supabase/supabase-js'
import { translateDbError } from '@/lib/errors'

export type RpcResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string }

interface RpcEnvelope {
  success: boolean
  error?: string
}

interface RpcResponse {
  data: unknown
  error: PostgrestError | null
}

export function unwrapRpc<T>(response: RpcResponse, fallback: string): RpcResult<T> {
  const { data, error } = response
  if (error) {
    return { ok: false, error: translateDbError(error.message, fallback) }
  }
  const envelope = data as (T & RpcEnvelope) | null
  if (!envelope || envelope.success !== true) {
    return { ok: false, error: envelope?.error ?? fallback }
  }
  return { ok: true, data: envelope as T }
}
