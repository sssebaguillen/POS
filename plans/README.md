# Implementation Plans

Generados por la skill `improve`. Primera tanda (001–006) el 2026-06-12 (commit
`a549038`, scope: camino del dinero). Segunda tanda (007–014) el 2026-06-12
(commit `aa3b439`, auditoría general: correctness, seguridad, perf, tests, deps,
DX, docs — pesada hacia lo que la primera pasada no cubrió). Ejecutar en el
orden de abajo salvo que las dependencias digan otra cosa. Cada executor: leer
el plan completo antes de empezar, respetar sus STOP conditions, y actualizar
su fila al terminar.

## Execution order & status

| Plan | Title | Priority | Effort | Depends on | Status |
|------|-------|----------|--------|------------|--------|
| 001  | (v2) Integrar rama cloud `claude/test-coverage-analysis-3BbFX` + actualizar a era promos + suite de promotions.ts | P1 | M–L | — | DONE (2026-06-12, PR #7 mergeado a master; 387 tests verdes, CI "Tests / Unit tests" activo en cada PR) |
| 002  | Reemplazar `xlsx` abandonado (CVEs) por `@e965/xlsx` | P1 | S | — | DONE (2026-06-12, branch `worktree-agent-aea44f204ce54b923`, mergeado en master) |
| 003  | Remover deps `hono` + `@hono/node-server` sin uso | P2 | S | — | DONE (2026-06-12, branch `worktree-agent-ad05e35f07f411cec`, mergeado en master) |
| 004  | Re-asentar REVOKE/GRANT de RPCs reemplazadas post-auditoría | P2 | M | — | **DONE + APLICADA** (2026-06-13 vía MCP apply_migration). `20260613_03_reassert_rpc_grants.sql`: 15 funciones (excluidas las 16 de stats que 009 re-asienta, incl. get_sales_by_payment_detail). Drift detectado y sumado: `get_sale_detail` (20260612_03), `create_promotion`/`update_promotion` (20260612_04) estaban sin grants; firmas de catálogo tomadas de 20260612_05. `create_catalog_order` = anon (verificado en route.ts: cliente ANON). **Efecto real verificado vía pg_proc ACL**: cerró PUBLIC EXECUTE en `get_catalog_product_with_variants` y `normalize_permissions` (+anon); las otras 13 ya estaban en {authenticated,service_role} → no-op explícito (resistente a DROP+CREATE). schema.sql sincronizado (2 bloques). **Hallazgo fuera de scope**: quedan 8 funciones DEFINER con PUBLIC EXECUTE (triggers set_updated_at/update_stock_on_sale + get_business_id = by-design; get_catalog_categories/get_catalog_default_variant_prices/get_catalog_variant_filters via PUBLIC en vez de anon explícito = gap de higiene; bootstrap_new_user/rls_auto_enable = revisar) — candidato a una pasada futura |
| 005  | Centralizar `round2` + redondear subtotal del POS | P3 | S–M | 001 | DONE (2026-06-13; `round2` exportado de `lib/format.ts`, 4 sitios migrados — promotions.ts/cart.store.ts/pos+catalog CartPanel; subtotal del POS ahora `round2(reduce(...))`; +4 tests (round2 en format.test + caso subtotal-drift en cart.store.test); 398 tests/typecheck/lint/build verdes; grep deja solo format.ts y price-lists.ts (out-of-scope deliberado). Nota: el plan nombraba `cart-discount.test.ts` (inexistente) — el caso fue al `cart.store.test.ts` real) |
| 006  | Lint en verde: set-state-in-effect→warn, fix immutability/refs, ignorar .claude/ | P1 | S | — | DONE (2026-06-12, branch `worktree-agent-a09fe70642328e424`, mergeado en master) |
| 007  | Typecheck en verde (8 errores de tipos en tests) + gates lint/typecheck en CI | P1 | S | — | DONE (2026-06-13; 8 errores arreglados, script `typecheck` + steps Lint/Typecheck en CI; nota: `PostgrestError.toJSON` exigió devolver la forma del error, no `{}` como decía el plan) |
| 008  | Guard de `{success:false}` en los 5 consumidores de `get_product_with_variants` (4 crashean hoy) | P1 | S | 007 (soft — usa `npm run typecheck`) | DONE (2026-06-13; `unwrapProductWithVariants` en mappers.ts + 4 tests; 5 call sites migrados; 0 casts directos; typecheck/lint/build/391 tests verdes. Smoke UI verificado en browser: el path `{success:false}` requiere borrado FÍSICO — producto sin ventas; con ventas `delete_product` descontinúa (is_active=false, fila persiste) y el RPC sigue devolviendo success) |
| 009  | Migración SQL: día contable en TZ del negocio para 16 RPCs de stats (hoy filtran por día UTC) | P1 | L | — | **DONE + APLICADA** (2026-06-13 vía MCP apply_migration — `supabase db push` es INSEGURO acá, ver memoria; verificado en prod: Cecilia día 2026-05-25 KPIs ahora == snapshot $36k. Originalmente: `20260613_01_stats_business_local_day.sql` + schema.sql en sync; created_at::date 59→2; bug confirmado en prod: Q tal lokis 48/400, Cecilia 2/9. **Scope extendido sobre el plan**: también corrige EXTRACT(DOW) de kpis, date_trunc('week') de evolution, catalog_orders.created_at de channel y customer_account_movements.created_at de payment — mismo bug UTC, por consistencia interna. **Aplicar la decide el dueño** (`npm run supabase:db:push`). Drift p/010: owner/operator_stats tienen 4 call sites en 2 archivos — page.tsx:132,186 + OperatorMeView.tsx:158,162) |
| 010  | App: "hoy"/rangos en TZ del negocio (server seed UTC + offset -03:00 hardcodeado) | P1 | M | 009 **aplicada a la DB** | DONE (2026-06-13; `resolveDateRange` acepta `timeZone` + `todayInTimeZone`/`shiftDateString`; `getBusinessTimezone` en business.ts; offset `-03:00` eliminado de los 3 sitios; `operator/me` pasa `from`/`to` `date` directo a los RPCs post-009; timezone threaded en 12 pages + 7 views; 394 tests/typecheck/lint/build verdes. Smoke UI en browser pendiente) |
| 011  | RPC `get_low_stock_summary` — el dashboard deja de traer 5000 productos por carga | P2 | S–M | — | **DONE + APLICADA** (2026-06-13 vía MCP apply_migration). **STOP condition disparada y resuelta**: el plan asumía que `products` solo alimentaba la KPI card, pero `DashboardView` tiene un 2º consumidor — el panel "Alertas de stock" (líneas ~482-537) que lista la lista COMPLETA de críticos. El RPC del plan (conteos + preview[2]) lo habría roto. Con OK del dueño se **rediseñó el RPC** para devolver el subconjunto crítico completo (id,name,stock,min_stock) + conteos, ordenado server-side (sin stock primero, stock asc, nombre); alimenta KPI card Y panel sin traer 5000 filas. min_stock nullable → COALESCE(min_stock,0) (paridad con `Number(null)` del TS viejo). page.tsx swap + DashboardView (ProductRecord→LowStockItem/LowStockSummary, 5 useMemo→derivación directa). 412 tests/typecheck/lint/build verdes. Verificado en prod (tienda de seba: 6 sin stock, lista correcta). Smoke UI en browser pendiente del dueño. Nota: `limit(5000)` aún existe en activity/page.tsx (audit log, fuera de scope) |
| 012  | Tests de los gates de ruta/permisos de `proxy.ts` (~14 casos, firma HMAC real) | P2 | M | 007 (soft) | DONE (2026-06-13; `src/__tests__/proxy.test.ts`, 14 casos: routing de auth, limpieza de cookies inválidas, verificación HMAC end-to-end (firma real vía `signOperatorSession`), 8 gates (5 directos + 3 por gate compartido), caso permitido y redirect de /operator-select por rol. Mock mínimo de `@supabase/ssr` (solo `auth.getUser`); `NextRequest`/`NextResponse` corren en el env node de vitest sin polyfills. 412 tests/typecheck/lint verdes; el contrato de la tabla de gates de proxy.ts quedó igual — sin sorpresas) |
| 013  | Higiene de deps: pin `@posthog/cli`, `shadcn` fuera de dependencies, declarar `@radix-ui/react-visually-hidden` | P3 | S | — | DONE (2026-06-13; `@posthog/cli` `latest`→`^0.7.11`, `shadcn` eliminado de dependencies, `@radix-ui/react-visually-hidden ^1.2.3` declarado; `npm install` eliminó el árbol transitivo de shadcn del lockfile (−2960 líneas, todas deps del CLI: @inquirer/ts-morph/@antfu/ni/etc.); `@posthog/cli` quedó en 0.7.11; 398 tests/lint/build verdes) |
| 014  | Imágenes: decidir optimización Next/Vercel vs `unoptimized` global documentado (11 componentes) | P3 | S | — | TODO (gate: decisión de cuota Vercel del operador) |

Status values: TODO | IN PROGRESS | DONE | BLOCKED (con motivo en una línea) | REJECTED (con justificación)

## Dependency notes

- **Orden recomendado de ejecución (tanda 2)**: `007 → 008 → 009 → [el dueño
  aplica la migración del 009 a la DB] → 010 → 011 → 012 → 013 → 014`.
  Los pendientes de la tanda 1 (`004`, `005`) pueden intercalarse en cualquier
  momento; si se ejecuta `004`, hacerlo DESPUÉS de `009` (ver nota 009 ↔ 004).
- **007 primero**: es barato y endurece la verificación de todos los demás
  (lint + typecheck en cada PR). 008 y 012 usan `npm run typecheck` en sus
  gates (con fallback a `npx tsc --noEmit` si 007 no aterrizó).
- **010 requiere 009 APLICADA** (no solo escrita): 009 cambia la firma de
  `get_owner_stats`/`get_operator_stats` a parámetros `date`; el lado TS de 010
  rompería `/operator/me` contra la DB vieja. 009 produce la migración pero
  **NO la aplica** — la aplicación es decisión del dueño (misma convención que
  004) + sincronizar `supabase/schema.sql` (el plan ya lo deja en sync).
- **009 ↔ 004**: 009 re-asienta REVOKE/GRANT de las 16 funciones que reemplaza;
  al ejecutar 004, excluirlas para no duplicar.
- **011** tiene un gate interno: su migración (aditiva, segura de aplicar sola)
  debe estar aplicada antes del swap de UI del mismo plan.
- **005 requiere 001** (hecho): ya está desbloqueado.
- 013 y 014 son independientes y pueden ejecutarse en cualquier momento.
- Dirección pendiente de decisión del dueño (no planificada en esta tanda):
  segmentación POS vs catálogo en stats (`sales.source` + `get_channel_signals`
  ya existen, falta UI — coordinar DESPUÉS de 009/010 porque toca la misma zona
  de RPCs), lista de precios del catálogo configurable (desbloqueada post-ofertas),
  export completo del negocio (fase 1, plan de diseño).

## Findings considered and rejected

(Para que nadie los re-audite.)

### Auditoría 2026-06-12 — camino del dinero (4 subagentes)

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
  deliberadamente (`docs/todo/backlog.md`).
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

### Auditoría 2026-06-12 — general (4 subagentes, vetting manual del advisor)

- **"Promos sin `assert_tenant` como primera sentencia"** (create/update/archive_promotion):
  by-design — usan el patrón equivalente (`get_business_id()` + early return)
  explícitamente permitido por la regla 34, con REVOKE/GRANT correctos en la
  misma migración (`20260609_05:898-916`).
- **"`op_perms` podría usarse para authz server-side"**: verificado — la cookie
  solo se ESCRIBE server-side (proxy + switch/logout routes); ningún código de
  servidor la lee para autorización. El diseño documentado en CLAUDE.md se cumple.
- **"El catálogo anon podría exponer `cost`"**: verificado — en
  `get_catalog_products`/`get_catalog_product_with_variants` el `cost` solo entra
  como argumento de `compute_effective_price`; ningún JSON de salida lo incluye.
- **"Faltan `useMemo` en vistas de detalle de stats"**: React Compiler está activo
  (`reactCompiler: true` en next.config.ts) y memoiza esos componentes
  automáticamente; agregar useMemo manual es ruido.
- **recharts a dynamic import con `ssr:false`**: ya hay code-splitting por ruta;
  el cambio agrega riesgo de CLS por una ganancia chica. Not worth doing hoy.
- **Helper `unwrapRPC<T>` genérico para los casts**: el cast `as unknown as` es
  convención documentada (regla 15) y un helper no validaría nada en runtime —
  solo escondería el cast.
- **"No hay component tests" (genérico)**: gap conocido y anotado en
  `vitest.config.ts` ("UI components are excluded until a jsdom/RTL setup lands");
  lo accionable concreto quedó en los planes 008/012 y en los hallazgos menores
  de abajo.
- **Prettier/.editorconfig**: churn masivo de formato en un repo solo-dev con
  ESLint ya activo; bajo valor hoy.
- **axios vía `@posthog/cli`** (re-reportado por 2 subagentes): ya conocido y
  diferido — ver tanda anterior.

### Hallazgos menores aceptados pero NO planificados (decisión del dueño, 2026-06-12)

- `src/lib/catalog-cart.ts` sin tests (TTL 8h, migración de formato legacy,
  clamping a stock — funciones puras, S). No seleccionado en esta tanda.
- `/api/feedback` sin tests (auth + validación de path de attachments, S).
- `docs/db.md` desfasado ~40 migraciones ("last verified 2026-05-16") + CLAUDE.md
  nombra el permiso `analysis` en rutas donde el proxy usa `reports`.
- Scaffold duplicado en 6+ vistas de detalle de stats (~300-400 líneas:
  PageHeader + DateRangeFilter + URL-sync + CSV) — refactor L, encaja post-beta.
- No hay README (repo privado solo-dev; CLAUDE.md + `.env.local.example` cubren
  el onboarding).

## Not audited

- **Tanda 1 (camino del dinero)**: dirección/roadmap, stats, inventario profundo,
  settings, cash-sessions a fondo en SQL — cubiertos por la tanda 2.
- **Tanda 2 (general)**: interior de las edge functions (`extract-expense`,
  `generate-insights`, `refresh-daily-snapshots` — solo superficie de auth),
  SQL profundo de `cash_sessions`, wizard de onboarding, `printer/escpos` a fondo,
  y el smoke UI en browser de promos (pendiente en `docs/todo/backlog.md`, es QA
  manual, no auditoría estática).
