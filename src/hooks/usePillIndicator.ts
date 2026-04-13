import { useRef, useLayoutEffect, useState, useCallback } from 'react'

export function usePillIndicator<T extends string>(activeKey: T) {
  const tabRefs = useRef<Map<string, HTMLButtonElement>>(new Map())
  const [indicator, setIndicator] = useState<{ left: number; width: number } | null>(null)

  const setRef = useCallback((key: string) => (el: HTMLButtonElement | null) => {
    if (el) tabRefs.current.set(key, el)
    else tabRefs.current.delete(key)
  }, [])

  useLayoutEffect(() => {
    const el = tabRefs.current.get(activeKey)
    if (!el) return
    const parent = el.parentElement
    if (!parent) return
    const parentRect = parent.getBoundingClientRect()
    const elRect = el.getBoundingClientRect()
    setIndicator({
      left: elRect.left - parentRect.left - 4,
      width: elRect.width,
    })
  }, [activeKey])

  return { setRef, indicator }
}
