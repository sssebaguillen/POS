import { CatalogThemeProvider } from '@/components/catalogo/CatalogThemeProvider'

export default function CatalogLayout({ children }: { children: React.ReactNode }) {
  return <CatalogThemeProvider>{children}</CatalogThemeProvider>
}
