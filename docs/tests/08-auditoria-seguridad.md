# 08 — Auditoría de seguridad interna (multi-tenant)

Auditoría read-only del aislamiento multi-tenant a nivel base de datos: cobertura RLS, funciones `SECURITY DEFINER` y GRANTs a `anon`/`authenticated`.

> **Resultado: se encontró una clase de vulnerabilidad real y explotable** — fuga (y escritura) cross-tenant vía RPC `SECURITY DEFINER` que confían en el `p_business_id` recibido sin verificar que el llamador sea dueño de ese negocio. **Confirmada empíricamente.** Ver "Hallazgo crítico".
>
> Fecha: 2026-05-29. Base: proyecto `zrnthcznbrplzpmxmkwk`. Negocios de prueba: Q tal lokis (`debd5e3c…`), tienda de seba (`abd2d7b9…`). Cecilia (real) no se tocó.

---

## Contexto

La prueba de stress ([`07-stress-volumen.md`](07-stress-volumen.md)) concluyó que el aislamiento multi-tenant era sólido — **pero ese test solo cubrió queries directas a tablas (RLS) y `create_sale_transaction`.** Esta auditoría revisó la otra superficie: las ~85 funciones `SECURITY DEFINER`, que **se ejecutan como owner y por lo tanto saltean RLS**. Ahí estaba el agujero.

## Método

Todo read-only sobre `pg_catalog` / `information_schema`, más pruebas de explotación impersonando roles (`set local role authenticated/anon` + `request.jwt.claims`) dentro de transacciones con `rollback`. Ningún dato fue modificado.

---

## 1. Cobertura RLS — ✅ OK

**Todas** las tablas de `public` tienen RLS habilitado y al menos una policy. No hay tablas desprotegidas.

Las tablas sin columna `business_id` (junction/child) aíslan correctamente vía join al padre con `get_business_id()`:

| Tabla | Aísla por |
|---|---|
| `payments`, `sale_items` | `sale_id IN (sales WHERE business_id = get_business_id())` |
| `catalog_order_items` | `EXISTS (catalog_orders … business_id = get_business_id())` |
| `product_option_values` | `option_id IN (product_options … get_business_id())` |
| `product_variant_option_values` | `variant_id IN (product_variants … get_business_id())` |
| `price_list_overrides` | `price_list_id IN (price_lists … get_business_id())` + chequeo `stock_write` en update/delete |

**Notas menores:**
- `attribute_types` (`authenticated_read`, `qual = true`): tabla de referencia global (`id, label, position`), sin `business_id` ni datos sensibles. Aceptable.
- `businesses.public_read_businesses` deja a **anon leer todas las filas** (`qual = auth.role()='anon' OR id=get_business_id()`). El catálogo solo necesita `id, name, description, logo_url, whatsapp` por slug, pero la policy expone toda la fila (`settings`, `tax_id`, `plan`, `timezone`) de todos los negocios. Hoy `settings` solo tiene `currency/free_line_enabled/primary_color` (sin secretos), así que es **baja severidad** — pero permite enumerar todos los negocios y obtener su `business_id` por slug (insumo clave para explotar el hallazgo crítico). Rompe la regla 29 de CLAUDE.md (catálogo anon vía RPC, no query directa).

---

## 2. Hallazgo crítico — RPC `SECURITY DEFINER` sin verificación de tenant

### El patrón roto

`create_sale_transaction` valida correctamente:
```sql
IF get_business_id() IS NULL OR p_business_id IS DISTINCT FROM get_business_id() THEN
  RETURN jsonb_build_object('success', false, 'error', 'Contexto de negocio invalido');
END IF;
```

Pero **muchas otras RPC que reciben `p_business_id` no hacen este chequeo.** Solo verifican que *el dato* pertenezca al `p_business_id` recibido (ej. `EXISTS (sales WHERE id=p_sale_id AND business_id=p_business_id)`), lo cual se satisface trivialmente pasando un par válido. Como son `SECURITY DEFINER`, saltean RLS → el llamador puede pasar el `business_id` de **otro** negocio.

