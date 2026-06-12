'use client'

import { useCallback, useEffect, useState } from 'react'

export type ChangelogChangeType = 'new' | 'fix' | 'improvement'

export type ChangelogReleaseKind = 'feature' | 'patch'

export interface ChangelogChange {
  type: ChangelogChangeType
  text: string
}

export interface ChangelogRelease {
  version: string
  // 'feature' (saltos grandes + minor) siempre se muestran; 'patch' (hotfixes)
  // se limitan a los más recientes. Ausente → tratado como 'feature' (no ocultar).
  kind?: ChangelogReleaseKind
  date: string
  label: string
  changes: ChangelogChange[]
}

// Tope de parches (hotfixes) mostrados cuando hay muchos sin leer; el resto se
// colapsa en una línea "+N anteriores". Los features no se limitan.
const PATCH_VISIBLE_LIMIT = 3

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

  const lastSeenIdx = lastSeenVersion
    ? releases.findIndex(r => r.version === lastSeenVersion)
    : -1
  const rawUnread = lastSeenIdx === -1 ? releases : releases.slice(0, lastSeenIdx)

  // Mostrar todos los features, pero limitar los parches a los más recientes.
  // releases viene newest-first, así que se toman los primeros N parches.
  const visiblePatches = new Set(
    rawUnread.filter(r => r.kind === 'patch').slice(0, PATCH_VISIBLE_LIMIT)
  )
  const unreadReleases = rawUnread.filter(r => r.kind !== 'patch' || visiblePatches.has(r))
  const hiddenPatchCount = rawUnread.length - unreadReleases.length

  const hasUnread = rawUnread.length > 0

  const markAsSeen = useCallback(() => {
    if (!latestRelease) return
    const version = latestRelease.version
    document.cookie = `${COOKIE_NAME}=${encodeURIComponent(version)}; path=/; max-age=${COOKIE_MAX_AGE}; SameSite=Lax`
    setLastSeenVersion(version)
  }, [latestRelease])

  return { latestRelease, releases, unreadReleases, hiddenPatchCount, hasUnread, markAsSeen }
}
