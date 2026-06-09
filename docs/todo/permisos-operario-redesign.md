# Rediseño de permisos de operario — 11 flags → 8 agrupados en 4 áreas

> **Estado:** ✅ **COMPLETO y commiteado (2026-06-09).** F0-F4 aplicadas al remoto. El modelo de 8 capacidades vive en `lib/operator.ts` (TS) + `normalize_permissions` (SQL); las 24 guardas leen vía el helper; modal con 8 toggles agrupados (`components/settings/operatorPermissions.tsx`). F4 = `parsePermissions` estricto (rechaza cookies de shape viejo → re-login una vez). Detalle de cada fase en §5-7.
>
> **Motivación:** los 11 flags planos actuales son demasiados, algunos confusos y mal etiquetados. Objetivo: un modelo más claro, agrupado por área de la app, con nombres en lenguaje llano. No es bug ni seguridad — es UX/claridad.
>
> **⚠️ Lo que el diseño original omitía:** los flags **no son solo de UI**. ~24 guardas `SECURITY DEFINER` en ~22 RPCs (`schema.sql`) leen los permisos por nombre para hacer cumplir el modelo de seguridad (reglas 32/34). Renombrar/mergear una key sin actualizar su guarda produce un **fail-open silencioso**: `(jsonb->>'key_vieja')` sobre un JSONB con la key nueva devuelve `NULL`, y `NULL <> 'true'` es falsy → la rama de denegar no corre → el operario **pasa sin permiso**. Por eso el plan se hace **en fases con el backend tolerante primero** (ver §5).

---

## 0. Regla de producto que NO se toca

**`/pos` NO está gateado por ningún permiso y así debe seguir.** Es la feature principal: dueño, encargado, cajero y custom **siempre** pueden realizar ventas. No hay ningún motivo para limitar eso. Este rediseño **no** agrega un gate al POS.

Consecuencia: el permiso `sales` ("Ventas") de hoy en realidad **solo gatea `/orders` (pedidos online)** y es el padre UI de `price_override` en los modales — nunca controló el POS. Por eso se renombra a **"Pedidos online"**: es claridad de etiqueta, no una corrección de comportamiento.

---

## 1. Modelo actual (11 flags planos)

`Permissions` en `src/lib/operator.ts`. Qué gatea cada uno realmente (trazado en código):

| Flag | Label hoy | Qué gatea de verdad |
|------|-----------|---------------------|
| `sales` | Ventas | Solo `/orders` (pedidos online) + padre UI de override. **No** controla POS |
| `price_override` | Override de precio | POS: editar precio de línea + descuento de carrito (`CartPanel`) |
| `free_line` | Producto Libre | POS: agregar línea libre (además depende del toggle de negocio `free_line_enabled`) |
| `stock` | Ver inventario | `/inventory` (lectura) |
| `stock_write` | Editar inventario | Editar productos/stock/costos (inventory, gastos mercadería, dashboard low-stock) |
| `analysis` | Análisis | `/dashboard`, `/stats`, `/activity`, `/cash-sessions` + sugerencias IA P12 |
| `price_lists` | Ver listas | `/price-lists` (lectura) |
| `price_lists_write` | Editar listas | Editar listas de precios |
| `expenses` | Gastos | `/expenses` |
| `settings` | Configuración | `/settings` |
| `operators_write` | Operarios | Gestionar operarios (sub de settings) |

Los modales ya tienen jerarquía padre→hijo implícita (sales→override, stock→stock_write, price_lists→write, settings→operators_write) pero plana en el data model.

---

## 2. Modelo nuevo (8 toggles en 4 áreas)

| Área | Permiso nuevo (key) | Label | Reemplaza a |
|------|---------------------|-------|-------------|
| 🛒 Mostrador | `pos_pricing` | Ajustar precios en la venta | merge `price_override` + `free_line` |
| 🛒 Mostrador | `online_orders` | Pedidos online | `sales` (renombrado) |
| 📦 Inventario | `inventory_read` | Ver inventario | merge `stock` + `price_lists` |
| 📦 Inventario | `inventory_write` | Editar inventario | merge `stock_write` + `price_lists_write` |
| 📊 Reportes | `reports` | Ver reportes y estadísticas | `analysis` (renombrado) |
| 📊 Reportes | `expenses` | Registrar gastos | `expenses` (sin cambio de key) |
| ⚙️ Administración | `settings` | Configuración | `settings` (sin cambio de key) |
| ⚙️ Administración | `manage_operators` | Gestionar operarios | `operators_write` (renombrado) |

