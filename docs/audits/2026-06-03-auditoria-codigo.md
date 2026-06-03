# Auditoría de código — Pulsar POS

> **Fecha:** 2026-06-03
> **Alcance:** barrido completo del código (`src/` ~47.6k LOC + `supabase/migrations/`) en busca de bugs, inconsistencias, duplicación de código y problemas de seguridad.
> **Método:** 3 agentes en paralelo (seguridad/multi-tenancy, correctitud/bugs, duplicación/consistencia). Cada hallazgo candidato se validó contra la intención real del código antes de reportarse. Los hallazgos "HIGH" se reverificaron manualmente leyendo las migraciones y archivos vigentes.
> **Estado del árbol:** `master` limpio.

---

## Resumen ejecutivo

El código está **sólido**. La serie de auditoría de seguridad `20260529_01..11` dejó un baseline consistente que las features posteriores (P11/P12, ledger de clientes, insights IA, rounding de listas) respetan al pie de la letra.

| Dominio | Hallazgos confirmados | Veredicto |
|---|---|---|
| Seguridad / multi-tenancy | 0 | Sin vulnerabilidades. Patrones tenant-guard + grant-lockdown aplicados de forma consistente. |
| Correctitud / bugs | 0 | El único hallazgo "HIGH" del barrido resultó **falso positivo** (ver §3). |
| Duplicación / consistencia | 3 (1 media + 2 menores) | Deuda de mantenibilidad acotada, sin impacto en correctitud hoy. |

**No hay nada que bloquee la beta.** Las acciones recomendadas son refactors de mantenibilidad opcionales.

---

## 1. Seguridad y multi-tenancy — sin hallazgos

Revisado: todas las migraciones `20260530 → 20260603` (insights/detectores, ledger de clientes batches 1–3, rounding de listas, bulk catalog, audit mercadería, margin analysis), las 4 rutas API, el path de auth (`operator.ts`, switch/logout, `proxy.ts`), las 2 edge functions, y barridos de inyección SQL / XSS / secretos hardcodeados.

