'use client'

import { useState, type KeyboardEvent } from 'react'

interface UseComboboxNavOptions {
  /** Total number of selectable indices (e.g. filteredItems.length, plus 1 if a null-option is rendered at index 0). */
  optionCount: number
  isOpen: boolean
  setIsOpen: (open: boolean) => void
  onSelect: (index: number) => void
  /** Called on Escape. Caller decides whether to clear input, etc. */
  onClose: () => void
}

export interface ComboboxNav {
  highlight: number
  setHighlight: (next: number | ((prev: number) => number)) => void
  openFromFocus: () => void
  handleKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void
  /** Toggle the dropdown; matches the chevron-button behavior. `onCloseSideEffect` runs if the toggle is closing. */
  toggle: (currentlyOpen: boolean, onCloseSideEffect?: () => void) => void
}

export function useComboboxNav({
  optionCount,
  isOpen,
  setIsOpen,
  onSelect,
  onClose,
}: UseComboboxNavOptions): ComboboxNav {
  const [highlight, setHighlight] = useState(-1)

  function openFromFocus() {
    setIsOpen(true)
    setHighlight(0)
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    const last = optionCount - 1
    if (event.key === 'ArrowDown' && last >= 0) {
      event.preventDefault()
      setIsOpen(true)
      setHighlight(prev => Math.min(prev + 1, last))
    } else if (event.key === 'ArrowUp' && last >= 0) {
      event.preventDefault()
      setHighlight(prev => Math.max(prev - 1, 0))
    } else if (event.key === 'Enter' && isOpen && last >= 0) {
      event.preventDefault()
      onSelect(highlight)
    } else if (event.key === 'Escape' && isOpen) {
      event.preventDefault()
      onClose()
    }
  }

  // Open/close from chevron button: opening resets highlight to 0 (matches Down-arrow behavior).
  // On close, the next open will reset highlight again, so leaving it stale is harmless.
  function toggle(currentlyOpen: boolean, onCloseSideEffect?: () => void) {
    const nextOpen = !currentlyOpen
    setIsOpen(nextOpen)
    if (nextOpen) setHighlight(0)
    if (!nextOpen && onCloseSideEffect) onCloseSideEffect()
  }

  return { highlight, setHighlight, openFromFocus, handleKeyDown, toggle }
}
