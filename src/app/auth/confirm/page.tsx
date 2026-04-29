import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { Button } from '@/components/ui/button'
import Link from 'next/link'
import { MailCheck, AlertCircle } from 'lucide-react'

interface Props {
  searchParams: Promise<{ token_hash?: string; type?: string }>
}

export default async function ConfirmPage({ searchParams }: Props) {
  const { token_hash, type } = await searchParams

  if (!token_hash || !type) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="bg-card p-8 rounded-xl shadow-sm border border-border w-full max-w-md text-center">
          <AlertCircle className="mx-auto mb-4 h-12 w-12 text-destructive" />
          <h1 className="text-2xl font-bold text-foreground mb-2">Link inválido</h1>
          <p className="text-muted-foreground text-sm mb-6">
            Este link de confirmación no es válido o ya expiró.
          </p>
          <Button asChild variant="outline" className="w-full">
            <Link href="/login">Volver al inicio de sesión</Link>
          </Button>
        </div>
      </div>
    )
  }

  async function confirmEmail() {
    'use server'
    const supabase = await createClient()
    const { error } = await supabase.auth.verifyOtp({
      token_hash: token_hash!,
      type: type as 'email' | 'recovery' | 'invite' | 'email_change',
    })
    if (error) {
      console.log('[auth/confirm] verifyOtp error:', { message: error.message, status: error.status })
      redirect('/login?error=invalid_link')
    }
    const { error: signOutError } = await supabase.auth.signOut()
    if (signOutError) {
      console.log('[auth/confirm] signOut error:', { message: signOutError.message, status: signOutError.status })
    }
    redirect('/email-confirmed')
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="bg-card p-8 rounded-xl shadow-sm border border-border w-full max-w-md text-center">
        <MailCheck className="mx-auto mb-4 h-12 w-12 text-primary" />
        <h1 className="text-2xl font-bold text-foreground mb-2">Confirmá tu cuenta</h1>
        <p className="text-muted-foreground text-sm mb-6">
          Hacé click en el botón para activar tu cuenta en Pulsar.
        </p>
        <form action={confirmEmail}>
          <Button type="submit" className="w-full">
            Confirmar mi cuenta
          </Button>
        </form>
      </div>
    </div>
  )
}
