import { NextResponse, type NextRequest } from 'next/server'
import { cookies } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import { requireAuthenticatedBusinessContext } from '@/lib/business'
import { getActiveOperator, getActorOperatorId } from '@/lib/operator'
import { createGithubIssue } from '@/lib/feedback/github'
import { notifyTelegram } from '@/lib/feedback/telegram'

const ALLOWED_TYPES = ['bug', 'sugerencia', 'otro'] as const
type FeedbackType = (typeof ALLOWED_TYPES)[number]

const SIGNED_URL_TTL_SECONDS = 60 * 60 * 24 * 7 // 7 days

type Payload = {
  type: FeedbackType
  message: string
  contactEmail?: string | null
  route?: string | null
  attachmentPath?: string | null
}

function isPayload(value: unknown): value is Payload {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  if (typeof v.type !== 'string' || !ALLOWED_TYPES.includes(v.type as FeedbackType)) return false
  if (typeof v.message !== 'string') return false
  if (v.contactEmail != null && typeof v.contactEmail !== 'string') return false
  if (v.route != null && typeof v.route !== 'string') return false
  if (v.attachmentPath != null && typeof v.attachmentPath !== 'string') return false
  return true
}

export async function POST(request: NextRequest) {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 })
  }

  if (!isPayload(body)) {
    return NextResponse.json({ error: 'Payload inválido' }, { status: 400 })
  }

  const message = body.message.trim()
  if (message.length < 10 || message.length > 1000) {
    return NextResponse.json(
      { error: 'El mensaje debe tener entre 10 y 1000 caracteres' },
      { status: 400 }
    )
  }

  const supabase = await createClient()

  let userId: string
  let businessId: string
  try {
    const ctx = await requireAuthenticatedBusinessContext(supabase)
    userId = ctx.userId
    businessId = ctx.businessId
  } catch {
    return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
  }
  void userId

  const cookieStore = await cookies()
  const operator = await getActiveOperator(cookieStore)
  const operatorId = getActorOperatorId(operator)
  const operatorName = operator?.name ?? null

  if (body.attachmentPath && !body.attachmentPath.startsWith(`${businessId}/`)) {
    return NextResponse.json({ error: 'Ruta de adjunto inválida' }, { status: 400 })
  }

  const route =
    (body.route?.trim() || request.headers.get('referer') || '').slice(0, 500) || null
  const userAgent = request.headers.get('user-agent')?.slice(0, 500) ?? null
  const contactEmail = body.contactEmail?.trim() || null

  const { data: rpcResult, error: rpcError } = await supabase.rpc('create_feedback', {
    p_business_id: businessId,
    p_operator_id: operatorId,
    p_type: body.type,
    p_message: message,
    p_contact_email: contactEmail,
    p_route: route,
    p_user_agent: userAgent,
    p_attachment_path: body.attachmentPath ?? null,
  })

  if (rpcError) {
    console.error('[feedback] create_feedback RPC error:', rpcError)
    return NextResponse.json({ error: 'No se pudo guardar el feedback' }, { status: 500 })
  }

  const result = rpcResult as { success: boolean; error?: string; data?: { id: string } } | null
  if (!result?.success || !result.data?.id) {
    return NextResponse.json(
      { error: result?.error ?? 'No se pudo guardar el feedback' },
      { status: 400 }
    )
  }

  const feedbackId = result.data.id

  // Best-effort external integrations — never bubble up failures to the user.
  let attachmentSignedUrl: string | null = null
  if (body.attachmentPath) {
    const { data: signed } = await supabase.storage
      .from('feedback-attachments')
      .createSignedUrl(body.attachmentPath, SIGNED_URL_TTL_SECONDS)
    attachmentSignedUrl = signed?.signedUrl ?? null
  }

  const issueUrl = await createGithubIssue({
    type: body.type,
    message,
    route,
    contactEmail,
    attachmentSignedUrl,
    businessId,
    operatorName,
    userAgent,
  })

  const telegramOk = await notifyTelegram({
    type: body.type,
    message,
    route,
    contactEmail,
    operatorName,
    githubIssueUrl: issueUrl,
  })

  if (issueUrl || telegramOk) {
    const { error: linkError } = await supabase.rpc('attach_feedback_links', {
      p_id: feedbackId,
      p_github_issue_url: issueUrl,
      p_telegram_sent_at: telegramOk ? new Date().toISOString() : null,
    })
    if (linkError) {
      console.error('[feedback] attach_feedback_links failed:', linkError)
    }
  }

  return NextResponse.json({ ok: true })
}
