import PageHeader from '@/components/shared/PageHeader'

export default function ProductsPage() {
  return (
    <div className="flex flex-col h-screen overflow-hidden">
      <PageHeader title="Productos" />
      <div className="flex-1 overflow-y-auto p-6">
        <div className="rounded-2xl bg-card border border-border/60 p-12 text-center text-muted-foreground">
          <p className="text-sm">Próximamente — gestión avanzada de productos</p>
        </div>
      </div>
    </div>
  )
}
