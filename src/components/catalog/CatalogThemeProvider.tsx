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

function getCatalogTheme(): Theme {
  if (typeof window === 'undefined') {
    return 'light'
  }

  const stored = localStorage.getItem(CATALOG_THEME_KEY)
  if (stored === 'dark' || stored === 'light') {
    return stored
  }

  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function useCatalogTheme() {
  const context = useContext(CatalogThemeContext)
  if (!context) throw new Error('useCatalogTheme must be used within CatalogThemeProvider')
  return context
}

export function CatalogThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<Theme>(getCatalogTheme)

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
    localStorage.setItem(CATALOG_THEME_KEY, theme)

    return () => {
      const appTheme = localStorage.getItem(APP_THEME_KEY)
      const appPreferred: Theme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
      document.documentElement.classList.toggle('dark', (appTheme ?? appPreferred) === 'dark')
    }
  }, [theme])

  const toggle = () => setTheme(prev => (prev === 'light' ? 'dark' : 'light'))

  return (
    <CatalogThemeContext.Provider value={{ theme, toggle }}>
      {children}
    </CatalogThemeContext.Provider>
  )
}

export function CatalogThemeToggle() {
  const { theme, toggle } = useCatalogTheme()
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  const themeForUi = mounted ? theme : 'light'

  return (
    <button
      onClick={toggle}
      aria-label={themeForUi === 'light' ? 'Cambiar a modo oscuro' : 'Cambiar a modo claro'}
      className="flex items-center justify-center w-9 h-9 rounded-xl bg-muted hover:bg-secondary text-muted-foreground hover:text-foreground border border-border transition-colors duration-200"
    >
      {themeForUi === 'light' ? (
        <Moon size={16} strokeWidth={1.8} />
      ) : (
        <Sun size={16} strokeWidth={1.8} />
      )}
    </button>
  )
}
