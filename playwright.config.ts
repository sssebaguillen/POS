import { execSync } from 'node:child_process'
import { defineConfig, devices } from '@playwright/test'

// E2E del flujo crítico contra el stack LOCAL de Supabase (no prod).
// Las claves son del stack local (supabase start) — no son secretos de prod.
const PORT = 3100
const BASE_URL = `http://127.0.0.1:${PORT}`

// Claves del Supabase LOCAL (nunca de prod). En CI vienen por env (las setea el
// workflow). En local, si no están en el entorno, se leen EN VIVO de
// `supabase status` — así NO queda ningún secreto hardcodeado en el repo
// (la push protection de GitHub bloquea hasta las claves del stack local).
// OJO: NO incluir NODE_ENV. `next start` sirve el build de producción y debe
// correr con NODE_ENV=production (su default). Forzar 'development' rompe la
// hidratación (mismatch dev/prod de React) — fue una regresión real.
function localSupabaseEnv(): Record<string, string> {
  if (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) return {}
  try {
    const out = execSync('supabase status -o env', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
    const pick = (k: string) => out.match(new RegExp(`^${k}="?([^"\\n]+)`, 'm'))?.[1] ?? ''
    return {
      NEXT_PUBLIC_SUPABASE_URL: pick('API_URL'),
      NEXT_PUBLIC_SUPABASE_ANON_KEY: pick('ANON_KEY'),
      SUPABASE_SERVICE_ROLE_KEY: pick('SERVICE_ROLE_KEY'),
    }
  } catch {
    return {}
  }
}

const local = localSupabaseEnv()
const LOCAL_ENV = {
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL ?? local.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? local.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY ?? local.SUPABASE_SERVICE_ROLE_KEY ?? '',
  // No es secreto de prod: firma la cookie de operador SOLO en el entorno E2E.
  OPERATOR_SESSION_SECRET: process.env.OPERATOR_SESSION_SECRET ?? 'e2e-local-operator-session-secret-not-for-production',
}

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'e2e/report' }]],
  timeout: 120_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: BASE_URL,
    screenshot: 'on',
    trace: 'on',
    video: 'on',
    actionTimeout: 15_000,
    navigationTimeout: 45_000,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  // Servimos el BUILD de producción (next start), no `next dev`: el dev mode
  // --webpack (HMR + eval-source-map) no hidrata de forma fiable y el E2E debe
  // probar el artefacto que el usuario realmente corre. Requiere `npm run build`
  // previo con las mismas NEXT_PUBLIC_* del stack local (ya horneadas en el bundle).
  webServer: {
    command: `next start -p ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: true,
    timeout: 120_000,
    env: LOCAL_ENV,
    stdout: 'pipe',
    stderr: 'pipe',
  },
})
