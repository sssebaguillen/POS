# 09 — Auditoría de calidad de código

Auditoría de calidad (solo lectura, **sin fixes aplicados**) sobre `src/`. Complementa la auditoría de seguridad (`08-auditoria-seguridad.md`): aquí el foco es mantenibilidad, deuda técnica, duplicación, dead code, tipos y consistencia con las convenciones de `CLAUDE.md`.

> Fecha: 2026-05-29. Método: 3 pasadas de recolección mecánica en paralelo (ESLint + `tsc --noEmit` + `npm audit`; inventario de tipos laxos/dead code; chequeo de convenciones/duplicación) + lectura y juicio manual de `InventoryPanel.tsx` y verificación SQL de la policy RLS de `products`. Cada hallazgo está clasificado como **confirmado**, **a verificar (ambigüedad)** o **falso positivo / no-issue**, para no "arreglar" lo que no está roto.

---

## TL;DR

- **`tsc --noEmit`: limpio (0 errores).** No hay deuda de tipos. Los 41 `as unknown as {data}` son el wrapper de RPC mandado por la regla 15 — correctos.
- **El código está disciplinado con las convenciones:** proxy único, precio vía `calculateProductPrice`, catálogo vía RPCs, cookie HMAC, post-switch con `window.location`, `OWNER_PERMISSIONS`/`Permissions` centralizados — todo limpio.
- **Hallazgo de mayor valor:** los `QuickEdit` modals de inventario saltean la RPC guardada → **gap de auditoría + de permisos** (sección 1.1). Es calidad *y* seguridad.
- **Sospecha de bug funcional** en el scroll infinito de `InventoryPanel` (sección 1.2) — a verificar con >60 productos.
- El resto es deuda de bajo riesgo: 1 dep de prod a actualizar (`protobufjs`), dead code menor, duplicación puntual, y archivos grandes (cluster de modales de inventario).

---

## 1. Confirmados — accionables

### 1.1 ✅ RESUELTO (2026-05-29) — `QuickEdit` de categoría/marca saltean la RPC guardada (regla 32)

> Verificado: `QuickEditCategoryModal` y `QuickEditBrandModal` ahora rutean por `update_product` (y `create_*_guarded`). Cierra el gap de auditoría y de permisos.


`QuickEditCategoryModal.tsx` (L70-75 y L84-89) y `QuickEditBrandModal.tsx` (L56-58 y L65-67) hacen `supabase.from('products').update({category_id|brand_id}).eq('id', ...)` **directo**, en vez de pasar por `update_product`. Dos consecuencias **confirmadas**:

1. **Gap de auditoría:** estos cambios no pasan por `log_audit_event` (lo invoca la RPC) → quedan **invisibles en `/activity`**. Contradice la intención de las reglas 31/32.
2. **Gap de permisos:** verificado por SQL — la policy RLS `products_stock_write_update` enforza `business_id = get_business_id()` **AND** (`EXISTS profiles WHERE id=auth.uid()` **OR** `EXISTS operators WHERE id=auth.uid() AND stock_write`). Pero **los operadores montan sobre la sesión Supabase del dueño**, así que `auth.uid()` es *siempre* el dueño → la rama `profiles` siempre da true y la rama `operators` **nunca matchea (código muerto en la práctica)**. ⇒ A nivel RLS la policy **solo aísla por tenant, no enforza `stock_write` del operador**. Ese permiso lo enforza **únicamente la RPC** (vía `p_operator_id`) + el guard de cliente (`readOnly`). Como el QuickEdit saltea la RPC, el único freno es el guard de cliente (bypasseable). Un operador con `stock` pero sin `stock_write`, salteando el cliente, podría reasignar categoría/marca.

**Acotación honesta:** el impacto es dentro del propio tenant y limitado a reasignar categoría/marca (no precio, stock ni borrado), así que es media, no alta. **Fix natural:** rutear ambos QuickEdit por `update_product` (o una RPC específica) como el resto de mutadores.

