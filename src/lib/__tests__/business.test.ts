import { describe, it, expect } from 'vitest'
import {
  getBusinessIdByUserId,
  requireAuthenticatedBusinessContext,
  requireAuthenticatedBusinessId,
} from '@/lib/business'

interface ClientConfig {
  user?: { id: string; email?: string } | null
  userError?: { message: string } | null
  profile?: { business_id: string | null } | null
  profileError?: { message: string } | null
}

function makeClient(config: ClientConfig) {
  return {
    auth: {
      getUser: async () => ({ data: { user: config.user ?? null }, error: config.userError ?? null }),
    },
    from: () => ({
      select: () => ({
        eq: () => ({
          single: async () => ({ data: config.profile ?? null, error: config.profileError ?? null }),
        }),
      }),
    }),
  } as never
}

describe('getBusinessIdByUserId', () => {
  it('returns the business_id from the profile', async () => {
    const client = makeClient({ profile: { business_id: 'biz-1' } })
    expect(await getBusinessIdByUserId(client, 'user-1')).toBe('biz-1')
  })

  it('returns null when the profile has no business_id', async () => {
    const client = makeClient({ profile: { business_id: null } })
    expect(await getBusinessIdByUserId(client, 'user-1')).toBeNull()
  })

  it('returns null when there is no profile row', async () => {
    const client = makeClient({ profile: null })
    expect(await getBusinessIdByUserId(client, 'user-1')).toBeNull()
  })

  it('throws when the query errors', async () => {
    const client = makeClient({ profileError: { message: 'db down' } })
    await expect(getBusinessIdByUserId(client, 'user-1')).rejects.toThrow('db down')
  })
})

describe('requireAuthenticatedBusinessContext', () => {
  it('returns userId + businessId for an authenticated owner with a profile', async () => {
    const client = makeClient({ user: { id: 'user-1' }, profile: { business_id: 'biz-1' } })
    expect(await requireAuthenticatedBusinessContext(client)).toEqual({
      userId: 'user-1',
      businessId: 'biz-1',
    })
  })

  it('throws when there is no authenticated user', async () => {
    const client = makeClient({ user: null })
    await expect(requireAuthenticatedBusinessContext(client)).rejects.toThrow(/No authenticated user/)
  })

  it('surfaces the auth error message', async () => {
    const client = makeClient({ user: null, userError: { message: 'token expired' } })
    await expect(requireAuthenticatedBusinessContext(client)).rejects.toThrow('token expired')
  })

  it('throws when the profile has no business_id', async () => {
    const client = makeClient({ user: { id: 'user-1' }, profile: { business_id: null } })
    await expect(requireAuthenticatedBusinessContext(client)).rejects.toThrow(/business_id/)
  })
})

describe('requireAuthenticatedBusinessId', () => {
  it('returns only the businessId', async () => {
    const client = makeClient({ user: { id: 'user-1' }, profile: { business_id: 'biz-1' } })
    expect(await requireAuthenticatedBusinessId(client)).toBe('biz-1')
  })
})
