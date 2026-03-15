'use client'

import { createContext, useContext, useEffect, useState } from 'react'
import { Sun, Moon } from 'lucide-react'

// ─── Types ───────────────────────────────────────────────────────────────────

type Theme = 'light' | 'dark'

interface ThemeContextType {
  theme: Theme
  toggle: () => void
}

// ─── Context ─────────────────────────────────────────────────────────────────

const ThemeContext = createContext<ThemeContextType | undefined>(undefined)

const STORAGE_KEY = 'pos-theme'

export function useTheme() {
  const context = useContext(ThemeContext)
  if (!context) throw new Error('useTheme must be used within a ThemeProvider')
  return context
}

// ─── Provider ────────────────────────────────────────────────────────────────

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<Theme>('light')
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY) as Theme | null
    const preferred = window.matchMedia('(prefers-color-scheme: dark)').matches
      ? 'dark'
      : 'light'
    const resolved = stored ?? preferred
    setTheme(resolved)
    document.documentElement.classList.toggle('dark', resolved === 'dark')
    setMounted(true)
  }, [])

  useEffect(() => {
    if (!mounted) return
    document.documentElement.classList.toggle('dark', theme === 'dark')
    localStorage.setItem(STORAGE_KEY, theme)
  }, [theme, mounted])

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

  return (
    <button
      onClick={toggle}
      aria-label={theme === 'light' ? 'Cambiar a modo oscuro' : 'Cambiar a modo claro'}
      className="
        flex items-center justify-center w-9 h-9 rounded-xl
        bg-zinc-100 hover:bg-zinc-200 text-zinc-600
        dark:bg-accent dark:hover:bg-accent/80 dark:text-white/70 dark:hover:text-white
        border border-zinc-200 dark:border-edge
        transition-colors duration-200
      "
    >
      {theme === 'light' ? (
        <Moon size={16} strokeWidth={1.8} />
      ) : (
        <Sun size={16} strokeWidth={1.8} />
      )}
    </button>
  )
}