**Insight de arquitectura (documentar, no es bug):** la rama `operators` de las policies `products_stock_write_*` es efectivamente inalcanzable dado el modelo de auth (operador = sesión del dueño + cookie). Por eso **las RPCs guardadas son el único enforcer server-side del permiso de operador** — RLS no es backstop para permisos de operador, solo para tenant. Esto hace que la regla 32 (todo mutador de inventario por RPC) sea *load-bearing de seguridad*, no solo de auditoría.

### 1.2 ✅ RESUELTO (2026-05-29) — scroll infinito de `InventoryPanel` posiblemente roto

> Verificado: el `useEffect` de reset de paginación ahora depende de `sortField`/`sortDir` (primitivos), no del objeto `sort`. El comentario en el código lo documenta. Ya no se auto-resetea cada render.


`InventoryPanel.tsx:188-191` — el `useEffect` que resetea `setVisibleCount(PAGE_SIZE)` depende de `sort`, que es un **objeto recreado en cada render** (L72: `const sort = { field, dir }`). Como React compara deps por identidad, el efecto corre en **cada render** y resetea `visibleCount` a 60. El scroll infinito (L194-208) sube `visibleCount`, dispara re-render, y el reset lo vuelve a 60 → con **>60 productos filtrados el "cargar más" se desharía solo**.

- Corroborado por ESLint (`react-hooks/exhaustive-deps`: `sort` cambia deps cada render) + el `eslint-disable react-hooks/set-state-in-effect` en L189 que tapa parte del olor.
- **Confianza alta en el mecanismo, pero marcado como a-verificar** porque probablemente no se detectó por bajo volumen en las pruebas. **Verificación: cargar un negocio con >60 productos en una vista y scrollear.** Si se confirma, el fix es depender de `sortField`/`sortDir` (primitivos) en vez de `sort`.

### 1.3 ✅ RESUELTO (2026-05-29) — `protobufjs` vulnerable en runtime de producción

Única vuln de `npm audit` que (a) llega al runtime del POS desplegado y (b) tiene fix no-breaking. **Corregido con `npm audit fix`: `protobufjs 7.5.5 → 7.6.1`** (fuera del rango vulnerable `<=7.5.7`). Build de producción OK tras el bump. Nota: en este punto entraba por `posthog-js` → `@opentelemetry/otlp-transformer` (no por `@sentry/nextjs` como decía el audit original — cambió la ruta de dependencia, misma conclusión).

**High restantes descartados (no runtime del POS):** `axios` y `minimatch` viven dentro de `@posthog/cli/node_modules/` (herramienta CLI/dev) y su fix exige `--force`/breaking → se dejan. El resto (`postcss`, `qs`, `fast-uri`, etc.) es build-tooling sin fix no-breaking.

### 1.4 ✅ RESUELTO / RECLASIFICADO (2026-05-29) — dead code

- `lib/date-utils.ts:41` — `getDayLabel` **eliminado** (ya no existe en el código).
- `InventoryPanel.tsx` — directiva `eslint-disable` huérfana **eliminada**.
- `SettingsForm.tsx` — **NO es dead code: feature futura intencional.** El bloque de logo (`handleLogoFileUpload`, `logoUploading`, `logoInputTab`…) es scaffolding deliberadamente deshabilitado; está marcado explícito en el código: `{/* Logo y Color primario — deshabilitados hasta implementación futura */}` (L471). Se deja tal cual.

### 1.5 ✅ RESUELTO (2026-05-29) — `console.*` de debug colados

> Verificado: los `console.log`/`console.warn` de debug (`auth/confirm/actions.ts`, `ProductPanel.tsx`) ya no están. Los `console.warn` legítimos de config faltante y los `console.error` en `catch` se conservan.


