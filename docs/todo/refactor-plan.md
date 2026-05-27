# Plan de refactor pre-módulo contable

> **Estado:** auditoría hecha, P0 cerrado (commit `62eff2c`). Sigue P1.
> **Última actualización:** 2026-05-26 noche.
> **Premisa:** antes de agregar el módulo contable, auditoría + limpieza para no construir sobre código que ya cuesta mantener.

---

## Por qué ahora

- `InventoryPanel.tsx` ya está en 1385 líneas y `CartPanel.tsx` en 1303 — agregar el contable encima sin refactor es spawn de más sufrimiento.
- Hay deuda latente que conviene sacar antes (bugs sin descubrir, duplicación entre modales gemelos, patrones inconsistentes).
- Closed beta tiene 1 sola tienda activa — todavía hay margen para parar features sin perder usuarios.

---

## Orden recomendado

1. ~~Auditoría~~ ✅ hecha 2026-05-26
2. ~~Bug fixes críticos (P0)~~ ✅ hecho 2026-05-26 — commit `62eff2c`
3. **Simplificación + limpieza (P1)** ← acá vamos
4. Módulo contable (la feature original)
5. Fluidez + animaciones como polish post-feature, no antes

---

## Auditoría — resultados

4 agentes Explore en paralelo (2026-05-26 mediodía). ~70 hallazgos brutos consolidados en 4 prioridades: P0 / P1 / P2 / P3.

### Cobertura de cada agente

| Agente | Foco | Hallazgos brutos |
|--------|------|------------------|
| Bugs latentes | try/catch silenciosos, race conditions, RPCs sin chequeo de `success`, null checks | 25 |
| Arquitectura | duplicación, sub-componentes embebidos, state disperso | 19 |
| UX inconsistente | toast vs flash, validación, loading/error, pill vs chip, `<select>` | 20 |
| Seguridad y RLS | defense-in-depth, RPCs auditadas, cookies, permisos del operator | 10 |

### Falsos positivos detectados durante verificación

Antes de tocar código verifiqué los hallazgos P0 contra los archivos reales. **3 de los 6 P0 reportados NO eran bugs reales**:

- **`create_sale_transaction` "sin chequeo robusto de success"** (PaymentModal.tsx:174) — falso. El código YA chequea `if (rpcError || !result?.success)`. El RPC siempre retorna jsonb. El carrito se limpia recién en el happy path. El agente leyó mal.
- **Bulk ops sin rollback granular** (InventoryPanel.tsx:508-539) — falso. Los handlers llaman a un único RPC server-side (`bulk_delete_products`, `bulk_set_product_status`, `bulk_update_product_category`) que es atómico. El Promise.all que reportó el agente es el refresh read-only post-import, no afecta persistencia.
- **Mitad del agrupado de "RPCs sin chequeo de success"** — falso para `SettingsForm`, `NewOperatorModal`, `EditExpensePanel`, `SuppliersPanel`, `EditCustomerModal` (todos chequean `!result?.success`). También falso para `update_business_slug` y `settle_customer_credit`, que usan `RAISE EXCEPTION` en vez de `{success:false}` — ahí chequear solo `error` es lo correcto.

**Otros falsos positivos del reporte general:**
- Stock negativo "permitido sin validación" → decisión explícita del producto (memoria).
- CSRF en `/api/operator/logout` → SameSite=lax cubre el blast radius (la cookie solo borra cookies propias).
- Cookie `secure: false` en dev → comportamiento esperado.

**Lección:** los agentes son útiles para barrer pero no se les puede confiar el veredicto. Siempre verificar archivo + RPC signature antes de actuar.

---

## P0 — Bugs reales arreglados (commit `62eff2c`)

### A — Silent fail en `update_operator`

- `EditOperatorModal.tsx:222-235` y `OperatorMeView.tsx:274-289` solo chequeaban `updateError`, pero el RPC `update_operator` retorna `{success:false, error:'403:...'}` en fallos de permiso (no levanta excepción).
- Resultado anterior: un operador sin `operators_write` editando a otro veía "guardado" sin que pasara nada.
- **Fix:** leer `data` y chequear `!result?.success`.

### B — `unit_price_override` sin validación server-side

- `create_sale_transaction` aceptaba `unit_price_override` blindly. El cliente bloqueaba (CartPanel) pero el servidor no re-validaba.
- **Fix:** en la migración, antes de cualquier insert, si algún item trae `unit_price_override` no-null verificar `operators.permissions->>'price_override' = 'true'` (owner pasa siempre). Si no, retorna `403: Permiso de override de precio requerido`.

### C — Atomicidad sale + customer.credit_balance

- Antes: `create_sale_transaction` insertaba sale + payments (incluyendo row de credit), después el cliente llamaba `apply_customer_credit` por separado para bumpear `customer.credit_balance`. Si la segunda llamada fallaba (red, timeout), venta quedaba registrada con credit payment pero el balance del cliente sin actualizar → cliente debía sin que el sistema supiera.
- **Fix:** mover el UPDATE de `credit_balance` dentro de `create_sale_transaction` con `SELECT ... FOR UPDATE` para serializar contra ventas concurrentes. Validar `is_credit_enabled` + crédito disponible ANTES de cualquier insert (rechazo limpio sin partial state).
- **Cleanup:** `apply_customer_credit` dropeada de la DB. Único caller era PaymentModal, ya removido.

