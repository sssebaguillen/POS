# Implementation Plans

Generados por la skill `improve` el 2026-06-12 (commit `a549038`), a partir de una
auditoría del **camino del dinero** (POS → precios/promos → checkout de catálogo →
pedidos online → caja). Ejecutar en el orden de abajo salvo que las dependencias
digan otra cosa. Cada executor: leer el plan completo antes de empezar, respetar
sus STOP conditions, y actualizar su fila al terminar.

## Execution order & status

| Plan | Title | Priority | Effort | Depends on | Status |
|------|-------|----------|--------|------------|--------|
| 001  | (v2) Integrar rama cloud `claude/test-coverage-analysis-3BbFX` + actualizar a era promos + suite de promotions.ts | P1 | M–L | — | DONE (2026-06-12, PR #7 mergeado a master; 387 tests verdes, CI "Tests / Unit tests" activo en cada PR) |
| 002  | Reemplazar `xlsx` abandonado (CVEs) por `@e965/xlsx` | P1 | S | — | DONE (2026-06-12, branch `worktree-agent-aea44f204ce54b923`, mergeado en master) |
| 003  | Remover deps `hono` + `@hono/node-server` sin uso | P2 | S | — | DONE (2026-06-12, branch `worktree-agent-ad05e35f07f411cec`, mergeado en master) |
| 004  | Re-asentar REVOKE/GRANT de RPCs reemplazadas post-auditoría | P2 | M | — | TODO |
| 005  | Centralizar `round2` + redondear subtotal del POS | P3 | S–M | 001 | TODO |
| 006  | Lint en verde: set-state-in-effect→warn, fix immutability/refs, ignorar .claude/ | P1 | S | — | DONE (2026-06-12, branch `worktree-agent-a09fe70642328e424`, mergeado en master) |

Status values: TODO | IN PROGRESS | DONE | BLOCKED (con motivo en una línea) | REJECTED (con justificación)

## Dependency notes

- **005 requiere 001**: 005 toca la aritmética del carrito en 4 archivos; sin la
  red de tests del 001 no hay forma mecánica de probar que el refactor es
  numéricamente neutro.
- 004 produce una migración SQL pero **NO la aplica** — la aplicación a la DB
  remota es decisión del operador (y luego sincronizar `supabase/schema.sql`).
- 002 y 003 son independientes y pueden ejecutarse en cualquier momento.

## Findings considered and rejected

(Para que nadie los re-audite. Auditoría 2026-06-12, 4 subagentes, scope camino del dinero.)

- **"Preview de ticket roto por `router.refresh()`"** (PaymentModal): falso positivo —
  `router.refresh()` preserva el estado de componentes cliente; el modal no se
  desmonta y `setReceipt` corre normalmente.
- **"Carrito del catálogo no se limpia ante fallo"**: by-design — `CatalogShell`
  limpia el carrito sincrónicamente en `onOrderSuccess`; hay comentario en
  `catalog/CartPanel.tsx` documentándolo.
- **Rate-limit bucket `no-ip` compartido** (`/api/catalog/orders`): en Vercel
  `x-real-ip` siempre está presente (el código lo comenta); impacto real ~nulo.
  El rate limit in-memory es best-effort por instancia serverless, mitigado por
  el límite de 3 pedidos pendientes por teléfono en la RPC.
- **InventoryPanel ~1300 líneas**: deuda ya reconocida y diferida post-beta
  deliberadamente (`docs/backlog.md`).
- **CashSessionWidget pollea en todas las páginas**: UX intencional (estado de
  caja visible app-wide), 30s es barato.
- **Doble polling en /orders** (UnreadBadge 10s + OrdersView 10s con invalidación
  cruzada): impacto bajo; el poll app-wide del badge es el feature. Si molesta,
  dedupe menor. Nota: CLAUDE.md dice 30s pero el código usa 10s — doc drift.
- **Subtotal sin redondear antes del descuento %**: display-only (SQL redondea al
  persistir) — absorbido por el plan 005, no amerita plan propio.
- **Extraer helper `computeLineTotal(item, promo)`**: abstracción prematura — las
  fórmulas de línea de POS y catálogo operan sobre tipos distintos (ver scope
  del 005).
- **Vulns de `axios` vía `@posthog/cli` y PostCSS vía Next**: dev-only / sin vector
  confirmado; monitorear en la próxima ventana de upgrades, no accionable hoy.

## Not audited

Dirección/roadmap, stats, inventario profundo, settings, y cash-sessions a fondo
en SQL quedaron fuera del scope de esta pasada.
