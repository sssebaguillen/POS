import type { MouseEvent as ReactMouseEvent } from 'react'

export type Theme = 'light' | 'dark'

export const THEME_STORAGE_KEY = 'pos-theme'

// Toggles the theme behind a View Transition that clips the new root snapshot
// in as a circle growing from the click origin. The circle geometry is read by
// the ::view-transition-new(root) animation in globals.css via these CSS vars.
// Falls back to a plain toggle when the browser lacks the API.
export function runThemeToggleTransition(
  e: ReactMouseEvent,
  toggle: () => void,
) {
  const x = e.clientX
  const y = e.clientY
  const endRadius = Math.hypot(
    Math.max(x, window.innerWidth - x),
    Math.max(y, window.innerHeight - y),
  )
  const root = document.documentElement
  root.style.setProperty('--vt-x', `${x}px`)
  root.style.setProperty('--vt-y', `${y}px`)
  root.style.setProperty('--vt-r', `${endRadius}px`)

  if (!document.startViewTransition) {
    toggle()
    return
  }
  document.startViewTransition(() => {
    toggle()
  })
}