**Decisiones acordadas:**
- **Listas de precios se pliegan dentro de Inventario** (decisión del usuario 2026-06-04): quien ve/edita productos ya ve costos y precios, así que un par ver/editar separado para listas es overkill para una PyME. `/price-lists` pasa a gatearse por `inventory_read` (lectura) e `inventory_write` (edición).
- **override + línea libre → un solo toggle** `pos_pricing` ("flexibilidad de precio en el mostrador").
- `expenses` y `settings` conservan su key para minimizar churn.

---

## 3. Migración de datos (operarios existentes)

`operators.permissions` (JSONB) y cualquier cookie viva. Mapeo old→new con **OR** en los merges (preservar capacidad, nunca quitar acceso):

```
online_orders    = old.sales
pos_pricing       = old.price_override OR old.free_line
inventory_read    = old.stock          OR old.price_lists
inventory_write   = old.stock_write    OR old.price_lists_write
reports           = old.analysis
expenses          = old.expenses
settings          = old.settings
manage_operators  = old.operators_write
```

- Efecto colateral aceptado: un operario que tenía solo `price_lists` (ver listas) sin `stock` ahora obtiene `inventory_read` (ve inventario). Marginal y a favor del usuario.
- Migración one-shot sobre `operators.permissions` en SQL (recorrer filas, reescribir el JSONB al shape nuevo).

---

## 4. UI de los modales (New/EditOperatorModal)

**Los presets de rol YA funcionan hoy** y no hay que rehacerlos: elegir Cajero/Encargado setea los toggles desde los role-default JSONBs del backend; si los toggles no coinciden con ningún preset, el modal cambia solo a "Personalizado".

**Único cambio nuevo de UI:** arrancar con los toggles **colapsados** detrás de un botón **"Ver permisos individuales ⌄"**. Al expandir, mostrarlos agrupados en las 4 áreas (Mostrador / Inventario / Reportes / Administración) en vez de la lista plana actual. La lógica preset↔custom existente se mantiene intacta.

---

## 5. Plan de implementación faseado

> **Principio de seguridad que ordena las fases:** nunca dejar que una guarda pierda la capacidad de leer un permiso válido. El backend se vuelve *tolerante* (lee key nueva con fallback a la vieja vía `COALESCE`) **antes** de migrar cualquier dato; la limpieza de las keys viejas es lo **último**. Así cada fase es un no-op de comportamiento verificable por separado y el sistema siempre falla cerrado.
>
> **Estrategia de entrega:** una rama con las 4 fases como **commits separados**, mergeados juntos, testeando localmente entre cada commit. Sin usuarios reales (solo Cecilia), no hace falta desplegar entre fases.

### Mapa de guardas SQL (la base — el diseño original lo omitía)

Lecturas `permissions->>'flag'` dentro de RPCs `SECURITY DEFINER`, trazadas en `schema.sql`:

| Key vieja | Destino | Guardas | RPCs |
|-----------|---------|:-------:|------|
| `stock_write` | `inventory_write` (merge) | **16** | `bulk_delete_products`, `bulk_set_product_status`, `bulk_set_product_catalog`, `bulk_update_product_brand`, `bulk_update_product_category`, `create_brand_guarded`, `create_category_guarded`, `create_product`, `create_product_with_variants`, `delete_brand`, `delete_category`, `delete_product`, `update_brand`, `update_category`, `update_product`, `update_product_variants` |
| `price_lists_write` | `inventory_write` (merge) | **3** | `create_price_list`, `delete_price_list`, `update_price_list` |
| `operators_write` | `manage_operators` | **3** | `create_operator`, `delete_operator`, `update_operator` |
| `price_override` | `pos_pricing` | **1** | `create_sale_transaction` (solo si un ítem trae `unit_price_override`) |
| `sales` | `online_orders` | **1** | `update_catalog_order_status` |
| `expenses` | **sin cambio** ✅ | 3 | `create_supplier`, `deactivate_supplier`, `update_supplier` — **no se tocan** |
| `settings` | **sin cambio** ✅ | 2 | `update_business_settings`, `update_business_slug` — **no se tocan** |

