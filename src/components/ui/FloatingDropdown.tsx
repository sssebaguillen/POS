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

      if (portalTarget) {
        const containerRect = portalTarget.getBoundingClientRect()
        const spaceBelow = containerRect.bottom - rect.bottom
        const spaceAbove = rect.top - containerRect.top
        const openUpwards = spaceBelow < maxHeight && spaceAbove > maxHeight

        setStyle({
          position: 'absolute',
          left: rect.left - containerRect.left,
          width: rect.width,
          zIndex: 80,
          ...(openUpwards
            ? { bottom: containerRect.bottom - rect.top + 4 }
            : { top: rect.bottom - containerRect.top + 4 }),
        })
        return
      }

      const spaceBelow = window.innerHeight - rect.bottom
      const openUpwards = spaceBelow < maxHeight && rect.top > maxHeight

      setStyle({
        position: 'fixed',
        left: rect.left,
        width: rect.width,
        zIndex: 9999,
        ...(openUpwards
          ? { bottom: window.innerHeight - rect.top + 4 }
          : { top: rect.bottom + 4 }),
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
