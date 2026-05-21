'use client'

import { useEffect, useRef, useState } from 'react'
import type { CSSProperties, ReactNode, RefObject } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '@/lib/utils'

interface FloatingDropdownProps {
  anchorRef: RefObject<HTMLElement | null>
  open: boolean
  children: ReactNode
  className?: string
  maxHeight?: number
  onClose?: () => void
  portalTargetId?: string
}

export default function FloatingDropdown({
  anchorRef,
  open,
  children,
  className,
  maxHeight = 208,
  onClose,
  portalTargetId,
}: FloatingDropdownProps) {
  const [style, setStyle] = useState<CSSProperties>({})
  const wrapperRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return

    function updatePosition() {
      const anchor = anchorRef.current
      if (!anchor) return

      const rect = anchor.getBoundingClientRect()
      const portalTarget = portalTargetId
        ? document.getElementById(portalTargetId)
        : null

      const GAP = 4
      const MIN_HEIGHT = 120

      if (portalTarget) {
        const containerRect = portalTarget.getBoundingClientRect()
        const spaceBelow = containerRect.bottom - rect.bottom - GAP
        const spaceAbove = rect.top - containerRect.top - GAP
        const openUpwards = spaceBelow < maxHeight && spaceAbove > spaceBelow
        const available = Math.max(MIN_HEIGHT, openUpwards ? spaceAbove : spaceBelow)

        setStyle({
          position: 'absolute',
          left: rect.left - containerRect.left,
          width: rect.width,
          maxHeight: Math.min(maxHeight, available),
          overflowY: 'auto',
          zIndex: 80,
          ...(openUpwards
            ? { bottom: containerRect.bottom - rect.top + GAP }
            : { top: rect.bottom - containerRect.top + GAP }),
        })
        return
      }

      const spaceBelow = window.innerHeight - rect.bottom - GAP
      const spaceAbove = rect.top - GAP
      const openUpwards = spaceBelow < maxHeight && spaceAbove > spaceBelow
      const available = Math.max(MIN_HEIGHT, openUpwards ? spaceAbove : spaceBelow)

      setStyle({
        position: 'fixed',
        left: rect.left,
        width: rect.width,
        maxHeight: Math.min(maxHeight, available),
        overflowY: 'auto',
        zIndex: 9999,
        ...(openUpwards
          ? { bottom: window.innerHeight - rect.top + GAP }
          : { top: rect.bottom + GAP }),
      })
    }

    updatePosition()

    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)

    return () => {
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
    }
  }, [anchorRef, maxHeight, open, portalTargetId])

  // When portaled to document.body, the dropdown lands outside the Radix Dialog's
  // RemoveScroll tree. react-remove-scroll attaches a wheel/touchmove listener on
  // document (bubble phase, non-passive) and cancels any event whose target is not
  // inside its lock or shards — which blocks scrolling inside our portaled list.
  // We stop the native event at the wrapper so it never reaches that document
  // listener. React's synthetic stopPropagation does NOT stop native bubbling, so
  // this must be a native addEventListener.
  useEffect(() => {
    if (!open) return
    const el = wrapperRef.current
    if (!el) return
    const stop = (event: Event) => event.stopPropagation()
    el.addEventListener('wheel', stop, { passive: true })
    el.addEventListener('touchmove', stop, { passive: true })
    return () => {
      el.removeEventListener('wheel', stop)
      el.removeEventListener('touchmove', stop)
    }
  }, [open])

  useEffect(() => {
    if (!open || !onClose) return

    function handleMouseDown(event: MouseEvent) {
      const target = event.target as Node
      const anchor = anchorRef.current
      const wrapper = wrapperRef.current

      if (anchor?.contains(target) || wrapper?.contains(target)) {
        return
      }

      onClose?.()
    }

    document.addEventListener('mousedown', handleMouseDown)

    return () => {
      document.removeEventListener('mousedown', handleMouseDown)
    }
  }, [anchorRef, onClose, open, wrapperRef])

  if (!open || typeof document === 'undefined') return null

  const portalTarget = portalTargetId
    ? document.getElementById(portalTargetId)
    : null

  return createPortal(
    <div
      ref={node => {
        wrapperRef.current = node
      }}
      className={cn('pointer-events-auto surface-elevated overflow-y-auto', className)}
      style={style}
    >
      {children}
    </div>,
    portalTarget ?? document.body
  )
}
