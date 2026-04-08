import { CatalogThemeProvider } from '@/components/catalog/CatalogThemeProvider'

export default function CatalogLayout({ children }: { children: React.ReactNode }) {
  return <CatalogThemeProvider>{children}</CatalogThemeProvider>
}
