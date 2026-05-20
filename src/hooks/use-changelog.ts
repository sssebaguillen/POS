'use client'

import { useCallback, useEffect, useState } from 'react'

export type ChangelogChangeType = 'new' | 'fix' | 'improvement'

export interface ChangelogChange {
  type: ChangelogChangeType
  text: string
}

export interface ChangelogRelease {
  version: string
  date: string
  label: string
  changes: ChangelogChange[]
}

interface ChangelogPayload {
  current: string
  releases: ChangelogRelease[]
}

const COOKIE_NAME = 'pulsar-last-seen-version'
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365

export function useChangelog(initialLastSeenVersion: string | null) {
  const [payload, setPayload] = useState<ChangelogPayload | null>(null)
  const [lastSeenVersion, setLastSeenVersion] = useState<string | null>(initialLastSeenVersion)

  useEffect(() => {
    let cancelled = false
    fetch('/changelog.json', { cache: 'no-store' })
      .then(res => (res.ok ? res.json() : null))
      .then(data => {
        if (cancelled || !data) return
        setPayload(data as ChangelogPayload)
      })
      .catch(() => {
        // Silent failure: changelog is a nice-to-have, not a blocker.
      })
    return () => {
      cancelled = true
    }
  }, [])

  const latestRelease = payload?.releases[0] ?? null
  const releases = payload?.releases ?? []
  const hasUnread = Boolean(latestRelease && latestRelease.version !== lastSeenVersion)

  const markAsSeen = useCallback(() => {
    if (!latestRelease) return
    const version = latestRelease.version
    document.cookie = `${COOKIE_NAME}=${encodeURIComponent(version)}; path=/; max-age=${COOKIE_MAX_AGE}; SameSite=Lax`
    setLastSeenVersion(version)
  }, [latestRelease])

  return { latestRelease, releases, hasUnread, markAsSeen }
}