Total a reescribir: **24 guardas**. `expenses` y `settings` conservan key → sus 5 guardas no se tocan.

---

### Fase 0 — Matriz de test (oráculo, sin código)

La tabla de §7 (abajo): por rol × RPC guardada, el resultado allow/deny esperado **hoy**. Es contra lo que se compara cada fase para afirmar "no cambió nada". Ya construida (ver §7).

### Fase 1 — Backend tolerante (✅ APLICADA 2026-06-09)

En vez de un `COALESCE` inline repetido 24 veces, se centralizó en un **helper** `normalize_permissions(jsonb)` que computa las 8 keys canónicas desde cualquier shape (viejo/nuevo/mixto), con merge correcto, idempotente y fail-closed. Cada guarda pasa a leer `normalize_permissions(permissions)->>'<canónica>'`. Validado por truth table + equivalencia sobre datos reales antes de aplicar.
- [x] Migración `20260609_01_normalize_permissions_helper.sql` — helper puro IMMUTABLE.
- [x] Migración `20260609_02_permisos_fase1_guardas_normalizadas.sql` — re-crea las 24 RPC (DO block: `pg_get_functiondef` + `replace()` ancladas en `, role`, con auto-verificación que aborta si queda guarda vieja). **NO** toca el back-fill de defaults de `create_operator` (eso es Fase 2).
- [x] `schema.sql` en sync (5 `replace_all` + helper agregado).
- ✅ **Verificado en vivo:** 24 guardas transformadas, 0 viejas; operario dev "prueba" mantiene veredictos idénticos (`online_orders:true, inventory_read:true`, resto false). Cecilia (owner, 0 operarios) sin impacto.
- ⏳ **Pendiente de la matriz §7 vía UI:** el allow/deny por rol a través de auth real (no corrible desde MCP). Se cubre en el walkthrough de Fase 3.

### Fase 2 — Backend: datos + defaults

- [ ] Migración one-shot que reescribe `operators.permissions` (JSONB) al shape de 8 keys con los OR de §3. **Snapshot previo** de la columna (rollback trivial).
- [ ] Nuevo default de la columna `operators.permissions` → shape de 8 keys.
- [ ] `create_operator` / `update_operator` — role-default JSONBs (manager/cashier/else) al shape nuevo (ver §3 para el mapeo de los presets actuales).
- [ ] `schema.sql` en sync.
- ✅ **Test:** matriz §7 de nuevo (las guardas de Fase 1 ahora pegan en la key nueva; el fallback queda por si alguna fila/cookie no migró). Allow/deny idéntico.

### Fase 2 (frontend tolerante) — ✅ CÓDIGO COMPLETO 2026-06-09 (pendiente test UI en dev)

> **Reordenada antes de la migración de datos:** `parsePermissions` (TS) exigía los campos de 11 keys; migrar el shape almacenado primero rompería el login de operario (`verify_operator_pin` → shape de 8 → "PIN incorrecto"). Por eso el frontend se vuelve shape-agnóstico ANTES de tocar datos.

- [x] `lib/operator.ts` → tipo `Permissions` a 8 keys; `normalizePermissions`/`parsePermissions` bi-shape (espejo TS de la SQL `normalize_permissions`; las cookies vivas de 11 keys se actualizan al leerlas, sin re-login); `DEFAULT_PERMISSIONS`, `OWNER_PERMISSIONS`, `OPERATOR_MANAGEMENT_PERMISSION_KEYS`, `PERMISSION_LABELS`.
- [x] `proxy.ts` gates: `analysis→reports`, `stock→inventory_read`, `price_lists→inventory_read` (plegado), `sales→online_orders`. `/pos` sin gate (regla §0).
- [x] `sidebar.tsx` nav + `canSeeOrders` + `canSeeAmount`.
- [x] Páginas: activity, cash-sessions, dashboard, expenses, inventory, price-lists, settings, stats/inventory-health, stats/report.
- [x] `CartPanel.tsx` (`price_override`/`free_line`→`pos_pricing`), `POSView.tsx` (`stock`→`inventory_read`).
- [x] `useInsights.ts` — lee `op_perms.reports` (era `analysis`; TS no lo atrapaba, ref runtime).
- [x] Modales: módulo compartido `operatorPermissions.tsx` (presets 8-key + `applyPermissionToggle` con dependencias lógicas write⟹read / manage_operators⟹settings + `PermissionsFields` colapsable agrupado en 4 áreas); New/EditOperatorModal reescritos contra él.
- ✅ **Verificado:** `tsc --noEmit` 0 errores, lint sin issues nuevos, `npm run build` OK.
- ⏳ **Pendiente (test del usuario en dev):** crear/editar operario con el modal nuevo; login como operario y validar gating por área (matriz §7). El allow/deny vía auth no es testeable fuera del browser.