### Migración

`supabase/migrations/20260527_01_atomic_credit_and_price_override_guard.sql`

- Aplicada en remoto (`zrnthcznbrplzpmxmkwk`) vía MCP. Verificado: una sola overload de `create_sale_transaction` (11 args con `p_session_id`).
- También limpió un overload viejo de 10-args que estaba muerto.

### Edge cases verificados

| Riesgo | Mitigación en el código |
|--------|------------------------|
| Crédito aparece sin cliente habilitado | `IF NOT v_customer.is_credit_enabled → error` antes de insertar |
| No aparece el crédito que sí debería | `UPDATE customer.credit_balance` en misma transacción que sale + payments |
| Balance no se actualiza correctamente | Suma todos los `method='credit'` en un solo pass, bumpea por el total |
| Dos ventas concurrentes contra el mismo cliente sobrepasan el límite | `SELECT ... FOR UPDATE` serializa el chequeo + update |
| Pago a crédito sin cliente (credit anónimo) | `IF p_customer_id IS NULL → error 'Pago con crédito requiere cliente'` |
| Cliente de otro negocio inyectado | `WHERE business_id = v_caller_business_id` |
| Owner con price override | `v_actor_role = 'owner'` bypassea el guard |

---

## P1 — Refactor que destraba el módulo contable (PENDIENTE)

Lo que hará el contable doblemente costoso si no se toca primero.

### 1. Duplicación NewProductModal vs EditProductModal (~2200 líneas, 60-65% solapamiento)

- Combobox, validación, upload de imagen, lógica de margen, todo duplicado.
- Agregar un campo "cuenta contable" obliga a tocar ambos. Riesgo de desincronización alto.
- **Acción:** extraer `useProductForm()` + `<ImageUploadField>` + `<Combobox>` hook/componente. Reduce a un solo lugar de cambio.
- **Archivos:** `components/inventory/NewProductModal.tsx`, `components/inventory/EditProductModal.tsx`, posibles candidatos a `lib/hooks/` y `components/inventory/shared/`.

### 2. No hay capa `lib/api/*` — RPCs/queries dispersas

- `update_sale` / `delete_sale` / `get_sale_detail` están en `CartPanel.tsx` **y** `SalesHistoryTable.tsx`. Mismo RPC, dos llamadas distintas. Auditar/loguear cambios desde el contable requerirá tocar N archivos.
- Similar para products, customers, expenses.
- **Acción:** crear `lib/api/{products,sales,expenses,customers}.ts` con wrappers únicos. Cada wrapper encapsula RPC + `unwrapRpc<T>` + error translation.
- Bonus: en el wrapper sale el patrón `unwrapRpc(result, error)` que el agente confundía con bug. Helper único, comportamiento consistente.

### 3. `EditSalePanel` embebido en `CartPanel` (1303 líneas)

- CartPanel mezcla venta + edición + historial. Sub-componente `EditSalePanel` sí existe en archivo propio pero solo se usa desde acá.
- **Acción:** extraer `<SalesHistoryPanel>` como componente top-level con su propio estado y handlers. Aliviar CartPanel antes de agregar "asiento contable".

### 4. Tipos `Product` dispersos

- `Product` (lib/types), `InventoryProduct` (components/inventory/types), `ProductWithCategory` (components/pos/types), `CatalogProduct` (components/catalog/types). Conversiones manuales en cada componente.
- Agregar `referencia_contable` rompe 5 lugares.
- **Acción:** consolidar a `Product` en `lib/types` con campos opcionales bien documentados, o crear mappers centralizados en `lib/mappers.ts`.

### 5. Lógica de precio duplicada fuera de `calculateProductPrice`

- La función pura está bien (`lib/price-lists.ts`), pero `CartPanel` / `ProductPanel` / `VariantPriceModal` tienen condicionales inline para decidir override vs lista vs variante.
- **Acción:** crear `resolvePriceForCart()` / `resolvePriceForDisplay()` que envuelvan la regla completa. Una sola fuente para el módulo contable.

---

## P2 — Estandarizaciones del sistema (paralelizable con P1)

Decisiones de patrón que conviene cerrar antes de generar más superficie inconsistente.

| # | Decisión | Archivos clave |
|---|----------|----------------|
| 1 | Toast imperativo vs FlashToast — elegir uno y migrar | `Toast.tsx`, `FlashToast.tsx` |
| 2 | `backdrop-blur-sm` en `dialog.tsx:42` viola CLAUDE.md regla #27 — quitar del overlay base, eliminar overlays custom | `ui/dialog.tsx`, `OpenSessionModal`, `CloseSessionModal`, `QuickEdit*Modal`, `SessionDetailPanel` |
| 3 | `<form onSubmit>` vs `onClick` mezclado — estandarizar a onClick global per regla #28 | `NewOperatorModal`, `EditOperatorModal` (form); customer modals (onClick) |
| 4 | Delete confirmation: `ConfirmModal` vs `AlertDialog` vs `window.confirm` — elegir uno | varios |
| 5 | Validación onChange/onBlur/onSubmit mezclada en mismos formularios — política única | New/Edit modals en general |
| 6 | Loading text: "Creando..." / "Guardando..." / "Procesando..." — tabla canónica | varios botones primarios |
| 7 | DialogHeader/DialogFooter vs construcción manual — uno solo | New/Edit modals en general |

