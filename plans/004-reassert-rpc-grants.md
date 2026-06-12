# Plan 004: Re-asentar REVOKE/GRANT explícitos para RPCs reemplazadas después de la auditoría de seguridad

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat a549038..HEAD -- supabase/migrations/`
> Si hay migraciones nuevas posteriores a `20260612_02`, revisarlas con el
> mismo criterio de este plan (¿definen funciones SECURITY DEFINER sin
> REVOKE/GRANT en el mismo archivo?) e incluirlas en la migración del Step 2.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: LOW
- **Depends on**: none
- **Category**: security
- **Planned at**: commit `a549038`, 2026-06-12

## Why this matters

La auditoría de seguridad de 2026-05-29 estableció la regla (CLAUDE.md regla 34): toda RPC `SECURITY DEFINER` debe tener `REVOKE ... FROM PUBLIC, anon` + `GRANT ... TO authenticated` **en su migración**. Varias migraciones posteriores (junio 2026) hicieron `CREATE OR REPLACE` de RPCs sin re-asentar los grants. **No hay vulnerabilidad activa**: `CREATE OR REPLACE` preserva los grants existentes en Postgres, y los grants originales viven en migraciones de mayo. Pero el patrón es frágil: (a) un futuro `DROP FUNCTION` + `CREATE` (necesario cuando cambia el tipo de retorno) **pierde los grants y Postgres otorga EXECUTE a PUBLIC por defecto** — exactamente el agujero que cerró la auditoría; (b) la postura de seguridad de cada función es invisible leyendo su última migración. Este plan crea UNA migración que re-asienta los grants de todas las funciones afectadas y deja el estado autodocumentado.

## Current state

Migraciones de junio que definen/reemplazan funciones sin REVOKE/GRANT en el mismo archivo (verificado por grep en `a549038`):

| Migración | Funciones reemplazadas | Audiencia correcta |
|---|---|---|
| `20260601_02_customer_account_ledger_batch1.sql` | `create_sale_transaction`, `settle_customer_credit` | authenticated |
| `20260601_03_customer_account_ledger_batch2a.sql` | `close_cash_session`, `get_session_summary`, `settle_customer_credit` | authenticated |
| `20260601_04_payment_detail_collections.sql` | `get_sales_by_payment_detail` | authenticated |
| `20260602_02_fix_is_default_consumers.sql` | `create_catalog_order`, `delete_price_list` | create_catalog_order: **anon + authenticated** (ver nota abajo); delete_price_list: authenticated |
| `20260602_04_catalog_products_default_variant_image.sql` | `get_catalog_products` | **anon + authenticated** |
| `20260609_01_normalize_permissions_helper.sql` | `normalize_permissions` | authenticated (helper puro, lo invocan otras DEFINER inline) |
| `20260609_03_permisos_fase3_datos_defaults.sql` | `create_operator`, `update_operator` | authenticated |
| `20260610_01_promotions_catalog.sql` | `get_catalog_product_with_variants`, `create_catalog_order`, `update_catalog_order_status` (get_catalog_products SÍ tiene grant en ese archivo, líneas 124-125) | catálogo: anon + authenticated; update_catalog_order_status: authenticated |
| `20260611_01_catalog_detail_meta.sql` | `get_catalog_product_with_variants` | anon + authenticated |
| `20260611_02_catalog_min_variant_price.sql` | `get_catalog_products` | anon + authenticated |

Nota sobre `create_catalog_order`: el checkout anónimo entra por `/api/catalog/orders` (route handler Node). Verificar qué cliente Supabase usa esa route (`src/app/api/catalog/orders/route.ts`): si usa el cliente anon, la función necesita GRANT a `anon`; si usa service_role, alcanza `authenticated`+`service_role`. **No adivinar: leer la route.**

Contraejemplo del patrón correcto (la migración más reciente SÍ cumple), `supabase/migrations/20260612_02_get_promo_impact.sql:72-73`:

```sql
REVOKE ALL ON FUNCTION public.get_promo_impact(uuid, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_promo_impact(uuid, date, date) TO authenticated, service_role;
```

Las firmas exactas (lista de argumentos) de cada función están en su última migración — los GRANT/REVOKE requieren la firma exacta. `supabase/schema.sql` es el dump de referencia del esquema (memoria del proyecto: mantenerlo en sync con cada cambio de DB).

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Ver firma de una función | `grep -A3 "FUNCTION .*<nombre>" supabase/migrations/<archivo>.sql \| head -5` | firma con tipos |
| Lint del repo | `npm run lint` | exit 0 (no toca SQL, sanity) |
| Aplicar migración (SOLO el operador) | `npm run supabase:db:push` | — ver STOP conditions |

## Scope

**In scope**:
- `supabase/migrations/20260613_01_reassert_rpc_grants.sql` (create — ajustar el prefijo de fecha al día real de ejecución si es posterior)
- `supabase/schema.sql` (solo si el operador aplica la migración y pide regenerar/sincronizar)

**Out of scope**:
- **NO editar migraciones ya existentes** — ya están aplicadas en la DB remota; modificar archivos aplicados rompe el historial de migraciones de Supabase.
- NO cambiar el cuerpo de ninguna función. Este plan SOLO toca grants.
- NO tocar funciones de catálogo respecto de `anon` sin verificar primero (ver STOP conditions) — revocar anon de `get_catalog_products` rompería el catálogo público entero.

## Git workflow

- Commit sugerido: `fix(security): re-asentar REVOKE/GRANT de RPCs reemplazadas post-auditoría (regla 34)`.
- Do NOT push, y NO aplicar la migración a la DB remota — eso lo decide el operador (ver STOP conditions).

## Steps

### Step 1: Recolectar firmas exactas

Para cada función de la tabla de "Current state", abrir su migración MÁS RECIENTE (la última que la define) y copiar la firma exacta (nombre + tipos de argumentos, sin DEFAULTs — los DEFAULT no forman parte de la firma para GRANT). Armar la lista completa. Además, leer `src/app/api/catalog/orders/route.ts` para determinar el cliente Supabase usado (anon vs service_role) y fijar la audiencia de `create_catalog_order`.

**Verify**: lista de ~12 firmas, cada una copiada de un archivo real (anotar archivo de origen en un comentario SQL).

### Step 2: Escribir la migración

Crear `supabase/migrations/20260613_01_reassert_rpc_grants.sql` con esta estructura (una sección por función, comentando de qué migración viene la firma):

```sql
-- Re-asienta grants de RPCs SECURITY DEFINER reemplazadas sin REVOKE/GRANT
-- explícito en migraciones de junio 2026 (regla 34 de CLAUDE.md).
-- No cambia comportamiento: CREATE OR REPLACE preservó estos grants;
-- esto los hace explícitos y resistentes a un futuro DROP+CREATE.

-- create_sale_transaction (firma según 20260601_02)
REVOKE ALL ON FUNCTION public.create_sale_transaction(<firma>) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_sale_transaction(<firma>) TO authenticated;

-- get_catalog_products (firma según 20260611_02) — catálogo público: anon SÍ
REVOKE ALL ON FUNCTION public.get_catalog_products(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_catalog_products(text) TO anon, authenticated;

-- ... (resto de funciones de la tabla)
```

Audiencias según la tabla de "Current state". Para funciones que el cron/edge function invoca (si apareciera alguna), incluir `service_role` como en el contraejemplo de `20260612_02`.

**Verify**: el archivo contiene exactamente un par REVOKE/GRANT por función de la tabla del Step 1; `grep -c "REVOKE" supabase/migrations/20260613_01_reassert_rpc_grants.sql` ≥ 12.

### Step 3: Entregar sin aplicar

NO ejecutar `supabase db push`. Dejar la migración creada y reportar al operador que está lista para aplicar. Si el operador la aplica, recordarle sincronizar `supabase/schema.sql` (convención del proyecto).

**Verify**: `git status` muestra solo el archivo nuevo de migración.

## Test plan

- Post-aplicación (responsabilidad del operador, no del executor): smoke del catálogo público — abrir `/catalogo/<slug>` de un negocio dev en una ventana de incógnito (sesión anon): la grilla de productos debe cargar. Crear un pedido de prueba desde el catálogo (negocio 'tienda de seba' o 'Q tal lokis' ÚNICAMENTE — nunca negocios reales). Login como dueño y registrar una venta en `/pos`.
- Query de verificación en la DB (operador, via SQL editor):
  ```sql
  SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args, p.proacl
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.prosecdef
  ORDER BY p.proname;
  ```
  Ninguna función SECURITY DEFINER debe tener ACL con `=X/` (EXECUTE para PUBLIC) salvo decisión explícita.

## Done criteria

- [ ] Existe `supabase/migrations/20260613_01_reassert_rpc_grants.sql` con pares REVOKE/GRANT para todas las funciones de la tabla
- [ ] Cada firma fue copiada de la última migración que define la función (comentario con la fuente)
- [ ] La audiencia de `create_catalog_order` quedó determinada leyendo la route, no asumida
- [ ] Las migraciones existentes NO fueron modificadas (`git status`)
- [ ] La migración NO fue aplicada a la DB remota por el executor
- [ ] Fila actualizada en `plans/README.md`

## STOP conditions

- No se puede determinar la audiencia correcta de una función (¿anon o no?) leyendo el código que la llama → listar la duda y parar; un grant de anon de más es un agujero, uno de menos rompe el catálogo.
- Una función de la tabla fue reemplazada de nuevo por una migración más nueva que la `20260612_02` con firma distinta → recalcular contra esa firma.
- Cualquier tentación de "aprovechar y arreglar" el cuerpo de una función → fuera de scope, reportar aparte.
- Aplicar la migración a la DB remota: NUNCA — la aplica el operador.

## Maintenance notes

- Regla operativa a partir de esto (para reviewers): toda migración futura que haga `CREATE OR REPLACE FUNCTION ... SECURITY DEFINER` debe terminar con su par REVOKE/GRANT aunque "ya estuvieran" — es la única forma de que un `DROP+CREATE` posterior no abra PUBLIC EXECUTE en silencio.
- Idea diferida (no parte de este plan): script de CI que falle si una migración define `SECURITY DEFINER` sin `REVOKE` en el mismo archivo.