> **Nota:** durante F2 (antes de F3) los operarios creados/editados se guardan en shape mixto (8 keys + back-fill viejo); es inofensivo porque las guardas SQL y el TS normalizan cualquier shape. F3 lo deja canónico.

### Fase 3 — Datos + defaults (✅ APLICADA 2026-06-09)

- [x] Migración `20260609_03_permisos_fase3_datos_defaults.sql`: `create_operator`/`update_operator` con role-defaults de 8 keys + `normalize_permissions(...)` al escribir (sin el back-fill viejo que F1 dejó intacto); default de columna a 8 keys; one-shot `UPDATE operators SET permissions = normalize_permissions(permissions)`.
- [x] `schema.sql` en sync.
- ✅ **Verificado en vivo:** operario dev en 8 keys limpio (`pos_pricing:true` preservado de la edición en F2); default de columna 8 keys; create_operator sin keys viejas y normaliza; update_operator normaliza el merge.

### (referencia) Fase 3 vieja — Frontend completo (OBSOLETO: absorbido en F2 arriba)

**Data model — `src/lib/operator.ts`**
- [ ] `Permissions` interface → 8 keys; `DEFAULT_PERMISSIONS`, `OWNER_PERMISSIONS`, `OPERATOR_MANAGEMENT_PERMISSION_KEYS`, `PERMISSION_LABELS`.
- [ ] `parsePermissions` — aceptar shape nuevo **y mapear shape viejo** (compat de cookies `operator_session` vivas durante la transición; nadie se desloguea).
- [ ] `normalizePermissions`, `toOperatorManagementPermissions`.

**Gates de ruta — `src/proxy.ts`**
- [ ] `/orders` → `online_orders` · `/inventory` → `inventory_read` · `/price-lists` → `inventory_read` (plegado) · `/dashboard` `/stats` `/activity` → `reports` · `/expenses` → `expenses` · `/settings` → `settings`.
- [ ] **NO** agregar gate a `/pos` (regla §0).

**Sidebar — `src/components/sidebar.tsx`**
- [ ] `check` de cada item a la key nueva; `/price-lists` nav → `inventory_read`.

**Páginas (checks server-side)**
- [ ] `inventory/page.tsx` — `readOnly` ← `!inventory_write`.
- [ ] `price-lists/page.tsx` — `readOnly` ← `!inventory_write`.
- [ ] `expenses/page.tsx` — `canUpdateStock` ← `inventory_write`.
- [ ] `dashboard/page.tsx` — `stockWriteAllowed` ← `inventory_write`.
- [ ] `cash-sessions/page.tsx`, `activity/page.tsx`, `stats/inventory-health/page.tsx`, `stats/report/page.tsx` — `analysis` → `reports`.
- [ ] `settings/page.tsx` — `canManageOperators` ← `manage_operators`.

**POS — `src/components/pos/CartPanel.tsx`**
- [ ] `price_override` → `pos_pricing`; `free_line` → `pos_pricing` (sigue dependiendo del toggle de negocio `free_line_enabled`).

**Insights P12 — `src/components/insights/useInsights.ts`**
- [ ] `useHasInsightsPermission` — `analysis` → `reports`.

**Cookie — `api/operator/switch/route.ts`**
- [ ] Escribe `op_perms` con las keys nuevas.

**Modales — `New/EditOperatorModal.tsx`**
- [ ] Toggles al shape nuevo, agrupados en 4 áreas; botón "Ver permisos individuales ⌄" colapsable; mantener lógica preset↔custom.

- ✅ **Test:** recorrido UI completo por rol — accesos de ruta, sidebar, POS pricing, modales de operario. `npm run build` (corre `tsc`) + `npm run lint`.

### Fase 4 — Limpieza (✅ APLICADA 2026-06-09)

