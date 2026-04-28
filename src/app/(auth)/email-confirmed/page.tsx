import { CheckCircle2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import Link from 'next/link'

export default function EmailConfirmedPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="bg-card p-8 rounded-xl shadow-sm border border-border w-full max-w-md text-center">
        <CheckCircle2 className="mx-auto mb-4 h-12 w-12 text-primary" />
        <h1 className="text-2xl font-bold text-foreground mb-2">¡Email confirmado!</h1>
        <p className="text-muted-foreground text-sm mb-6">
          Tu cuenta está lista. Ya podés iniciar sesión en Pulsar.
        </p>
        <Button asChild className="w-full">
          <Link href="/login">Ir al inicio de sesión</Link>
        </Button>
      </div>
    </div>
  )
}
