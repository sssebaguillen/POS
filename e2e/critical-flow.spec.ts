import { test, expect, type Page } from '@playwright/test'
import fs from 'node:fs'

/**
 * Diagnóstico E2E del flujo crítico de un negocio nuevo:
 * registro → login dueño → onboarding wizard → primer producto → venta POS → caja.
 *
 * Es un diagnóstico, no un gate: cada fase va en try/catch, captura screenshot,
 * y registra hallazgos en vez de abortar. Al final imprime el reporte y falla
 * sólo si la fase núcleo (registro/login/venta) se rompió.
 */

const SHOT_DIR = 'e2e/screenshots'
fs.mkdirSync(SHOT_DIR, { recursive: true })

const stamp = Date.now()
const EMAIL = `e2e+${stamp}@test.local`
const PASSWORD = 'test1234'
const BUSINESS = `Kiosco E2E ${stamp}`
const OWNER = 'Dueño E2E'
const PRODUCT = `Producto E2E ${stamp}`

type Finding = { phase: string; level: 'ok' | 'warn' | 'fail'; detail: string }
const findings: Finding[] = []
const consoleErrors: string[] = []
const pageErrors: string[] = []
const failedRequests: string[] = []

let shotN = 0
async function shot(page: Page, name: string) {
  shotN += 1
  const file = `${SHOT_DIR}/${String(shotN).padStart(2, '0')}-${name}.png`
  await page.screenshot({ path: file, fullPage: true }).catch(() => {})
}

async function phase(page: Page, name: string, fn: () => Promise<void>) {
  try {
    await fn()
    findings.push({ phase: name, level: 'ok', detail: 'completado' })
  } catch (err) {
    const msg = err instanceof Error ? err.message.split('\n')[0] : String(err)
    findings.push({ phase: name, level: 'fail', detail: msg })
    await shot(page, `FAIL-${name.replace(/\s+/g, '-')}`)
  }
}