### Confirmación empírica

```text
# Usuario autenticado de tenant 2 llamando RPCs con el business_id de tenant 1:
get_business_balance(tenant1) → income = $1.244.503,70   ← FUGA
get_stats_kpis(tenant1)       → total_sales = 400, revenue = $1.244.503,70  ← FUGA

# anon (SIN login) con search_expense_products:
search_expense_products(tenant1, 'prod', 50) → 30 productos  ← FUGA SIN AUTENTICAR
```

El `business_id` de cualquier negocio se obtiene de la policy pública de `businesses` (por slug del catálogo), así que el atacante no necesita adivinarlo.

### Funciones afectadas

**Lectura cross-tenant (autenticado con cualquier login):**
`get_business_balance`, `get_stats_kpis`, `get_stats_breakdown`, `get_stats_evolution`, `get_sales_by_brand_detail`, `get_sales_by_category_detail`, `get_sales_by_operator_detail`, `get_sales_by_payment_detail`, `get_top_products_detail`, `get_expenses_list`, `get_sale_detail` (requiere `sale_id`).

**Escritura/borrado cross-tenant (autenticado, requiere `sale_id` válido):**
- `delete_sale(p_sale_id, p_business_id, p_operator_id)` — **borra la venta de otro negocio** (revierte stock, borra pagos/items/movimientos). 🔴
- `update_sale(p_sale_id, p_business_id, …)` — **reescribe items/pagos de la venta de otro negocio.** 🔴

**Callable por `anon` (sin login) — severidad extra:**
- `search_expense_products` — lectura de productos de cualquier negocio (confirmado). 🔴
- `get_mercaderia_expense_items(p_expense_id, p_business_id)` — items de gasto de cualquier negocio (requiere `expense_id`).
- `upsert_daily_snapshot(p_business_id, date)` — recomputa el snapshot de cualquier negocio.
- `log_audit_event(p_business_id, …)` — permite **forjar entradas de auditoría** para cualquier negocio.
- `refresh_all_daily_snapshots()` — recomputa snapshots de **todos** los negocios (DoS).

### Funciones que SÍ están bien (referencia del patrón correcto)

- `create_sale_transaction` — chequea `p_business_id = get_business_id()`. ✓
- `create_expense` (y la familia de gastos basada en `auth.uid`: `create_mercaderia_expense`, `update_expense`, `delete_expense`, `update_mercaderia_expense`) — chequean `EXISTS (profiles WHERE id=auth.uid() AND business_id=p_business_id)`. ✓ *(confirmado en `create_expense`; conviene verificar las otras 4 una por una al aplicar el fix).*
- RPC sin `p_business_id` que derivan el negocio de la sesión vía `get_business_id()` (ej. `get_active_session`, `get_catalog_orders`, `open_cash_session`, `settle_customer_credit`): para `anon`, `get_business_id()` devuelve NULL → no filtran nada ajeno. ✓
- Catálogo público por slug (`get_catalog_products`, etc.): anon por diseño, re-precia server-side. ✓
- Mutadores de inventario guardados (`create_product`, `bulk_*`, etc.): referencian `get_business_id()` (patrón seguro; confirmar comparación al revisar).

---

## 3. Fix — APLICADO y probado (2026-05-29)

> **Estado:** migraciones 1, 2 y 3a aplicadas a producción y verificadas con las pruebas de explotación de este doc (cross-tenant auth/anon → bloqueado; camino legítimo → ok; cron y logging interno → intactos). La migración 3b (cierre directo de `businesses` a anon) quedó escrita pero **se aplica recién después de desplegar** el código que usa `get_catalog_business`, para no romper el catálogo en producción.
>
> - `supabase/migrations/20260529_01_rpc_tenant_guards.sql` — helper `assert_tenant()` + guard en las 15 funciones de datos + revoke anon / grant authenticated.
> - `supabase/migrations/20260529_02_lockdown_internal_functions.sql` — revoke anon/authenticated en `log_audit_event`, `upsert_daily_snapshot`, `refresh_all_daily_snapshots` (sin guard: el cron corre como `service_role`).
> - `supabase/migrations/20260529_03a_get_catalog_business_rpc.sql` — RPC de catálogo con columnas públicas + código migrado.
> - `supabase/migrations/20260529_03b_lockdown_businesses_anon.sql` — **pendiente de aplicar tras deploy** (drop policy + revoke SELECT anon).

