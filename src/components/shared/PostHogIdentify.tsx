'use client'

import { useEffect } from 'react'
import { identifyUser } from '@/lib/analytics'

interface Props {
  userId: string
  businessId: string
}

export default function PostHogIdentify({ userId, businessId }: Props) {
  useEffect(() => {
    identifyUser(userId, businessId)
  }, [userId, businessId])
  return null
}