**Veredicto: 0 vulnerabilidades confirmadas.** Toda RPC `SECURITY DEFINER` nueva aplica `assert_tenant` / chequeo de pertenencia como primera sentencia y revoca `EXECUTE` de PUBLIC/anon (reglas #34/#35 de CLAUDE.md).

### Notas informativas (no son vulnerabilidades)

- **`CRON_SECRET` comparado con `!==` (no constant-time)** — `supabase/functions/generate-insights/index.ts:30`. Endpoint server-a-server con secreto de alta entropía; timing attack impracticable. Hardening opcional: comparación en tiempo constante. Severidad: negligible.
- **RPCs del ledger de clientes (`20260601_03`) sin REVOKE/GRANT explícito** — correcto por construcción: son `CREATE OR REPLACE` de funciones preexistentes (los grants persisten) y filtran por `get_business_id()` derivado de `auth.uid()`. No hay `p_business_id` spoofeable. **OK.**

### Falsos positivos descartados (verificados como diseño intencional)

- **Guard dual-use `IF auth.uid() IS NOT NULL THEN assert_tenant(...)`** en `get_margin_analysis`, `get_dead_stock`, `get_overstock` (`20260603_01`), detectores N1 (`20260602_07`), `get_product_history` (`20260602_08`): seguro porque anon EXECUTE está revocado; el único llamador con `auth.uid()` NULL es el cron como `service_role`. Diseño P12 intencional.
- **`ai_insights` escribible desde cliente** (`useInsights.ts:89,120`): protegido por RLS `business_id = get_business_id()` (`20260602_06:59`), anon revocado. Solo toca filas del propio negocio.
- **`generate-insights` lee/escribe todos los negocios como `service_role`**: bypassa RLS por diseño, pero está gated por `CRON_SECRET`, itera por negocio y scopea cada RPC + fila insertada con `business.id`. Sin fuga cross-tenant.
- **RPCs de mercadería/expense (`20260603_02`) revocan solo `anon`, no PUBLIC**: son `CREATE OR REPLACE` de funciones ya bloqueadas en `20260529_04`; los grants persisten. Primera sentencia = chequeo de pertenencia. **OK.**
- **`/api/catalog/orders`** anon: re-precia server-side, valida payload (UUID regex, caps de qty/length), rate-limit por IP con `x-real-ip` no spoofeable. Excepción anon por diseño (reglas #29/#33).
- **`/api/operator/switch` & `logout`**: cookie `operator_session` firmada con HMAC (`crypto.subtle.verify`, rechaza no-firmadas/manipuladas); logout solo borra cookies. Sin escalada de privilegios.

---

## 2. Correctitud y bugs — sin hallazgos confirmados

Revisado: paridad price calc (TS `calculateProductPrice` vs SQL `compute_effective_price`), flujo de venta/stock, conversión pedido→venta, date-utils, math de carrito, unwrapping de RPCs (`.data`, regla #15), patrón `mounted`, `useMemo(createClient)`.

**Veredicto: 0 bugs confirmados.**

### Falsos positivos descartados

- **`method: 'other'` en conversión catálogo→venta** (`20260529_08:74`): superado por `20260529_09` que valida `IN ('cash','card','transfer','mercadopago')`. No vive.
- **Doble decremento de stock al completar pedido**: `update_catalog_order_status` toma `SELECT ... FOR UPDATE` sobre el pedido y re-valida la transición; un segundo "completar" concurrente cae en `invalid_transition`. Conversión única.
- **Stock negativo desde `update_stock_on_sale`**: decisión explícita de producto (el POS nunca bloquea la venta). No es bug. Signo correcto.
- **`create_sale_transaction` con `EXCEPTION WHEN OTHERS`**: devuelve `{success:false,error}` y toda la RPC es una transacción → un fallo a mitad de loop hace rollback de items + stock. Sin corrupción de venta parcial.
- **`close_cash_session` solo suma `method = 'cash'`** (`20260529_08:193`): correcto por diseño — esperado en caja = apertura + ventas en efectivo (tarjeta/transferencia no tocan el cajón).
- **`getActiveOperator` (async)**: todos los callers la awaitan. Sin promesa sin esperar.
- Sin violaciones de unwrapping `{data:[...]}` (regla #15) en los paths de precio/venta/stock.

---

## 3. ⚠️ Falso positivo notable que vale documentar

El barrido marcó como **HIGH** una supuesta divergencia de redondeo entre cliente y catálogo: el cliente (`applyRounding` en `price-lists.ts`) redondea al `rounding_step` de la lista, pero el mirror SQL `compute_effective_price` no lee `rounding_step`/`rounding_up`.

**Por qué es falso positivo (reverificado manualmente):**

El agente leyó la migración **superada** `20260526_01_variant_pricing_helper.sql` (donde el catálogo buscaba la lista default y pasaba un `list_id` no-NULL). La migración vigente **`20260602_01_price_base_authoritative.sql`** reescribió el modelo: el catálogo público muestra **siempre el precio base** (`products.price`), ya no la lista default. Confirmado en el código vivo:

- `20260602_01:116` — comentario: *"Ya no se busca la lista default; se pasa list NULL a compute_effective_price."*
- `get_catalog_products` (`:140,:142`) llama a `compute_effective_price(..., NULL, NULL, ...)` → `p_list_id = NULL`.
- `create_catalog_order` (`:193,:214`) idem: `p_list_id = NULL`.

Con `p_list_id = NULL`, la rama de lista (la única que multiplicaría costo × mult) **nunca corre** en SQL. Por lo tanto el redondeo no aplica en catálogo y el comentario de la migración `20260603_03` es **correcto**: el mirror SQL siempre se invoca con `list_id = NULL`. No hay divergencia ni cobro incorrecto.

> **Lección de mantenimiento:** las migraciones superadas (`20260526_01`) siguen en el directorio y confunden. La fuente de verdad de `compute_effective_price`, `get_catalog_products` y `create_catalog_order` es `20260602_01` (+ `20260602_02` para `is_default`). Considerar dejar una nota de cabecera en las migraciones superadas o consolidar `schema.sql`.

---

## 4. Duplicación y consistencia — 3 hallazgos reales

### 4.1 MEDIA — Validación de permisos reimplementada en el switch route

- **Canónico:** `parseActiveOperator` → `parsePermissions` en `src/lib/operator.ts:94-128, 171-194`.
- **Duplicado:** `parseVerifyResult` en `src/app/api/operator/switch/route.ts:71-120` rehace exactamente el mismo chequeo de shape (las 8 claves boolean obligatorias `sales…expenses` + las 3 soft `operators_write`/`price_override`/`free_line`) y el mismo `normalizePermissions({...})` campo por campo.
- **Por qué importa:** es código del límite de privilegios. La regla #16 ya obliga a tocar este route al agregar un permiso, pero `parseVerifyResult` es un **segundo lugar que enumera el set de claves**. Si se agrega un permiso #12 y solo se actualiza `parsePermissions`, el switch route sigue validando el set viejo — exactamente la deriva que la regla advierte. Hoy ambos coinciden, así que no es un bug vivo, pero el riesgo de drift está en el path sensible.
- **Dirección sugerida:** `parseVerifyResult` recibe la shape del resultado de la RPC `verify` (no la cookie), pero la lógica de permisos es idéntica. Reemplazar el bloque de permisos por una llamada a `parsePermissions(operator.permissions)` y mantener solo el parseo de `profile_id`/`name`/`role` local.

### 4.2 MEDIA — Lista de permisos visibles duplicada en ambos modales de operador

- `src/components/settings/NewOperatorModal.tsx:16-26` y `src/components/settings/EditOperatorModal.tsx:33-53` definen listas `VisiblePermissionKey` + `PERMISSION_LABELS` casi idénticas (mismo `Exclude<…>`, misma lista de filas), y **difieren ligeramente en el orden de filas** — señal de que ya empezaron a derivar.
- Además ambos **shadowean** el `PERMISSION_LABELS` exportado de `lib/operator.ts:50` con un const local del mismo nombre pero distinta shape (confuso).
- **Por qué importa:** agregar/renombrar un permiso obliga a editar dos listas mantenidas a mano que pueden quedar desincronizadas. Riesgo menor que 4.1 (son labels de UI, no el chequeo de seguridad).
- **Dirección sugerida:** extraer la lista de claves visibles + el mapa de write-toggles a un módulo compartido consumido por ambos modales.

### 4.3 BAJA — JSONBs de permisos por defecto de rol duplicados (modal ↔ DB)

- `src/components/settings/NewOperatorModal.tsx:30-31` define los objetos de permisos `manager`/`cashier` inline. Por reglas #16/#5 deben coincidir con los JSONBs de default por rol del RPC `create_operator` en Postgres. Dos fuentes de verdad para la misma matriz; una divergencia hace que el preview de la UI no coincida con lo que escribe la DB.
- **Dirección sugerida:** fuera de alcance cambiar el RPC; al menos dejar un comentario que cruce-referencie la migración, o derivar el preview de la UI de una constante TS que el RPC también espeje.

### 4.4 Nota menor — Sugerencia de precio base no aplica redondeo

- `src/hooks/useProductForm.ts:70,101,116` genera precio base con `cost * multiplier` sin `applyRounding`. Es la acción "sugerir precio base desde la lista default", intencionalmente sin overrides/redondeo. **Aceptable**, pero los precios sugeridos pueden quedar no-redondos (ej. `1234.56`) donde los derivados de lista redondean — posible inconsistencia de UX, no de correctitud.

### Falsos positivos descartados

- `await createClient()` en Server Components (`(app)/*/page.tsx`): la regla `useMemo` es solo para Client Components. **OK.**
- `router.refresh()` post-venta (`CartPanel.tsx:901`) y post-guardado (`EditOperatorModal.tsx:264`, `SettingsForm.tsx:215`): no son switch de operador; la regla #21 no aplica. El switch usa `window.location.href` correctamente.
- Sin `<select>` nativo en ningún lado (todo `SelectDropdown`).
- Componentes de activity-detail ya factorizados en `activity/detail/` con `shared.tsx`/`renderers.tsx` — no copy-paste.
- `usePillIndicator` en `InventoryPanel.tsx:117` (status de stock) = navegación de vista, excepción explícitamente permitida.
- Sin `TODO/FIXME` ni bloques comentados muertos.

---

## 5. Acciones recomendadas (priorizadas)

| # | Acción | Esfuerzo | Prioridad |
|---|---|---|---|
| 1 | Refactor 4.1: `parseVerifyResult` usa `parsePermissions` (path de privilegios) | Bajo | Media |
| 2 | Refactor 4.2 + 4.3: compartir lista/labels de permisos entre modales y cruzar-referenciar JSONBs del RPC | Bajo-Medio | Baja |
| 3 | Nota de cabecera en migraciones superadas (`20260526_01`) para evitar confusión futura (ver §3) | Trivial | Baja |
| 4 | (Opcional) `applyRounding` en sugerencia de precio base, por consistencia UX (4.4) | Trivial | Baja |

Ninguna acción es bloqueante. El sistema no presenta vulnerabilidades de seguridad ni bugs de correctitud confirmados.
