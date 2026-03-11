import PageHeader from '@/components/shared/PageHeader'

export default function SettingsPage() {
  return (
    <div className="flex flex-col h-screen overflow-hidden">
      <PageHeader title="Configuración" />
      <div className="flex-1 overflow-y-auto p-6">
        <div className="rounded-2xl bg-card border border-border/60 p-12 text-center text-muted-foreground">
          <p className="text-sm">Próximamente — configuración del negocio</p>
        </div>
      </div>
    </div>
  )
}