**Acción:** documento corto de "patrones canónicos del sistema" en `docs/conventions.md` + un PR de migración por patrón.

---

## P3 — Diferible o de bajo ROI

- `.eq('business_id', ...)` defense-in-depth en query de `product_variants` (`pos/page.tsx:74`) — 30s de fix, sin urgencia porque RLS cubre.
- Race conditions en customer search / variant load (`CartPanel.tsx:341`, `EditProductModal.tsx:133`) — agregar AbortController.
- Comparación de permisos con strings literales en `proxy.ts` — usar constantes.
- `hooks/` casi vacío — extraer `useCombobox`, `useAsyncFetch`, `useImageUpload` cuando aparezca tercer call site.
- `.toFixed(2)` esparcido — preferir helper `formatPrice()` cuando se toque el código.
- `FloatingDropdown` vs `SelectDropdown` coexisten — consolidar cuando se toque inventory.
- **Bug real diferido del P0:** escrituras directas a `price_list_overrides` y `suppliers` desde el cliente (`ProductOverrideModal.tsx`, `EditProductModal.tsx:329-368`, `SupplierSelectDropdown.tsx:61`). Sin audit log, sin re-validación de permiso server-side. Blast radius bajo (no escalación, solo audit gap). **Se cierra naturalmente con P1 #2 (capa `lib/api/*`)** — al envolver en RPCs auditadas el problema desaparece.

---

## Estrategia para P1 — propuesta para esta noche

Orden recomendado:

1. **Empezar por P1 #2 (capa `lib/api/*`)**. Es la base. Crear `lib/api/products.ts` y `lib/api/sales.ts` con wrappers para los RPCs más usados + helper `unwrapRpc<T>`. Migrar los call sites gradualmente.
2. **Después P1 #1 (NewProduct / EditProduct)** — apoyarse en la nueva capa.
3. **P1 #3 (extraer SalesHistoryPanel de CartPanel)** — independiente, se puede hacer en paralelo.
4. P1 #4 y P1 #5 caen como consecuencia natural mientras se tocan los call sites.

P2 se puede ir cerrando entre medio en commits separados.

---

## Archivos grandes — inventario verificado (2026-05-26)

Sin cambios desde la mañana. Re-verificar después de P1.

| Archivo | Líneas | Notas |
|---------|--------|-------|
| `components/inventory/InventoryPanel.tsx` | 1385 | Refactor prioritario |
| `components/pos/CartPanel.tsx` | 1303 | Contiene `EditSalePanel` embebido |
| `components/inventory/EditProductModal.tsx` | 1097 | Casi gemelo de NewProductModal |
| `components/inventory/NewProductModal.tsx` | 1090 | Idem |
| `components/inventory/VariantEditor.tsx` | 946 | Embebido en ambos modales |
| `components/inventory/ImportProductsModal.tsx` | 860 | Tiene deuda del icon_color directo |
| `components/dashboard/SalesHistoryTable.tsx` | 830 | Podría extraer hooks |
| `components/price-lists/PriceListsPanel.tsx` | 804 | Sub-componentes embebidos probables |
| `components/onboarding/OnboardingWizard.tsx` | 683 | Wizard multi-paso |
| `components/pos/POSView.tsx` | 637 | — |
| `components/shared/ProductFilter/index.tsx` | 620 | — |
| `components/stats/StatsView.tsx` | 618 | — |
| `components/settings/SettingsForm.tsx` | 615 | — |
| `components/dashboard/DashboardView.tsx` | 573 | — |
| `components/operator/OperatorMeView.tsx` | 555 | — |
| `components/pos/ProductPanel.tsx` | 554 | — |
| `components/pos/PaymentModal.tsx` | 547 | Tocado en P0 |
| `components/activity/detail/product.tsx` | 543 | — |
| `components/inventory/CategoryModal.tsx` | 485 | — |

---

## Out of scope explícito

- **Animaciones** — al final de todo, post-contable.
- **Reorganización de carpetas** — no tocar la estructura `app/`, `components/`, `lib/` salvo que un agente lo marque como bloqueante.
- **Cambios de stack o librerías** — quedarse con lo que hay.
- **Reescrituras desde cero** — refactor incremental, no rewrite.
- **Deuda no-bloqueante de la tabla de "Deuda técnica" del backlog** — puede esperar.

---

## Próximo paso al retomar

1. Decidir si pusheo `62eff2c` a `origin/master` (gatilla deploy Vercel) o seguir local hasta cerrar P1.
2. Arrancar con P1 #2 (capa `lib/api/*`) — empezar por `lib/api/sales.ts` con el helper `unwrapRpc<T>` y migrar 1-2 call sites para validar el patrón antes de extenderlo.