### Fix propuesto (diseño original)

Dos cambios, ambos de bajo riesgo de romper la app —el servidor siempre pasa el `business_id` de la propia sesión (`requireAuthenticatedBusinessId`), así que el guard siempre pasa para llamadas legítimas:

**a) Guard de tenant al inicio de cada función vulnerable que recibe `p_business_id`:**
```sql
IF get_business_id() IS NULL OR p_business_id IS DISTINCT FROM get_business_id() THEN
  RAISE EXCEPTION 'Contexto de negocio invalido';  -- o RETURN error en las que devuelven jsonb
END IF;
```
(Para `get_sale_detail`/`delete_sale`/`update_sale` que reciben `p_sale_id` + `p_business_id`, igual: el guard va sobre `p_business_id`.)

**b) Revocar EXECUTE a `anon`** en funciones que no deben ser públicas:
`search_expense_products`, `get_mercaderia_expense_items`, `log_audit_event`, `upsert_daily_snapshot`, `refresh_all_daily_snapshots`. (`log_audit_event` es un helper interno: idealmente solo `service_role`/owner.)

**c) Acotar `businesses` para anon** (opcional, baja prio): mover el lookup del catálogo a un RPC `get_catalog_business(p_slug)` que devuelva solo columnas públicas y revocar el SELECT directo de `businesses` a anon — consistente con la regla 29.

Aplicar en una migración (`apply_migration`), re-correr las pruebas de explotación de esta auditoría (deben pasar a devolver error/0 filas), y verificar que la app sigue funcionando (las llamadas legítimas usan el `business_id` de la sesión).

---

## 4. Conclusión

- **RLS a nivel tabla: sólido.** Ninguna tabla desprotegida; los child tables aíslan por join.
- **Capa RPC `SECURITY DEFINER`: agujero real de aislamiento multi-tenant**, confirmado con lecturas cross-tenant autenticadas y anónimas. Es el riesgo crítico a cerrar antes de sumar usuarios reales.
- El test de stress previo no lo detectó porque no ejercitó estas RPC — quedó documentado para no repetir el sesgo: **probar siempre la superficie RPC, no solo las tablas.**

### Limpieza pendiente
Los datos de **Q tal lokis** se eliminan después. **tienda de seba** queda como banco de pruebas. Cecilia intacta.

---

## 5. Frentes pendientes de auditar

Esta auditoría cubrió RLS de tablas + RPC `SECURITY DEFINER` + GRANTs. Quedan por revisar:

- **Auth de operadores / escalada de privilegios** — PIN bcrypt, cookies (`operator_session`, `op_perms`), flujo de logout, gates de permisos por rol, `verify_operator_pin` (brute force / rate limit).
- **Endpoints anónimos del catálogo** — `/api/catalog/orders`: rate limit por IP, re-precio server-side, inyección vía payload anónimo, `create_catalog_order`.
- **Concurrencia / race conditions** — transacciones simultáneas (ej. dos ventas del mismo stock a la vez), no ejercitado en el stress test (volumen fue secuencial).
- **Confirmar la familia de gastos `auth.uid`** — `create_mercaderia_expense`, `update_expense`, `delete_expense`, `update_mercaderia_expense` (solo se verificó `create_expense`; se asume mismo patrón pero falta abrir una por una).
- **Mutadores de inventario guardados** — `create_product`, `bulk_*`, etc.: referencian `get_business_id()`; confirmar que comparan contra `p_business_id`.
