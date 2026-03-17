'use client'

import { createContext, useContext, useEffect, useState } from 'react'
import { Sun, Moon } from 'lucide-react'

type Theme = 'light' | 'dark'

interface CatalogThemeContextType {
  theme: Theme
  toggle: () => void
}

const CatalogThemeContext = createContext<CatalogThemeContextType | undefined>(undefined)

const CATALOG_THEME_KEY = 'catalog-theme'
const APP_THEME_KEY = 'pos-theme'

export function useCatalogTheme() {
  const context = useContext(CatalogThemeContext)
  if (!context) throw new Error('useCatalogTheme must be used within CatalogThemeProvider')
  return context
}

export function CatalogThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<Theme>('light')
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    const stored = localStorage.getItem(CATALOG_THEME_KEY) as Theme | null
    const preferred: Theme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
    const resolved = stored ?? preferred
    setTheme(resolved)
    document.documentElement.classList.toggle('dark', resolved === 'dark')
    setMounted(true)

    return () => {
      const appTheme = localStorage.getItem(APP_THEME_KEY) as Theme | null
      const appPreferred: Theme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
      document.documentElement.classList.toggle('dark', (appTheme ?? appPreferred) === 'dark')
    }
  }, [])

  useEffect(() => {
    if (!mounted) return
    document.documentElement.classList.toggle('dark', theme === 'dark')
    localStorage.setItem(CATALOG_THEME_KEY, theme)
  }, [theme, mounted])

  const toggle = () => setTheme(prev => (prev === 'light' ? 'dark' : 'light'))

  return (
    <CatalogThemeContext.Provider value={{ theme, toggle }}>
      {children}
    </CatalogThemeContext.Provider>
  )
}

export function CatalogThemeToggle() {
  const { theme, toggle } = useCatalogTheme()

  return (
    <button
      onClick={toggle}
      aria-label={theme === 'light' ? 'Cambiar a modo oscuro' : 'Cambiar a modo claro'}
      className="flex items-center justify-center w-9 h-9 rounded-xl bg-zinc-100 hover:bg-zinc-200 text-zinc-600 dark:bg-accent dark:hover:bg-accent/80 dark:text-white/70 dark:hover:text-white border border-zinc-200 dark:border-edge transition-colors duration-200"
    >
      {theme === 'light' ? (
        <Moon size={16} strokeWidth={1.8} />
      ) : (
        <Sun size={16} strokeWidth={1.8} />
      )}
    </button>
  )
}
