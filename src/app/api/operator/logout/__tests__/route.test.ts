import { describe, it, expect } from 'vitest'
import { POST } from '@/app/api/operator/logout/route'

describe('POST /api/operator/logout', () => {
  it('returns success', async () => {
    const res = await POST()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ success: true })
  })

  it('clears both operator cookies (empty value, maxAge 0)', async () => {
    const res = await POST()

    const session = res.cookies.get('operator_session')
    const perms = res.cookies.get('op_perms')

    expect(session?.value).toBe('')
    expect(session?.maxAge).toBe(0)
    expect(perms?.value).toBe('')
    expect(perms?.maxAge).toBe(0)
  })

  it('keeps operator_session httpOnly and op_perms readable by the client', async () => {
    const res = await POST()
    expect(res.cookies.get('operator_session')?.httpOnly).toBe(true)
    expect(res.cookies.get('op_perms')?.httpOnly).toBe(false)
  })

  it('does NOT mint a new signed session (no owner restoration / privilege escalation)', async () => {
    // Security regression guard: logout must only delete cookies. A non-empty
    // operator_session value here would mean the owner session was auto-restored.
    const res = await POST()
    expect(res.cookies.get('operator_session')?.value).toBe('')
  })
})
