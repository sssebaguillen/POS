'use client'

import { useEffect, useRef, useState } from 'react'

const PANEL_TRANSITION_MS = 200

interface UseSlidePanelAnimationParams {
  onClose: () => void
}

interface UseSlidePanelAnimationResult {
  visible: boolean
  closePanel: () => void
}

export function useSlidePanelAnimation({
  onClose,
}: UseSlidePanelAnimationParams): UseSlidePanelAnimationResult {
  const [visible, setVisible] = useState(false)
  const closeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const frameId = requestAnimationFrame(() => setVisible(true))

    return () => {
      cancelAnimationFrame(frameId)
      if (closeTimeoutRef.current) {
        clearTimeout(closeTimeoutRef.current)
      }
    }
  }, [])

  function closePanel() {
    setVisible(false)
    if (closeTimeoutRef.current) {
      clearTimeout(closeTimeoutRef.current)
    }
    closeTimeoutRef.current = setTimeout(onClose, PANEL_TRANSITION_MS)
  }

  return { visible, closePanel }
}