test('flujo crítico de negocio nuevo', async ({ page }) => {
  test.setTimeout(180_000)

  page.on('console', m => {
    if (m.type() === 'error') consoleErrors.push(m.text())
  })
  page.on('pageerror', e => pageErrors.push(e.message))
  page.on('requestfailed', r => {
    const u = r.url()
    if (!u.includes('posthog') && !u.includes('/ingest')) {
      failedRequests.push(`${r.method()} ${u} — ${r.failure()?.errorText ?? ''}`)
    }
  })
  page.on('response', r => {
    if (r.status() >= 500) failedRequests.push(`${r.status()} ${r.request().method()} ${r.url()}`)
  })

  // ── Fase 1: Registro ────────────────────────────────────────────────
  await phase(page, 'registro', async () => {
    await page.goto('/register')
    await shot(page, 'register-empty')
    await page.getByPlaceholder(/Nombre del negocio/i).fill(BUSINESS)
    await page.getByPlaceholder(/Tu nombre/i).fill(OWNER)
    await page.getByPlaceholder('Email').fill(EMAIL)
    await page.getByPlaceholder(/Contraseña/i).fill(PASSWORD)
    await shot(page, 'register-filled')
    await page.getByRole('button', { name: /Crear negocio gratis/i }).click()
    await page.waitForURL(/operator-select/, { timeout: 30_000 })
    await shot(page, 'operator-select')
  })

  // ── Fase 2: Login del dueño ─────────────────────────────────────────
  await phase(page, 'login dueño', async () => {
    // La tarjeta del dueño es el primer botón; contiene el nombre del dueño.
    await page.getByRole('button').filter({ hasText: OWNER }).first().click()
    await page.getByLabel('Contraseña').fill(PASSWORD)
    await shot(page, 'owner-password')
    await page.getByRole('button', { name: /Iniciar turno/i }).click()
    await page.waitForURL(/dashboard/, { timeout: 30_000 })
    await page.waitForTimeout(1500)
    await shot(page, 'dashboard')
  })

  // ── Fase 3: Onboarding wizard ───────────────────────────────────────
  await phase(page, 'onboarding wizard', async () => {
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible({ timeout: 10_000 })
    await shot(page, 'wizard-step0-negocio')

    // step 0 — datos básicos (nombre prellenado)
    await dialog.getByRole('button', { name: /^Siguiente$/ }).click()
    await page.waitForTimeout(400)

    // step 1 — categoría
    await dialog.getByPlaceholder(/Ej: Bebidas/i).fill('Bebidas')
    await shot(page, 'wizard-step1-categoria')
    await dialog.getByRole('button', { name: /^Siguiente$/ }).click()
    await page.waitForTimeout(800)

    // step 2 — marca
    await dialog.getByPlaceholder(/Ej: Coca-Cola/i).fill('Marca E2E')
    await shot(page, 'wizard-step2-marca')
    await dialog.getByRole('button', { name: /^Siguiente$/ }).click()
    await page.waitForTimeout(800)

    // step 3 — primer producto (NewProductModal embebido)
    await dialog.getByPlaceholder(/Ej: Pan sin TACC/i).fill(PRODUCT)
    // Fix 2: la categoría y marca creadas en pasos 1-2 deben venir preseleccionadas.
    await expect(dialog.getByPlaceholder(/Seleccionar categor/i)).toHaveValue(/Bebidas/i)
    await expect(dialog.getByPlaceholder(/Seleccionar marca/i)).toHaveValue(/Marca E2E/i)
    const nums = dialog.locator('input[type="number"]')
    await nums.nth(0).fill('50')   // Costo
    await nums.nth(1).fill('100')  // Precio venta
    await nums.nth(2).fill('25')   // Stock inicial
    await shot(page, 'wizard-step3-producto')
    await dialog.getByRole('button', { name: /Crear producto/i }).click()
    await page.waitForTimeout(1200)
    await shot(page, 'wizard-step4-operario')

    // step 4 — operario: saltar y finalizar
    const finalizar = dialog.getByRole('button', { name: /Finalizar/i })
    const saltar = dialog.getByRole('button', { name: /^Saltar$/ })
    if (await finalizar.isVisible().catch(() => false)) await finalizar.click()
    else if (await saltar.isVisible().catch(() => false)) await saltar.click()
    await page.waitForTimeout(1200)
    await shot(page, 'dashboard-post-wizard')
  })

  // ── Fase 3b: Fix 4 — el tour es OPT-IN, no auto-arranca ─────────────
  await phase(page, 'tour opt-in', async () => {
    // Debe aparecer el prompt descartable (NO el tour de 7 pasos tomando la pantalla).
    const prompt = page.getByText(/¿Querés un recorrido rápido\?/i)
    await expect(prompt).toBeVisible({ timeout: 8_000 })
    await shot(page, 'tour-prompt')
    // El tour NO debe estar activo (no hay "Saltar tour" del recorrido).
    expect(await page.getByRole('button', { name: /Saltar tour/i }).count()).toBe(0)
    // Dueño elige seguir sin tour.
    await page.getByRole('button', { name: /Ahora no/i }).click()
    await page.waitForTimeout(600)
    await shot(page, 'tour-dismissed')
  })

  // ── Fase 4: Venta en el POS ─────────────────────────────────────────
  await phase(page, 'venta POS', async () => {
    await page.goto('/pos')
    await page.waitForTimeout(1500)
    await shot(page, 'pos-empty')
    const search = page.getByPlaceholder(/Buscar producto/i).first()
    await search.fill('Producto E2E')
    await page.waitForTimeout(1000)
    await shot(page, 'pos-search')
    // click en el producto para agregarlo al carrito
    await page.getByText(PRODUCT).first().click()
    await page.waitForTimeout(800)
    await shot(page, 'pos-cart')
    await page.getByRole('button', { name: /Cobrar/i }).click()
    await page.waitForTimeout(800)
    await shot(page, 'pos-payment-modal')
    // Fix 1: efectivo prellena "Monto recibido" con el total → Confirmar venta
    // debe estar habilitado SIN tipear nada. Si sigue disabled, este click expira.
    const confirmar = page.getByRole('button', { name: /Confirmar venta/i })
    await expect(confirmar).toBeEnabled({ timeout: 5_000 })
    await confirmar.click()
    await page.waitForTimeout(1500)
    await shot(page, 'pos-sale-done')
  })

  // ── Fase 5: Caja (apertura/cierre) ──────────────────────────────────
  await phase(page, 'caja', async () => {
    await page.goto('/cash-sessions')
    await page.waitForTimeout(1500)
    await shot(page, 'cash-sessions')
  })

  // ── Reporte ─────────────────────────────────────────────────────────
  const report = [
    '\n══════════ DIAGNÓSTICO FLUJO CRÍTICO ══════════',
    ...findings.map(f => `  [${f.level.toUpperCase()}] ${f.phase} — ${f.detail}`),
    `\n  Errores de consola (${consoleErrors.length}):`,
    ...consoleErrors.slice(0, 15).map(e => `    · ${e.slice(0, 180)}`),
    `\n  Errores de página/JS (${pageErrors.length}):`,
    ...pageErrors.slice(0, 15).map(e => `    · ${e.slice(0, 180)}`),
    `\n  Requests fallidos / 5xx (${failedRequests.length}):`,
    ...failedRequests.slice(0, 15).map(e => `    · ${e.slice(0, 180)}`),
    '═══════════════════════════════════════════════\n',
  ].join('\n')
  console.log(report)
  fs.writeFileSync('e2e/diagnostic-report.txt', report)

  // Falla el test sólo si una fase núcleo se rompió.
  const coreFailed = findings.filter(
    f => f.level === 'fail' && ['registro', 'login dueño', 'venta POS'].includes(f.phase),
  )
  expect(coreFailed, `Fases núcleo rotas: ${coreFailed.map(f => f.phase).join(', ')}`).toHaveLength(0)
})
