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

> **Estado:** las cuatro migraciones aplicadas a producción y verificadas con las pruebas de explotación de este doc (cross-tenant auth/anon → bloqueado; camino legítimo → ok; cron y logging interno → intactos). La 3b se aplicó después de desplegar el código que usa `get_catalog_business` (anon directo a `businesses` → permission denied; catálogo anon vía RPC → ok; owner autenticado lee su negocio vía `tenant_isolation`).
>
> - `supabase/migrations/20260529_01_rpc_tenant_guards.sql` — helper `assert_tenant()` + guard en las 15 funciones de datos + revoke anon / grant authenticated.
> - `supabase/migrations/20260529_02_lockdown_internal_functions.sql` — revoke anon/authenticated en `log_audit_event`, `upsert_daily_snapshot`, `refresh_all_daily_snapshots` (sin guard: el cron corre como `service_role`).
> - `supabase/migrations/20260529_03a_get_catalog_business_rpc.sql` — RPC de catálogo con columnas públicas + código migrado.
> - `supabase/migrations/20260529_03b_lockdown_businesses_anon.sql` — aplicada tras deploy (drop policy `public_read_businesses` + revoke SELECT anon).
> - `supabase/migrations/20260529_04_lockdown_expense_grants.sql` — revoke PUBLIC/anon en las 5 RPC de gastos (ya estaban protegidas por guard `auth.uid`; solo defensa en profundidad de grants).

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