- `app/auth/confirm/actions.ts:13` — `console.log('[auth/confirm] verifyOtp error', ...)` (parece debug; además podría loguear info de auth).
- `components/pos/ProductPanel.tsx:258` — `console.warn('[VariantSelectorContent] option_value_id is null')` (debug).
- Los `console.warn` de `feedback/telegram.ts:49`, `feedback/github.ts:57` son legítimos (config faltante). Los 29 `console.error` están todos en `catch`/manejo de error — aceptables.

### 1.6 🟡 BAJA — duplicación puntual (parcialmente resuelto 2026-05-29)

- ✅ `getMarginPercent(multiplier)` **centralizado** en `lib/price-lists.ts`; `VariantPriceModal` ya no existe. `PriceListsPanel` lo importa.
- ✅ `DIGITAL_METHOD_LABELS` **eliminado** (ya no existe).
- ⬜ Duplicación de los 2 dropdowns responsive del header de `InventoryPanel` (~140 líneas) → extraíble a `<HeaderResponsiveDropdown>`. **Pendiente, cosmético** — ligado al refactor de archivos grandes (§2.3/§4), no se encara pre-beta.

### 1.7 🟡 BAJA — lint hotspot `react-hooks/refs`

`InventoryPanel.tsx` (16) y `POSView.tsx` (3) leen/mutan refs durante el render (ej. `ioButtonRef.getBoundingClientRect()` en estilos inline, L728/729/801/802; refs de POS mutados en render L69/70/78). No es bug hoy, pero es el único foco real de errores de lint sustantivos (el resto de los 33 errores es el patrón `mounted` ya documentado en CLAUDE.md).

---

## 2. Ambigüedades — decidir antes de tocar (NO son claramente "bugs")

### 2.1 `InventoryPanel` — doble fuente del filtro de estado ✅ RESUELTO (2026-05-29)

~~Hay **dos controles** para el mismo concepto: las pill-tabs (`statusFilter`) y el sidebar (`filterValue.stockStatus`), reconciliados con una regla de precedencia.~~

**Decisión:** mantener ambos controles con la visibilidad actual (pills en desktop ≥900px, sección "Estado" del sidebar en todos los viewports — las pills no entran en mobile y el sidebar es el único acceso ahí), pero **unificar el estado**. Se eliminó el `useState statusFilter` y la regla de precedencia; ahora **`filterValue.stockStatus` es la única fuente de verdad**: las pills y el sidebar leen/escriben ese mismo campo, así que no pueden desincronizarse. `effectiveStatusFilter` es solo la vista pill-key derivada de `stockStatus`. De paso se arregló la opción **"Solo en catálogo"** del sidebar, que estaba muerta (seteaba `stockStatus='catalog-only'` pero el panel filtraba por un `showInCatalogOnly` que nadie ponía en `true`); ahora `catalogOnly` también deriva de `stockStatus === 'catalog-only'`.

### 2.2 ❌ FALSO POSITIVO (verificado 2026-05-29) — `SessionDetailPanel` `['Efectivo','Tarjeta']` con `$0,00`

Los strings hardcodeados y los `$0,00` están **dentro del branch `loading ? (<Skeleton isLoading>…)`** (L219-257) — son placeholders del esqueleto de carga, no de la lógica. El render real con datos es el branch `detail ? (…)` (L258+), que usa `detail.payments_by_method` y montos reales. No hay nada que corregir.

### 2.3 `InventoryPanel.tsx` — tamaño (1402 líneas)

Creció desde las ~1291 que registra CLAUDE.md, pese a extracciones previas. El grueso restante: ~200 líneas de estado/handlers + ~730 de JSX (toolbar con los 2 dropdowns duplicados). **Refactor posible pero opcional** — no hay bug por tamaño. Si se encara, el orden de mayor ROI sería: (1) extraer el dropdown responsive (1.6), (2) memoizar las stats del footer (L229-240, hoy recalculadas cada render sobre *todos* los productos), (3) evaluar si los 5 handlers bulk justifican un helper común (**riesgo de abstracción prematura** — difieren en el parche de estado local; quizá no convenga).