- [x] `normalize_permissions` (SQL, mig `20260609_04`) y `normalizePermissions` (TS) simplificadas a leer **solo las 8 keys canónicas** (clave faltante → false, fail-closed). El helper SQL y las 24 guardas que lo invocan NO cambian (la indirección por helper es buena arquitectura, se queda).
- [x] `parsePermissions` (TS) ahora **rechaza el shape viejo** (cookie de 11 flags → `null` → el proxy la limpia y fuerza re-selección de operador). Cutover limpio, sin degradación silenciosa.
- [x] `schema.sql` en sync.
- ✅ **Verificado:** tsc/build OK; `normalize_permissions` sobre el operario canónico da 8-key correcto; un shape viejo da todo-false (fail-closed).

> **Efecto de borde aceptado:** las sesiones (`operator_session`/`op_perms`) firmadas ANTES del cutover son de shape viejo → en la próxima request `parsePermissions` las rechaza → re-login una vez (re-selección de operador / el dueño reingresa su contraseña). Es el comportamiento seguro buscado. Sin usuarios reales con operarios, el impacto es nulo salvo un re-login del propio dueño.

**Docs (con Fase 3)**
- [ ] CLAUDE.md regla 16 — lista de keys/lugares.
- [ ] `docs/conventions.md` — tabla de permisos / route map.
- [ ] `docs/db.md` — default de columna + RPC signatures si cambian.

---

## 6. Fuera de scope

- Gatear `/pos` (prohibido por §0).
- Rehacer el sistema de presets de rol (ya funciona).
- Permisos nuevos más allá de los 8 (no se agregan capacidades, solo se reorganizan).
- Per-variante / per-categoría — no aplica.

---

## 7. Fase 0 — Matriz de test (oráculo allow/deny)

Resultado esperado de las guardas server-side **hoy** (y que debe mantenerse idéntico tras Fases 1 y 2). El **owner siempre pasa** (toda guarda corta por `v_actor_role = 'owner'` antes de mirar el permiso). Los presets son los de `create_operator` (`schema.sql:1151-1158`):

- **manager:** `sales✓ stock✓ stock_write✓ analysis✓ price_lists✓ price_lists_write✓ settings✗ operators_write✗ expenses✗` (`price_override`/`free_line` soft-default ✗)
- **cashier:** `sales✓ stock✓` · resto ✗
- **custom (default else):** `sales✓` · resto ✗ — *Custom real depende de los toggles que elija el dueño; esta fila es solo el default de creación*

| Grupo de RPC (guarda) | Key hoy → nueva | owner | manager | cashier | custom-default |
|-----------------------|-----------------|:-----:|:-------:|:-------:|:--------------:|
| Inventario escritura — 16 RPCs (`create/update/delete_product`, `*_with_variants`, `*_variants`, `bulk_*`×5, `create/delete brand+category`, `update_brand/category`) | `stock_write` → `inventory_write` | ✅ | ✅ | ❌ | ❌ |
| Listas de precios escritura — `create/update/delete_price_list` | `price_lists_write` → `inventory_write` | ✅ | ✅ | ❌ | ❌ |
| Gestión de operarios — `create/update/delete_operator` | `operators_write` → `manage_operators` | ✅ | ❌ | ❌ | ❌ |
| Venta con override de precio — `create_sale_transaction` (solo ítem con `unit_price_override`) | `price_override` → `pos_pricing` | ✅ | ❌ | ❌ | ❌ |
| Estado de pedido catálogo — `update_catalog_order_status` | `sales` → `online_orders` | ✅ | ✅ | ✅ | ✅ |
| Proveedores — `create/deactivate/update_supplier` | `expenses` (sin cambio) | ✅ | ❌ | ❌ | ❌ |
| Configuración — `update_business_settings`, `update_business_slug` | `settings` (sin cambio) | ✅ | ❌ | ❌ | ❌ |

**Notas:**
- *Venta normal (sin override)* la hace **cualquier rol** — el gate `pos_pricing` solo aplica a la línea con `unit_price_override` (regla §0: el POS nunca se bloquea).
- *Estado de pedido* da ✅ para todos porque `sales` está en `true` en los tres presets → tras la migración `online_orders` también queda en `true` para todos. Coherente: ese permiso solo distingue quién ve `/orders`, no bloquea la conversión.
- Esta matriz se valida ejecutando cada RPC con la sesión de un operario de cada rol (o inspeccionando el `RETURN ... 'success', false` de la guarda). Es el criterio de aceptación de Fases 1 y 2.
