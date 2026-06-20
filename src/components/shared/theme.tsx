'use client'

import { createContext, useContext, useEffect, useState } from 'react'
import { Sun, Moon } from '@phosphor-icons/react/dist/ssr'
import { THEME_STORAGE_KEY, type Theme } from '@/lib/theme'
import { useMounted } from '@/lib/hooks/useMounted'

// ─── Types ───────────────────────────────────────────────────────────────────

interface ThemeContextType {
  theme: Theme
  toggle: () => void
}

// ─── Context ─────────────────────────────────────────────────────────────────

const ThemeContext = createContext<ThemeContextType | undefined>(undefined)

function getPreferredTheme(): Theme {
  if (typeof window === 'undefined') {
    return 'light'
  }

  const stored = localStorage.getItem(THEME_STORAGE_KEY)
  if (stored === 'dark' || stored === 'light') {
    return stored
  }

  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function useTheme() {
  const context = useContext(ThemeContext)
  if (!context) throw new Error('useTheme must be used within a ThemeProvider')
  return context
}

// ─── Provider ────────────────────────────────────────────────────────────────

interface ThemeProviderProps {
  children: React.ReactNode
}

export function ThemeProvider({ children }: ThemeProviderProps) {
  const [theme, setTheme] = useState<Theme>(getPreferredTheme)

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
    document.documentElement.style.colorScheme = theme
    localStorage.setItem(THEME_STORAGE_KEY, theme)
  }, [theme])

  const toggle = () => setTheme((prev) => (prev === 'light' ? 'dark' : 'light'))

  return (
    <ThemeContext.Provider value={{ theme, toggle }}>
      {children}
    </ThemeContext.Provider>
  )
}

// ─── Toggle button ───────────────────────────────────────────────────────────

export function ThemeToggle() {
  const { theme, toggle } = useTheme()
  const mounted = useMounted()

  const themeForUi = mounted ? theme : 'light'

  return (
    <button
      onClick={toggle}
      aria-label={themeForUi === 'light' ? 'Cambiar a modo oscuro' : 'Cambiar a modo claro'}
      className="
        flex items-center justify-center w-9 h-9 rounded-xl
        bg-zinc-100 hover:bg-zinc-200 text-zinc-600
        dark:bg-accent dark:hover:bg-accent/80 dark:text-white/70 dark:hover:text-white
        border border-zinc-200 dark:border-edge
        transition-[transform,background-color,color] duration-150 ease-[var(--ease-out)] active:scale-95
      "
    >
      {themeForUi === 'light' ? (
        <Moon size={16} strokeWidth={1.8} />
      ) : (
        <Sun size={16} strokeWidth={1.8} />
      )}
    </button>
  )
}
