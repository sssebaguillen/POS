import { useRef, useLayoutEffect, useState, useCallback } from 'react'

export function usePillIndicator<T extends string>(activeKey: T, dependency?: unknown) {
  const tabRefs = useRef<Map<string, HTMLButtonElement>>(new Map())
  const [indicator, setIndicator] = useState<{ left: number; width: number } | null>(null)

  const setRef = useCallback((key: string) => (el: HTMLButtonElement | null) => {
    if (el) tabRefs.current.set(key, el)
    else tabRefs.current.delete(key)
  }, [])

  const updateIndicator = useCallback(() => {
    const el = tabRefs.current.get(activeKey)
    if (!el) {
      setIndicator(null)
      return
    }

    const parent = el.parentElement
    if (!parent) {
      setIndicator(null)
      return
    }

    const parentRect = parent.getBoundingClientRect()
    const elRect = el.getBoundingClientRect()

    setIndicator({
      left: elRect.left - parentRect.left - 4,
      width: elRect.width,
    })
  }, [activeKey])

  useLayoutEffect(() => {
    const el = tabRefs.current.get(activeKey)
    const parent = el?.parentElement

    if (!el || !parent) {
      const resetFrame = window.requestAnimationFrame(() => {
        updateIndicator()
      })

      return () => {
        window.cancelAnimationFrame(resetFrame)
      }
    }

    const animationFrame = window.requestAnimationFrame(updateIndicator)
    const resizeObserver = new ResizeObserver(() => {
      updateIndicator()
    })

    resizeObserver.observe(el)
    resizeObserver.observe(parent)
    window.addEventListener('resize', updateIndicator)

    return () => {
      window.cancelAnimationFrame(animationFrame)
      resizeObserver.disconnect()
      window.removeEventListener('resize', updateIndicator)
    }
  }, [activeKey, dependency, updateIndicator])

  return { setRef, indicator }
}
