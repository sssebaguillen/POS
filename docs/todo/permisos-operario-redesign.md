# Rediseño de permisos de operario — 11 flags → 8 agrupados en 4 áreas

> **Estado:** 📐 diseño acordado 2026-06-04 — **NO implementado**. Retomar como tarea dedicada.
>
> **Motivación:** los 11 flags planos actuales son demasiados, algunos confusos y mal etiquetados. Objetivo: un modelo más claro, agrupado por área de la app, con nombres en lenguaje llano. No es bug ni seguridad — es UX/claridad.

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

## 5. Checklist de implementación (regla 16 de CLAUDE.md + extras)

Todo en el mismo PR:

**Data model — `src/lib/operator.ts`**
- [ ] `Permissions` interface → 8 keys nuevas
- [ ] `DEFAULT_PERMISSIONS`, `OWNER_PERMISSIONS`
- [ ] `OPERATOR_MANAGEMENT_PERMISSION_KEYS`
- [ ] `PERMISSION_LABELS` (labels nuevos)
- [ ] `parsePermissions` — aceptar shape nuevo **y mapear shape viejo** (compat de cookies `operator_session` vivas durante la transición, así los operarios activos no quedan deslogueados)
- [ ] `normalizePermissions`, `toOperatorManagementPermissions`

**Gates de ruta — `src/proxy.ts`**
- [ ] `/orders` → `online_orders`
- [ ] `/inventory` → `inventory_read`
- [ ] `/price-lists` → `inventory_read` (plegado)
- [ ] `/dashboard` `/stats` `/activity` → `reports`
- [ ] `/expenses` → `expenses`
- [ ] `/settings` → `settings`
- [ ] **NO** agregar gate a `/pos` (regla §0)

**Sidebar — `src/components/sidebar.tsx`**
- [ ] `check` de cada item al permiso nuevo correspondiente
- [ ] `/price-lists` nav → `inventory_read`

**Páginas (checks server-side)**
- [ ] `inventory/page.tsx` — `readOnly` ← `!inventory_write`
- [ ] `price-lists/page.tsx` — `readOnly` ← `!inventory_write`
- [ ] `expenses/page.tsx` — `canUpdateStock` ← `inventory_write`
- [ ] `dashboard/page.tsx` — `stockWriteAllowed` ← `inventory_write`
- [ ] `cash-sessions/page.tsx`, `activity/page.tsx`, `stats/inventory-health/page.tsx`, `stats/report/page.tsx` — `analysis` → `reports`
- [ ] `settings/page.tsx` — `canManageOperators` ← `manage_operators`

**POS — `src/components/pos/CartPanel.tsx`**
- [ ] `price_override` → `pos_pricing`
- [ ] `free_line` → `pos_pricing` (sigue dependiendo del toggle de negocio `free_line_enabled`)

**Insights P12 — `src/components/insights/useInsights.ts`**
- [ ] `useHasInsightsPermission` — `analysis` → `reports` (el gate agregado el 2026-06-04)

**Modales — `New/EditOperatorModal.tsx`**
- [ ] Listas de permisos al shape nuevo, agrupadas en 4 áreas
- [ ] Botón "Ver permisos individuales ⌄" que colapsa/expande los toggles
- [ ] Mantener lógica preset↔custom

**Backend / DB**
- [ ] Default de la columna `operators.permissions` → shape nuevo
- [ ] RPCs `create_operator` / `update_operator` — role-default JSONBs (cajero/encargado) al shape nuevo
- [ ] Migración one-shot de filas existentes (§3)
- [ ] `api/operator/switch/route.ts` — escribe `op_perms` con las keys nuevas

**Docs**
- [ ] CLAUDE.md regla 16 — actualizar lista de keys/lugares
- [ ] `docs/conventions.md` — tabla de permisos / route map
- [ ] `docs/db.md` — default de columna + RPC signatures si cambian

---

## 6. Fuera de scope

- Gatear `/pos` (prohibido por §0).
- Rehacer el sistema de presets de rol (ya funciona).
- Permisos nuevos más allá de los 8 (no se agregan capacidades, solo se reorganizan).
- Per-variante / per-categoría — no aplica.