- ~~**Brute-force de PIN de operador**~~ — ✅ CERRADO (2026-05-29, mig. `20260529_05_harden_verify_operator_pin.sql`). `verify_operator_pin` era **anon-ejecutable, sin rate-limit y sin guard de sesión**, contra un PIN de 4 dígitos (10k combinaciones) — un atacante con `business_id` (descubrible) + `operator_id` podía llamarla **directo al endpoint RPC salteando el route**. Fix: (a) `REVOKE PUBLIC/anon + GRANT authenticated` (cierra el bypass anon; el único llamador legítimo es el route de switch, autenticado); (b) guard `assert_tenant(p_business_id)` (regla 34); (c) lockout durable en `operators.failed_pin_attempts` + `pin_locked_until` (5 intentos → bloqueo 15 min), que protege también el escenario de terminal compartida (un operador adivinando el PIN de un compañero). Verificado: anon→`permission denied`; cross-tenant auth→`Contexto de negocio invalido`; camino legítimo→ok; 4 PIN malos→"PIN incorrecto", 5º→bloqueado.
- ~~**Hardening del advisor / anon EXECUTE**~~ — ✅ CERRADO (2026-05-29, mig. `20260529_06_lockdown_anon_secdef_rpcs.sql`). Quedaban ~70 funciones `SECURITY DEFINER` anon-ejecutables (seguras-por-guard, pero el default de Supabase otorga EXECUTE a PUBLIC). Se revocó PUBLIC/anon + GRANT authenticated en las 57 no-catálogo (mutadores, stats, sesiones de caja, feedback, etc.). **Siguen anon a propósito** (verificado con `has_function_privilege`): las 7 del catálogo público + `bootstrap_new_user` (lo llama el registro antes de iniciar sesión) + `get_business_id()` (lo evalúa RLS como anon) + las 3 trigger fns (`set_updated_at`, `update_stock_on_sale`, `rls_auto_enable`).
- ~~**Auth de operadores / escalada de privilegios**~~ — ✅ CERRADO (2026-05-29, mig. no aplica — cambio de código). **Hallazgo crítico confirmado:** `operator_session` era JSON plano sin firma; `getActiveOperator` solo validaba estructura. Como los operadores montan sobre la sesión Supabase del **dueño** (no tienen auth propia), un sub-operador podía editar la cookie en devtools (`httpOnly` solo bloquea acceso por JS, no la manipulación del titular), declararse `role: 'owner'` → el proxy concedía **todas las rutas** + `op_perms = OWNER_PERMISSIONS`, y todos los RPC de lectura (corren bajo la sesión del dueño) le devolvían la data financiera completa. Para **escritura**, seteando `profile_id` al del dueño (derivable del JWT `sub` en las cookies `sb-…` del mismo navegador), los mutadores caían en el branch "es `profiles` → tratar como dueño" y bypasseaban el chequeo de permisos. **Fix:** `operator_session` ahora se firma con **HMAC-SHA256** (`OPERATOR_SESSION_SECRET`, Web Crypto edge+node) en `/api/operator/switch`; `getActiveOperator` (async) verifica la firma y rechaza cookies sin firma/manipuladas → redirige a `/operator-select`. `op_perms` (no-httpOnly) es solo UI (sidebar) y no decide nada server-side. `/api/operator/logout` ya solo borra cookies (regla 20). Los mutadores DB ya re-chequeaban `operators.permissions` (defensa en profundidad). Verificado (round-trip HMAC): cookie firmada→ok; JSON plano `role:owner`→rechazado; payload manipulado→rechazado; firma con secreto ajeno→rechazado. **Requiere setear `OPERATOR_SESSION_SECRET` en todos los entornos; las cookies existentes se invalidan una vez (re-ingreso de PIN/contraseña).**
- ~~**Endpoints anónimos del catálogo**~~ — ✅ REVISADO + ENDURECIDO (2026-05-29, mig. `20260529_07_harden_create_catalog_order.sql` + route). **Núcleo sólido:** el payload anónimo solo lleva `product_id`/`variant_id`/`quantity` (sin precio); `create_catalog_order` re-precia server-side con `compute_effective_price` y scopea producto **y** variante al negocio del slug (`business_id`, `is_active`, `show_in_catalog`) → sin inyección de precio ni acceso cross-tenant. Sin SQLi (RPC parametrizada) ni XSS (UI de `/orders` interpola con JSX; `image_url` viene de la DB del dueño). Anti-spam por teléfono (3 pendientes/h) + blacklist ya existían. **Hardening aplicado** (la RPC es la frontera real porque es anon-ejecutable; los límites se enforzan en RPC **y** route): (A) el catch-all ya no devuelve `SQLERRM` crudo al cliente sino `unexpected_error` (loguea con `RAISE WARNING`); el route valida formato UUID de `product_id`/`variant_id`. (B) longitudes capeadas: `customer_name` 120, `address` 300, `notes` 1000 (`left()` server-side + rechazo en route) — evita blobs de MB. (C) `quantity` casteada vía numeric (sin overflow de int), floor + clamp a 1000/línea; máx 50 ítems/pedido (`too_many_items`). (D) `getClientIp` prefiere `x-real-ip` (Vercel, no spoofeable) sobre `x-forwarded-for`. Verificado: uuid inválido→`unexpected_error` (sin leak), qty 999999→clamp 1000 (total ×1000), 51 ítems→`too_many_items`, nombre 500/addr 900/notes 5000→truncados a 120/300/1000, pedido legítimo→ok.
- ~~**Concurrencia / race conditions**~~ — ✅ REVISADO + ENDURECIDO (2026-05-29, mig. `20260529_08_fix_race_conditions.sql`). **No eran bug** (verificado): el descuento de stock (`UPDATE stock = stock - qty` toma lock de fila → serializa; stock negativo permitido por diseño), el crédito de cliente (`create_sale_transaction` hace `SELECT … FOR UPDATE` sobre `customers` antes de chequear/aplicar el límite) y la numeración de ventas (UUID). **3 carreras check-then-act confirmadas y corregidas:** (1) 🔴 `update_catalog_order_status` sin lock → dos "completar" concurrentes creaban **dos ventas + doble descuento de stock**; fix `SELECT … FOR UPDATE` sobre el pedido → la 2da llamada espera, re-lee `completado` y cae en `invalid_transition`. (2) `open_cash_session` con índice parcial NO único → dos aperturas concurrentes creaban dos sesiones abiertas; fix **índice único parcial** `(business_id) WHERE status='open'` + handler `unique_violation`. (3) `close_cash_session` sin lock → doble cierre sobrescribía; fix `SELECT … FOR UPDATE`. Verificado: índice único rechaza 2da apertura; completar 2 veces → 1 sola venta + 2da `invalid_transition`.
- **Bug funcional descubierto al verificar (no de seguridad) — ✅ CORREGIDO (mig. `20260529_09`).** La conversión de pedido a venta usaba el método de pago `'other'`, que **no** está en `payments_method_check` → completar un pedido **siempre fallaba** (0 completados en la historia; nunca detectado por falta de usuarios reales). Fix: `update_catalog_order_status` recibe `p_payment_method` y el operador elige el método real al completar (`cash/card/transfer/mercadopago`; se excluye `credit`). Además se agregó `sales.source` (`'pos' | 'catalog'`) para distinguir ventas POS vs pedidos online (se setea `'catalog'` en la conversión). Exponer `source` en stats/dashboard queda en backlog.
- ~~**Confirmar la familia de gastos `auth.uid`**~~ — ✅ CONFIRMADO (2026-05-29). Las 5 (`create_expense`, `create_mercaderia_expense`, `update_expense`, `delete_expense`, `update_mercaderia_expense`) tienen el guard `EXISTS (profiles WHERE id = auth.uid() AND business_id = p_business_id)` como **primera sentencia** → no explotables cross-tenant (anon → `auth.uid()` NULL → `unauthorized`). Gap menor cerrado: seguían con EXECUTE para PUBLIC/anon (`create_mercaderia_expense` con anon explícito); migración `20260529_04_lockdown_expense_grants.sql` revocó PUBLIC/anon dejando solo `authenticated` + `service_role`.
- ~~**Mutadores de inventario guardados**~~ — ✅ CONFIRMADO (2026-05-29). Las 30 RPC mutadoras que reciben `p_business_id` (`create_product`, `update_product`, `delete_product`, `create_product_with_variants`, `update_product_variants`, `bulk_*`, `create/update/delete` de brand/category/price_list/supplier/customer/operator, `update_business_settings/slug`, `swap_default_price_list`, `reconcile_sales_count`, `refresh_daily_snapshot`) comparan `get_business_id()` contra `p_business_id` (vía `assert_tenant` o patrón equivalente) → no explotables cross-tenant para escritura. Las que no reciben `p_business_id` (`open/close_cash_session`, `delete_customer`, `settle_customer_credit`, `update_catalog_order_status`, `upsert_session_digital_balance`) derivan el negocio de la sesión vía `get_business_id()` (anon → NULL → no filtran nada).