---

## 3. Falsos positivos / no-issues (verificados y descartados — no re-flaggear)

- **41× `as unknown as {data}`** — wrapper obligatorio de RPCs de Supabase (regla 15). Correcto, no es "tipo laxo" a corregir. Solo hay **2** `as any` reales (`catalog/ProductCard.tsx:100`, con eslint-disable) y 1 cast de browser API (`NewOrderNotifier.tsx:14`) — aceptables.
- **Multiplicaciones `cost * multiplier`** en componentes de price-lists — son **previews de UI / derivación de márgenes de override**, no el precio efectivo de venta (que sigue por `calculateProductPrice`). `InventoryPanel:231` (`cost * stock`) es valor de inventario. No violan la regla 11.
- **`process.env.X!` (6×)** en clientes anon del catálogo y `createClient()` en el helper `acknowledgeOrdersSeen` (`UnreadBadge.tsx:14`, no render-path) — patrones aceptables; los `!` de env ya están en el backlog como deuda menor.
- **`set-state-in-effect` (13×)** — en su mayoría el patrón `mounted` documentado (sidebar, theme, CatalogThemeProvider, etc.). Ruido esperado de la regla de React Compiler.
- **Formateo de fecha disperso (~10 archivos)** con `toLocaleString('es-AR', {...})` de opciones similares — duplicación sistémica de **bajo riesgo**; `lib/date-utils.ts` no expone un formateador display, por eso cada componente lo reimplementa. Candidato a centralizar, pero no urgente. (La **moneda** sí está centralizada en `useFormatMoney`/`formatMoney` y se usa consistente.)
- **0** `: any` puros, `@ts-ignore`, `@ts-expect-error`, `TODO`/`FIXME`/`HACK` reales (los `XXX` son placeholders de teléfono). Sin bloques de código comentado.
- Reglas **1, 3, 6, 7, 8, 10** de CLAUDE.md: limpias (sin `middleware.ts`; precio centralizado; catálogo por RPCs; cookie firmada; post-switch correcto; permisos centralizados).

---

## 4. Inventario de archivos grandes (>500 líneas) — candidatos a refactor (opcional, post-beta)

| Líneas | Archivo |
|---|---|
| 1402 | `components/inventory/InventoryPanel.tsx` |
| 946 | `components/inventory/VariantEditor.tsx` |
| 860 | `components/inventory/ImportProductsModal.tsx` |
| 830 | `components/inventory/NewProductModal.tsx` |
| 808 | `components/inventory/EditProductModal.tsx` |
| 804 | `components/price-lists/PriceListsPanel.tsx` |
| 796 | `components/dashboard/SalesHistoryTable.tsx` |
| 787 | `components/stats/StatsView.tsx` |
| 761 | `components/pos/CartPanel.tsx` |
| 637 | `components/pos/POSView.tsx` |

Hay un **cluster de modales de inventario** (VariantEditor, Import, New, Edit) todos >800 líneas — si se prioriza refactor de inventario, conviene mirarlos juntos. Total `src/`: ~45.1k líneas.

---

## 5. Prioridad sugerida de fixes (a confirmar con el usuario — nada aplicado aún)

1. **1.1** QuickEdit por RPC — cierra gap de auditoría + permisos (seguridad).
2. **1.2** Verificar y, si aplica, arreglar el scroll infinito (`sort` → primitivos).
3. **1.3** `npm audit fix` para `protobufjs` (verificar que no toque otras versiones).
4. **1.4 / 1.5** Borrar dead code (`getDayLabel`, bloque de logo en SettingsForm, eslint-disable huérfano) + `console.log` de debug.
5. **1.6** Duplicación (`getMarginPercent`, labels de pago, dropdown responsive).
6. **2.x** Decidir ambigüedades (doble filtro de estado, placeholder de SessionDetailPanel) antes de tocarlas.
7. **4** Refactor de archivos grandes — post-beta, opcional.
