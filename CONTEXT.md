# Pulsar POS — Contexto técnico del proyecto

> **Última actualización:** 23 abr 2026
> Fuente de verdad para Codex, Cursor y cualquier herramienta de IA que trabaje en este repo.
> El codebase está en inglés. Solo los labels visibles al usuario están en español.

---

## Stack

- **Frontend:** Next.js 16+ (App Router, Turbopack), TypeScript (strict), Tailwind CSS, shadcn/ui
- **Data fetching client-side:** React Query (`@tanstack/react-query`, staleTime 30s, gcTime 5min, retry 1) — provider en `providers/query-provider.tsx`
- **Backend:** Supabase (PostgreSQL + Auth + Storage + RLS), project ID: `zrnthycznbrplzpmxmkwk` (sa-east-1)
- **Deploy:** Vercel, proyecto: `pulsarpos`, repo: `github.com/sssebaguillen/POS` (master), región: `gru1 (São Paulo)`
- **IMPORTANTE:** Next.js 16+ usa `proxy.ts` en la raíz, NO `middleware.ts`
- **Plan Supabase:** FREE — no sugerir features de plan pago (ej. Leaked Password Protection)

---

## Visión del producto

Pulsar POS es un sistema SaaS multi-tenant de punto de venta para PyMEs en LATAM. El nombre tiene doble significado intencional: la acción física de pulsar (el cajero tocando la pantalla) y la estrella de neutrones. Target domain: `puls.ar`.

**Usuario objetivo:** dueño de negocio pequeño/mediano en Argentina y LATAM — almacén, kiosco, negocio de ropa, ferretería — que necesita un POS moderno sin pagar por hardware ni licencias caras.

**Modelo de negocio:** SaaS con planes (free → basic → standard → pro). El plan `free` es suficiente para negocios pequeños. Features como facturación electrónica y módulo contable son plan pago.

---

## Decisiones de arquitectura

### Multi-tenancy
- Cada negocio tiene su propio `business_id`
- Toda tabla de datos tiene `business_id` con RLS via `get_business_id()`
- Queries en Server Components siempre incluyen `.eq('business_id', businessId)` como defensa adicional además de RLS
- `profiles.id` tiene FK a `auth.users(id)` — solo el owner tiene entrada en `profiles`
- Sub-operadores viven en la tabla `operators` (sin entrada en `auth.users`)

### Autenticación del owner
- El owner autentica con Supabase Auth (email + contraseña)
- En `/operator-select`, el owner ingresa su misma contraseña de Supabase — es el "PIN" del owner
- Recuperación de contraseña: flujo PKCE vía `/auth/callback?type=recovery` → `exchangeCodeForSession` → redirect a `/auth/update-password`
- El `redirectTo` del reset debe apuntar a `/auth/callback?type=recovery` (NO a `/auth/update-password` directamente — eso activa el flujo implícito legacy con hash en lugar de PKCE con `?code=`)
- URL de callback configurada en Supabase Dashboard → Authentication → Redirect URLs: `https://pulsarpos.vercel.app/auth/callback`

### Autenticación de operadores
- Los operadores autentican con PIN de 4 o 6 dígitos hasheado con bcrypt (`pgcrypto`)
- La sesión activa se guarda en cookie httpOnly `operator_session`:
  ```json
  { "profile_id": "uuid", "name": "string", "role": "UserRole", "permissions": {...} }
  ```
- Cookie `op_perms` (non-httpOnly) — copia de permissions para lectura client-side en sidebar
- `proxy.ts` protege rutas según permisos del operador activo
- Owner identificado por `operator?.role === 'owner'` o ausencia de cookie — nunca por DB lookup en proxy
- Al registrar un nuevo usuario, el flujo llama a `/api/operator/logout` para limpiar cookies previas

### Autenticación en Server Components
- `lib/business.ts` exporta helpers:
  - `getBusinessIdByUserId(supabase, userId)` → `string | null`
  - `requireAuthenticatedBusinessId(supabase)` → `string` (throw si no hay user o businessId)
  - `requireAuthenticatedBusinessContext(supabase)` → `{ userId, businessId }`
- Preferir `requireAuthenticatedBusinessId` en pages

### Cambio de operador (post-switch)
- **SIEMPRE** usar `window.location.href = '/pos'` tras cambio de operador, NUNCA `router.push + router.refresh`
- La cookie `op_perms` es non-httpOnly y la lee el sidebar — si se usa router.push, el sidebar puede quedar con permisos stale
- Logout de operador: borra `operator_session` + `op_perms`, restaura sesión owner, redirige a `/operator-select`
- **NUNCA** en `/api/operator/logout` restaurar la sesión del owner (es vector de escalación de privilegios)

### Sidebar collapse (CLS-free)
- El estado collapsed se inicializa desde la cookie `pos-sidebar-collapsed` leída en `(app)/layout.tsx`
- Se pasa como prop `initialCollapsed` a `AppShell` — sin `useEffect` post-hydration
- Al hacer toggle: escribe `document.cookie` y `localStorage`

### Hydration (patrón mounted)
- `ThemeProvider` lee el tema de `localStorage` en el cliente. El servidor no tiene `localStorage`.
- Patrón obligatorio en componentes que lean `localStorage` para UI:
  ```typescript
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  const themeForUi = mounted ? theme : 'dark' // default SSR-safe
  ```
- Aplica en: `sidebar.tsx`, `theme.tsx` (ThemeToggle), `CatalogThemeProvider.tsx`, `CatalogView.tsx` (viewMode)

### POS — Flujo de venta
- La venta se crea atómicamente con el RPC `create_sale_transaction`
- El trigger `on_sale_item_inserted` descuenta stock automáticamente
- El carrito (`lib/store/cart.store.ts`) guarda el precio base; `calculateProductPrice` se aplica en render y checkout
- **Price override por línea:** lápiz unitario + lápiz total-de-línea con back-cálculo. `priceIsManual` en Zustand excluye el item del recálculo por lista. Visual: precio original tachado + override en acento
- `unit_price_override` + `override_reason` se persisten en `sale_items` al cerrar la venta

### Conflicto precio manual vs lista de precios
- `calculateProductPrice` usa `cost × multiplier` cuando `cost > 0`. `products.price` solo se usa como fallback cuando `cost = 0`.
- Al crear/editar un producto con precio manual: `isPriceEdited = true` siempre que el usuario edite el precio, incluso si no hay lista activa (fix de abril 2026).
- Al crear/editar una lista de precios que impacta productos con precio manual: se muestra alert amber con lista de afectados y dos opciones: sobreescribir con el margen de la lista, o crear `price_list_overrides` automáticos para respetar los precios manuales.

### Catálogo público
- URL: `/catalogo/[slug]`
- **NUNCA** queries directas a `products`/`categories` desde el cliente anon — siempre RPCs:
  - `get_catalog_products(p_slug)` — SECURITY DEFINER, `GRANT EXECUTE TO anon`
  - `get_catalog_categories(p_slug)` — SECURITY DEFINER, `GRANT EXECUTE TO anon`
- El cliente usa anon key con `persistSession: false, autoRefreshToken: false`
- `CatalogThemeProvider` aplica el `primary_color` del negocio

---

## Base de datos

### `businesses`
| columna | tipo | notas |
|---------|------|-------|
| id | uuid PK | gen_random_uuid() |
| name | text | |
| slug | text UNIQUE | formato limpio: `^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$` (3–50 chars, minúsculas/números/guiones) |
| plan | text | default 'free' |
| whatsapp | text nullable | solo números con código de país |
| logo_url | text nullable | |
| description | text nullable | visible en catálogo público |
| settings | jsonb nullable | incluye `primary_color` (hex). Mergeado con spread — nunca reemplazar el objeto completo |
| accounting_enabled | bool | default false — toggle para activar módulo contable (P10) |
| created_at | timestamptz | |

**Slug:** editado desde Settings vía RPC `update_business_slug`. La URL del catálogo público es `puls.ar/{slug}`. Los slugs con timestamp legacy no se migran automáticamente — el dueño los edita cuando quiera.

### `profiles`
| columna | tipo | notas |
|---------|------|-------|
| id | uuid PK | FK → auth.users(id) |
| business_id | uuid | FK → businesses(id) |
| name | text | |
| role | text | siempre `'owner'` |
| pin | text nullable | no usado para owner |
| avatar_url | text nullable | foto de perfil |
| created_at | timestamptz | |

**Nota:** `profiles.permissions` fue eliminado (columna obsoleta, eliminada en auditoría abril 2026). Los permisos del owner se obtienen siempre de `OWNER_PERMISSIONS` en `lib/operator.ts`.

### `operators`
| columna | tipo | notas |
|---------|------|-------|
| id | uuid PK | gen_random_uuid() |
| business_id | uuid | FK → businesses(id) |
| name | text | |
| role | text CHECK | `'manager'`, `'cashier'`, `'custom'` |
| pin | text | bcrypt hasheado via extensions.crypt() |
| permissions | jsonb | 9 campos — ver modelo de permisos |
| is_active | bool | default true |
| created_at | timestamptz | |

**Modelo de permisos (9 campos):**
| permiso | descripción | owner | manager | cashier |
|---------|-------------|-------|---------|---------|
| `sales` | Terminal de ventas | true | true | true |
| `stock` | Ver inventario | true | true | true |
| `stock_write` | Modificar inventario | true | true | false |
| `stats` | Dashboard y estadísticas | true | true | false |
| `price_lists` | Ver listas de precios | true | true | false |
| `price_lists_write` | Modificar listas de precios | true | true | false |
| `settings` | Configuración | true | false | false |
| `operators_write` | Crear/editar operadores (sub-toggle de settings) | true | false | false |
| `expenses` | Ver y cargar gastos | true | true | false |
| `price_override` | Editar precio por ítem en POS | true | true | false |

**Nota:** `operators_write` requiere `settings: true` como prerequisito — es un sub-toggle en la UI de NewOperatorModal.

`isPermissions()` valida que el objeto tenga todos los campos esperados. Al agregar un campo nuevo a `Permissions`: buscar en TODO el codebase y actualizar todos los archivos que construyen el objeto manualmente: `lib/operator.ts` (OWNER_PERMISSIONS), `sidebar.tsx`, `api/operator/switch/route.ts`, `NewOperatorModal.tsx`.

Rol `'custom'`: cualquier combinación definida por el owner via toggles en Settings.

### `brands`
| columna | tipo | notas |
|---------|------|-------|
| id | uuid PK | gen_random_uuid() |
| business_id | uuid | FK → businesses(id) ON DELETE CASCADE |
| name | text | |
| created_at | timestamptz | |

**Constraints:** `UNIQUE (business_id, name)`

### `products`
| columna | tipo | notas |
|---------|------|-------|
| id | uuid PK | |
| business_id | uuid | |
| category_id | uuid nullable | FK → categories(id) |
| brand_id | uuid nullable | FK → brands(id) ON DELETE SET NULL |
| name | text | |
| sku, barcode | text nullable | |
| price, cost | numeric | |
| stock, min_stock | int | |
| image_url | text nullable | HTTPS URL — bucket `product-images` o URL externa |
| image_source | text nullable | `'upload'` o `'url'` — CHECK constraint, ambos null o ambos non-null |
| is_active | bool | default true |
| show_in_catalog | bool | default true |
| sales_count | int nullable | |
| created_at | timestamptz | |

**Imágenes:** `image_source = 'upload'` → path en bucket `product-images` (público). `image_source = 'url'` → URL externa HTTPS. Usar `next/image` con `unoptimized={image_source === 'url'}`. Storage path: `{businessId}/{uuid}.{ext}` (nunca `product.id` — es el `businessId` el primer segmento).

### `categories`
| columna | tipo | notas |
|---------|------|-------|
| id | uuid PK | |
| business_id | uuid | |
| name | text | |
| icon | text | default '📦' |
| position | int | default 0 |
| is_active | bool | default true |
| created_at | timestamptz | |

### `price_lists`
| columna | tipo | notas |
|---------|------|-------|
| id | uuid PK | gen_random_uuid() |
| business_id | uuid | FK → businesses(id) ON DELETE CASCADE |
| name | text | |
| description | text nullable | |
| multiplier | numeric(6,4) | representa margen: 1.40 = 40% sobre costo |
| is_default | boolean | único por negocio (índice único parcial WHERE is_default = true) |
| created_at | timestamptz | |

**UI:** el usuario ingresa porcentaje (ej: 40%) — se guarda como multiplier (1.40). Conversión solo en UI, nunca en DB.

### `price_list_overrides`
| columna | tipo | notas |
|---------|------|-------|
| id | uuid PK | gen_random_uuid() |
| price_list_id | uuid | FK → price_lists(id) ON DELETE CASCADE |
| product_id | uuid nullable | FK → products(id) ON DELETE CASCADE |
| brand_id | uuid nullable | FK → brands(id) ON DELETE CASCADE |
| multiplier | numeric(6,4) | |
| created_at | timestamptz | |

**Constraints:**
- `CHECK`: override por producto O por marca, nunca ambos ni ninguno
- `UNIQUE (price_list_id, product_id)`
- `UNIQUE (price_list_id, brand_id)`

**Lógica de precio en runtime:**
```
precio_final = unit_price_override ?? cost × (override_producto ?? override_marca ?? lista.multiplier)
```
Si `cost = 0` y `price > 0`, se usa `price` directamente. `calculateProductPrice` en `lib/price-lists.ts` es la única fuente de verdad — nunca calcular precio inline en componentes.

### `sales`
Estructura estándar + `price_list_id uuid nullable` FK → price_lists(id) ON DELETE SET NULL + `operator_id uuid nullable` FK → operators(id) + `status text CHECK ('pending','completed','cancelled')`.

**CHECK constraints:** `status IN ('pending','completed','cancelled')` aplicado en auditoría abril 2026.

### `sale_items`
| columna | tipo | notas |
|---------|------|-------|
| id | uuid PK | |
| sale_id | uuid | FK → sales(id) |
| product_id | uuid | FK → products(id) |
| quantity | int | |
| unit_price | numeric | precio calculado al momento de la venta |
| unit_price_override | numeric nullable | precio editado manualmente en POS |
| override_reason | text nullable | motivo del override (texto libre) |
| total | numeric | |
| created_at | timestamptz | |

### `payments`
Estructura estándar. `method text CHECK ('cash','card','transfer','mercadopago','credit','otro')` + `status text CHECK ('pending','completed','failed')`. CHECK constraints aplicados en auditoría abril 2026.

### `inventory_movements`
| columna | tipo | notas |
|---------|------|-------|
| id | uuid PK | |
| business_id | uuid | |
| product_id | uuid | |
| type | text CHECK | `'sale'`, `'adjustment'`, `'purchase'`, `'return'` |
| quantity | int | |
| created_by_operator | uuid nullable | FK → operators(id) — campo activo |
| created_by | uuid nullable | legacy — sin FK activa (M-3, deferred) |
| created_at | timestamptz | |

### `cash_sessions`
| columna | tipo | notas |
|---------|------|-------|
| id | uuid PK | |
| business_id | uuid | |
| opened_by | uuid nullable | FK → profiles(id) — debería ser → operators (G-3, deferred) |
| closed_by | uuid nullable | FK → profiles(id) |
| opening_amount | numeric | |
| closing_amount | numeric nullable | |
| expected_amount | numeric nullable | |
| difference | numeric nullable | |
| opened_at | timestamptz | |
| closed_at | timestamptz nullable | |
| status | text | `'open'`, `'closed'` |

**Nota:** G-3 pendiente — `opened_by` debería apuntar a `operators` no a `profiles`. Se resuelve junto con la implementación de la UI de caja (P8a).

### `customers`
Campos: `name`, `phone`, `email`, `dni`, `credit_balance`, `tax_type nullable`, `notes`.

### `suppliers`
| columna | tipo | notas |
|---------|------|-------|
| id | uuid PK | gen_random_uuid() |
| business_id | uuid | FK → businesses(id) ON DELETE CASCADE |
| name | text | |
| contact_name | text nullable | |
| phone | text nullable | |
| email | text nullable | |
| address | text nullable | |
| notes | text nullable | |
| is_active | bool | default true |
| created_at | timestamptz | |

### `expenses`
| columna | tipo | notas |
|---------|------|-------|
| id | uuid PK | gen_random_uuid() |
| business_id | uuid | FK → businesses(id) ON DELETE CASCADE |
| operator_id | uuid nullable | FK → operators(id) ON DELETE SET NULL |
| supplier_id | uuid nullable | FK → suppliers(id) ON DELETE SET NULL |
| category | expense_category ENUM | 'mercaderia','alquiler','servicios','seguros','proveedores','sueldos','otro' |
| amount | numeric | CHECK > 0 |
| description | text | |
| date | date | default CURRENT_DATE |
| attachment_url | text nullable | path en bucket `expense-receipts` |
| attachment_type | expense_attachment_type ENUM nullable | 'image','pdf','spreadsheet','other' |
| attachment_name | text nullable | |
| notes | text nullable | |
| created_at | timestamptz | |
| updated_at | timestamptz | trigger automático |

**Storage bucket:** `expense-receipts` — privado, 10MB máx, acepta jpg/png/webp/gif/pdf/xls/xlsx/csv. Path: `{business_id}/{uuid}.{ext}`. RLS: `(storage.foldername(name))[1] = (get_business_id())::text`.

### `invoices`
| columna | tipo | notas |
|---------|------|-------|
| id | uuid PK | |
| business_id | uuid | |
| sale_id | uuid | FK → sales(id) |
| provider | text | proveedor de facturación (ej: 'facturama', 'alegra') |
| external_id | text | ID en el proveedor externo |
| status | text | estado de la factura |
| pdf_url | text nullable | URL del PDF de la factura |
| created_at | timestamptz | |

---

## Funciones SQL

Todas tienen `SECURITY DEFINER` y `set search_path = public, extensions`.

| función | descripción |
|---------|-------------|
| `bootstrap_new_user(p_user_id, p_business_name, p_user_name)` | Crea businesses + profiles con permisos completos de owner |
| `get_business_id()` | STABLE + SECURITY DEFINER + `(select auth.uid())` — usada en RLS. Cacheable por query |
| `create_sale_transaction(...)` | Inserta sale + sale_items + payments atómicamente. Stock descontado por trigger |
| `update_sale(p_sale_id, p_business_id, ...)` | Actualiza venta: revierte stock manualmente, DELETE items, INSERT nuevos (trigger descuenta). Llama `reconcile_sales_count` al final |
| `delete_sale(p_sale_id, p_business_id)` | Elimina venta y revierte stock |
| `get_sale_detail(p_sale_id, p_business_id)` | Detalle completo de venta con items y pagos |
| `reconcile_sales_count(p_business_id)` | Recalcula `sales_count` desde `sale_items JOIN sales` — llamada al final de `update_sale` como salvaguarda |
| `create_operator(p_business_id, p_name, p_role, p_pin, p_permissions?)` | Inserta operador con PIN bcrypt. Retorna `{ success, operator_id?, error? }` |
| `update_operator(p_operator_id, p_business_id, p_name, p_role, p_permissions)` | Actualiza operador existente. Retorna `{ success, error? }` |
| `verify_operator_pin(p_business_id, p_operator_id, p_pin)` | Verifica PIN. Retorna `{ success, profile_id?, name?, role?, permissions?, error? }` |
| `get_operator_stats(p_business_id, p_operator_id, p_date_from?, p_date_to?)` | Stats de ventas de un operador sub-usuario |
| `get_owner_stats(p_business_id, p_date_from?, p_date_to?)` | Stats de ventas del owner (misma forma que get_operator_stats) |
| `swap_default_price_list(p_price_list_id, p_business_id)` | Swap atómico de lista default |
| `update_business_slug(p_slug TEXT)` | Valida formato + unicidad, actualiza `businesses.slug`. Lanza excepción en español si falla. `GRANT EXECUTE TO authenticated` |
| `update_stock_on_sale()` | Trigger que descuenta stock al insertar en sale_items |
| `create_category_guarded(p_operator_id, p_business_id, p_name, p_icon)` | Crea categoría verificando `stock_write` |
| `create_brand_guarded(p_operator_id, p_business_id, p_name)` | Crea marca verificando `stock_write` |
| `get_business_balance(p_business_id, p_from?, p_to?)` | → `{ income, expenses, profit, margin, by_category, period_from, period_to }` |
| `get_expenses_list(p_business_id, p_from?, p_to?, p_category?, p_limit?, p_offset?)` | → `{ data: Expense[], total }` |
| `create_expense(p_business_id, p_category, p_amount, p_description, ...)` | → `{ success, id }` |
| `delete_expense(p_business_id, p_expense_id)` | → `{ success }` |
| `get_stats_kpis(p_business_id, p_from?, p_to?)` | KPIs con `total_units`, `peak_day`, `day_of_week` |
| `get_stats_evolution(p_business_id, p_from?, p_to?)` | Evolución de ventas con prev_period overlay |
| `get_stats_breakdown(p_business_id, p_from?, p_to?)` | Breakdown por categoría y marca |
| `get_top_products_detail(p_business_id, p_from?, p_to?, p_limit?, p_offset?)` | → `{ data: ProductSalesDetail[], total }` |
| `get_sales_by_category_detail(p_business_id, p_from?, p_to?, p_limit?, p_offset?)` | → `{ data: CategorySalesDetail[], total }` |
| `get_sales_by_payment_detail(p_business_id, p_from?, p_to?)` | → `{ data: PaymentMethodDetail[] }` |
| `get_sales_by_operator_detail(p_business_id, p_from?, p_to?)` | → `{ data: OperatorSalesDetail[] }` |
| `bulk_delete_products(p_business_id, p_ids uuid[])` | Elimina productos en bloque con guard de business_id |
| `bulk_set_product_status(p_business_id, p_ids uuid[], p_status text)` | Activa/discontinúa productos en bloque |
| `bulk_update_product_category(p_business_id, p_ids uuid[], p_category_id uuid)` | Cambia categoría en bloque |
| `bulk_update_product_brand(p_business_id, p_ids uuid[], p_brand_id uuid)` | Cambia marca en bloque |
| `undo_import(p_business_id, p_ids uuid[])` | Wrapper de bulk_delete con guard: IDs deben pertenecer al business_id y tener `created_at < 10min` |
| `get_catalog_products(p_slug)` | Productos del catálogo público (SECURITY DEFINER, anon) |
| `get_catalog_categories(p_slug)` | Categorías del catálogo público (SECURITY DEFINER, anon) |

**IMPORTANTE:**
- `create_operator` y `update_operator` retornan JSON — siempre chequear `data.success`, no solo `error`
- RPCs de stats/gastos retornan wrapper `{ data: [...] }` — siempre extraer `.data`:
  ```ts
  const { data: rpcResult } = await supabase.rpc('get_top_products_detail', { ... })
  const rows = (rpcResult as unknown as { data: RowType[] } | null)?.data ?? []
  ```
- Funciones con bcrypt: `set search_path = public, extensions` y llamar `extensions.crypt()` / `extensions.gen_salt()` — sin el search_path, PostgreSQL no encuentra las funciones de pgcrypto

---

## Estado de auditoría DB (abril 2026)

### Resueltos ✅
- **G-1** `payments.method` + `payments.status` → CHECK constraints aplicados
- **G-2** `sales.status`, `operators.role`, `profiles.role`, `inventory_movements.type` → CHECK constraints aplicados
- **G-4** `profiles.permissions` JSONB obsoleto → columna eliminada
- **C-1** `update_sale` bug doble stock → resuelto (revert manual + DELETE + INSERT + trigger)
- **C-2** `expense-receipts` Storage RLS → 9 políticas con path guard `get_business_id()`
- **C-3** `reconcile_sales_count` RPC creada y llamada al final de `update_sale`
- **M-2** Overload viejo de `create_operator` (4 permisos) eliminado
- **M-4** Índices de analytics añadidos
- **N-1** Normalización de naming de índices a `idx_tabla_columna`
- **N-3** `businesses.settings` COMMENT documentado

### Pendientes (no críticos para beta) ⏳
- **G-3** `cash_sessions.opened_by` → apunta a `profiles` pero debería apuntar a `operators`. Se resuelve junto con P8a (UI de caja)
- **M-3** `inventory_movements.created_by` sin FK activa + trigger no la popula. Deferred

---

## Rutas de la app

| ruta | descripción | protección |
|------|-------------|------------|
| `/login` | Login | pública |
| `/register` | Registro | pública |
| `/auth/callback` | Handler PKCE — exchangeCodeForSession | pública |
| `/auth/update-password` | Formulario de nueva contraseña | pública (sesión establecida por callback) |
| `/catalogo/[slug]` | Catálogo público | pública (anon, usa RPCs) |
| `/operator-select` | Selección de operador | requiere Supabase session |
| `/pos` | Terminal de ventas | cualquier operador activo |
| `/inventory` | Inventario (lectura) | `permissions.stock === true` |
| `/products` | Inventario (escritura) | `permissions.stock_write === true` |
| `/price-lists` | Listas de precios | `permissions.price_lists === true` |
| `/dashboard` | KPIs dashboard | `permissions.stats === true` |
| `/stats` | Estadísticas | `permissions.stats === true` |
| `/stats/top-products` | Detalle top productos | `permissions.stats === true` |
| `/stats/breakdown` | Detalle por categoría/marca | `permissions.stats === true` |
| `/stats/payment-methods` | Detalle métodos de pago | `permissions.stats === true` |
| `/stats/operators` | Detalle por operador | `permissions.stats === true` |
| `/expenses` | Módulo de gastos y proveedores | `permissions.expenses === true` |
| `/profile` | Perfil del owner (email, contraseña) | solo owner |
| `/operator/me` | Perfil personal del operador activo | cualquier operador (owner incluido) |
| `/settings` | Configuración del negocio + operadores | `permissions.settings === true` |

**Edge Runtime** (`export const runtime = 'edge'`): `/pos`, `/dashboard`, `/stats`, `/operator-select`

**Nota:** Guard `/stock` en `proxy.ts` es dead code — la ruta real es `/inventory`. Eliminar en próximo cleanup.

---

## Estructura del sidebar

```
VENTAS
  Vender → /pos

ANÁLISIS
  Dashboard → /dashboard (requires stats)
  Estadísticas → /stats (requires stats)

FINANZAS
  Gastos → /expenses (requires expenses)

GESTIÓN
  Stock → /inventory (requires stock)
  Listas de precios → /price-lists (requires price_lists)

SISTEMA
  Configuración → /settings (requires settings)
```

El sidebar muestra el nombre del negocio en el título (desde el profile del operador activo). Owner tiene chip de perfil con popover (igual que los operadores) + acceso a cierre de sesión completa.

---

## Archivos clave

```
src/
├── proxy.ts                              # Protección de rutas + CSP (nonce) + cookies
├── providers/
│   └── query-provider.tsx                # React Query (staleTime 30s, gcTime 5min, retry 1)
├── lib/
│   ├── business.ts                       # getBusinessIdByUserId, requireAuthenticatedBusinessId
│   ├── operator.ts                       # UserRole, Permissions (9+1 campos), OWNER_PERMISSIONS, getActiveOperator()
│   ├── payments.ts                       # normalizePayment, PAYMENT_LABELS, PAYMENT_COLORS, PAYMENT_OPTIONS
│   ├── price-lists.ts                    # calculateProductPrice — única fuente de verdad de precios
│   ├── date-utils.ts                     # DateRangePeriod, getDateRange, resolveDateRange, buildDateParams
│   ├── format.ts                         # formatMoney, formatNumber
│   ├── mappers.ts                        # normalizePriceList, unwrapRelation
│   ├── validation.ts                     # validateImageUrl, BUSINESS_SLUG_REGEX
│   ├── utils.ts                          # cn() y utilidades generales
│   ├── constants/
│   │   └── domain.ts                     # Typed role values, constantes de dominio (DB en inglés, UI en español)
│   ├── store/
│   │   └── cart.store.ts                 # Estado del carrito POS (Zustand)
│   ├── printer/
│   │   ├── escpos.ts                     # Generación de comandos ESC/POS
│   │   ├── receipt.ts                    # Lógica de impresión de tickets
│   │   └── types.ts
│   ├── types/
│   │   └── index.ts                      # Tipos centrales
│   └── supabase/
│       ├── client.ts
│       └── server.ts
├── app/
│   ├── (auth)/
│   │   ├── login/page.tsx
│   │   └── register/page.tsx
│   ├── auth/
│   │   ├── callback/route.ts             # PKCE: exchangeCodeForSession → redirect según type
│   │   └── update-password/page.tsx      # Formulario nueva contraseña (sesión ya establecida)
│   ├── (app)/
│   │   ├── layout.tsx                    # Cookie collapsed → AppShell, theme, QueryProvider, FlashToast
│   │   ├── operator-select/page.tsx      # edge — selección de operador con PIN
│   │   ├── settings/page.tsx             # requireAuthenticatedBusinessId + error.tsx + loading.tsx
│   │   ├── inventory/page.tsx
│   │   ├── products/page.tsx
│   │   ├── price-lists/page.tsx
│   │   ├── dashboard/page.tsx            # edge — denormaliza operator_name + product names para SalesHistoryTable
│   │   ├── expenses/page.tsx
│   │   ├── stats/page.tsx                # edge
│   │   ├── stats/top-products/page.tsx
│   │   ├── stats/breakdown/page.tsx
│   │   ├── stats/payment-methods/page.tsx
│   │   ├── stats/operators/page.tsx
│   │   ├── profile/page.tsx              # Solo owner
│   │   ├── operator/me/page.tsx          # Perfil personal del operador activo
│   │   └── pos/page.tsx                  # edge
│   ├── api/operator/
│   │   ├── switch/route.ts               # Escribe operator_session + op_perms (10 permisos)
│   │   └── logout/route.ts              # Solo borra cookies — NUNCA restaura sesión owner
│   └── catalogo/
│       ├── layout.tsx                    # CatalogThemeProvider wrapper
│       └── [slug]/page.tsx
└── components/
    ├── shared/
    │   ├── AppShell.tsx                  # Layout shell con SidebarContext
    │   ├── FlashToast.tsx                # Toast desde cookie flash_toast (maxAge 5s)
    │   ├── PageHeader.tsx                # breadcrumbs?: { label: string; href: string }[]
    │   ├── DateRangeFilter.tsx           # hoy/semana/mes/trimestre/año/personalizado
    │   ├── ExportCSVButton.tsx
    │   ├── KPICard.tsx
    │   ├── ConfirmModal.tsx
    │   ├── Toast.tsx                     # Toast imperativo (separado de FlashToast)
    │   └── theme.tsx                     # useTheme hook (patrón mounted para SSR)
    ├── ui/                               # Primitivos shadcn/ui
    │   ├── SelectDropdown.tsx            # Reemplaza todos los <select> nativos
    │   └── ...
    ├── auth/
    │   └── UpdatePasswordView.tsx        # Form nueva contraseña — NO usa onAuthStateChange
    ├── sidebar.tsx                       # 5 secciones semánticas. Patrón mounted para ThemeToggle
    ├── pos/
    │   ├── POSView.tsx
    │   ├── ProductPanel.tsx
    │   ├── CartPanel.tsx                 # Price override por línea + EditSalePanel embebido
    │   ├── PaymentModal.tsx
    │   ├── ReceiptPreviewModal.tsx
    │   ├── ReceiptTemplate.tsx
    │   └── types.ts
    ├── operator/
    │   ├── OperatorSelectView.tsx        # Botón forgot password (cuando isOwnerSelected && error)
    │   └── OperatorSwitcher.tsx
    ├── dashboard/
    │   ├── DashboardView.tsx             # ⚠️ ubicado en analytics/ — mover a dashboard/ (deuda técnica)
    │   ├── SalesHistoryTable.tsx         # Filtro 100% en memoria — datos denormalizados desde page.tsx
    │   ├── BalanceWidget.tsx
    │   └── utils.ts
    ├── stats/
    │   ├── StatsView.tsx                 # ⚠️ ubicado en analytics/ — mover a stats/ (deuda técnica)
    │   ├── TopProductsDetailView.tsx
    │   ├── BreakdownDetailView.tsx
    │   ├── PaymentMethodDetailView.tsx
    │   └── OperatorSalesDetailView.tsx
    ├── inventory/
    │   ├── InventoryPanel.tsx            # ~1291 líneas — refactor pendiente post-beta
    │   ├── NewProductModal.tsx
    │   ├── EditProductModal.tsx
    │   ├── ImportProductsModal.tsx
    │   ├── BulkActionBar.tsx             # Acciones en bloque (delete, status, category, brand)
    │   ├── FilterSidebar.tsx
    │   ├── FieldGroup.tsx
    │   ├── CategoryModal.tsx
    │   ├── BrandModal.tsx
    │   └── types.ts
    ├── products/
    │   └── ProductsPanel.tsx             # ⚠️ probablemente abandonado vs InventoryPanel
    ├── price-lists/
    │   ├── PriceListsPanel.tsx
    │   ├── NewPriceListModal.tsx         # Alert de conflicto con precios manuales
    │   ├── EditPriceListModal.tsx        # Ídem — detecta afectados sin override manual previo
    │   ├── ProductOverrideModal.tsx
    │   └── BrandOverrideModal.tsx
    ├── expenses/
    │   ├── types.ts
    │   ├── ExpensesView.tsx
    │   ├── NewExpensePanel.tsx
    │   ├── ExpenseSummaryCards.tsx
    │   ├── ExpensesTable.tsx
    │   ├── ExpenseAttachmentUploader.tsx
    │   ├── ExpenseAttachmentModal.tsx
    │   ├── SupplierSelectDropdown.tsx
    │   └── SuppliersPanel.tsx
    ├── settings/
    │   ├── SettingsForm.tsx              # Input de slug con preview puls.ar/{slug} + validación client-side
    │   ├── OperatorList.tsx
    │   ├── NewOperatorModal.tsx          # 9+1 toggles de permisos
    │   ├── EditOperatorModal.tsx         # Editar operador existente
    │   └── types.ts
    ├── profile/
    │   └── ProfileView.tsx
    ├── operator-profile/
    │   └── OperatorProfileView.tsx       # Perfil personal del operador (/operator/me)
    └── catalog/
        ├── CatalogView.tsx              # viewMode inicializa en 'grid' (SSR-safe), useEffect lee localStorage
        ├── CatalogHeader.tsx
        ├── ProductGrid.tsx
        ├── CartPanel.tsx
        ├── CatalogThemeProvider.tsx
        └── types.ts
```

---

## Tipos centrales (`lib/types/index.ts`)

```ts
UserRole = 'owner' | 'manager' | 'cashier' | 'custom'
Plan = 'free' | 'basic' | 'standard' | 'pro'

// Permisos
Permissions {
  sales: boolean
  stock: boolean
  stock_write: boolean
  stats: boolean
  price_lists: boolean
  price_lists_write: boolean
  settings: boolean
  operators_write: boolean
  expenses: boolean
  price_override: boolean
}

// Entidades principales
Business, Profile, Category, Product, Customer, CashSession
Sale, SaleItem, Payment, PriceList, PriceListOverride
Supplier, Expense

// Stats (respuestas de RPCs)
StatsKpis, StatsEvolution, StatsEvolutionPoint
StatsBreakdown, StatsBreakdownCategory, StatsBreakdownBrand
StatsBreakdownPayment, StatsBreakdownOperator, DayOfWeekEntry

// Client-side
CartItem { product, quantity, unit_price, total, priceIsManual? }
```

---

## Design system

- **Background:** CSS var `--background`, **Surface:** CSS var `--surface`, **Primary:** `#1C4A3B` (dark green, customizable via `businesses.settings.primary_color`)
- **Tipografía:** DM Sans — 7 clases semánticas en `globals.css`: `.text-display`, `.text-heading`, `.text-subheading`, `.text-body`, `.text-caption`, `.text-label`, `.text-metric`. Custom properties: `--body-secondary`, `--support`
- Theme: light/dark toggle via `useTheme` hook — patrón `mounted` obligatorio para evitar hydration mismatch
- Cards: `rounded-xl` / `rounded-2xl`, border sutil, clase `surface-card`
- Dropdowns/popovers: clase `surface-elevated`
- Sidebar: clase `surface-sidebar`
- Filter chips: `pill-tabs` (container) / `pill-tab` (inactive) / `pill-tab-active` (active) — usar en TODOS los filtros
- **Sin** `backdrop-filter` ni `backdrop-blur`
- Iconos: lucide-react · Charts: recharts
- Sin emojis en código · Sin valores hardcodeados · Sin tipos `any`
- Named interfaces para todas las props

**Excepción documentada:** filter chips del POS (categoría/marca en `ProductPanel`) usan estilo propio intencional (`rounded-full`, `bg-primary` activo) — no usar `pill-tab` allí.

### Breadcrumbs
`PageHeader` acepta `breadcrumbs?: { label: string; href: string }[]`. Requerido en sub-rutas. No usar en rutas top-level.

| Route | breadcrumbs | title |
|---|---|---|
| `/stats/top-products` | `[{ label: 'Estadísticas', href: '/stats' }]` | Top productos |
| `/stats/breakdown` | `[{ label: 'Estadísticas', href: '/stats' }]` | Breakdown |
| `/stats/payment-methods` | `[{ label: 'Estadísticas', href: '/stats' }]` | Métodos de pago |
| `/stats/operators` | `[{ label: 'Estadísticas', href: '/stats' }]` | Operadores |

---

## Flash toast system

- `proxy.ts` setea cookie `flash_toast=no-access` (maxAge 5s, non-httpOnly) al redirigir por falta de permisos
- `app/(app)/layout.tsx` la lee server-side y la pasa al componente `FlashToast`
- Toast imperativo separado: `useToast.ts` + `Toast.tsx`

---

## Roadmap

| Sprint | Feature | Estado |
|--------|---------|--------|
| P0 | Prototipo estático (De Todo Sin TACC) | ✅ Done |
| P1 | Fundación técnica — stack, DB, auth | ✅ Done |
| P2 | POS funcional básico | ✅ Done |
| P3 | Gestión de inventario | ✅ Done |
| P4 | Operadores + PIN + permisos | ✅ Done |
| P5 | Listas de precios + marcas | ✅ Done |
| P6 | Permisos expandidos (8 campos) + UX base | ✅ Done |
| P7a | Optimización, seguridad, hardening | ✅ Done |
| P7b | Barcode + impresora térmica | ✅ Done |
| P7d | Price override por línea en POS | ✅ Done |
| P7e | Selección múltiple + acciones en bloque en /inventory | ✅ Done |
| P7 (OPS) | Editar operador + /operator/me + sidebar refactor | ✅ Done |
| Post-P7 | Fix SalesHistoryTable búsqueda (denormalización servidor) | ✅ Done |
| Post-P7 | Recuperación de contraseña (PKCE flow) | ✅ Done |
| Post-P7 | Fix conflicto precio manual vs lista de precios | ✅ Done |
| Post-P7 | business_name slug limpio + constraints + RPC | ✅ Done |
| Post-P7 | Fixes hydration (ThemeToggle, CatalogView viewMode) | ✅ Done |
| **P8a** | **Módulo de caja (cash_sessions UI + RPCs)** | 🔄 Next |
| **P8b** | **Centro de notificaciones + Undo import (P7f carry-over)** | 🔄 Next |
| P8 (carry-over) | Cierre de caja imprimible (CashCloseTemplate) | ⏳ Pending |
| P9 | Ingreso de stock / Órdenes de compra | 📋 Planned |
| P10 | Módulo contable + capa fiscal + facturación | 📋 Planned |
| P11 | Analytics avanzados | 📋 Planned |
| P12 | IA proactiva (Haiku análisis rutinario → Sonnet anomalías) | 📋 Planned |

### P8a — Módulo de caja (próximo)
- RPCs: `open_cash_session`, `close_cash_session`, `get_current_session`, `get_session_summary`
- UI: modal apertura (monto inicial), cierre (conteo efectivo real vs esperado, diferencia)
- Indicador de sesión activa en sidebar
- `CashCloseTemplate.tsx` — resumen imprimible del turno
- Resolver G-3 (FK `opened_by` → `operators`) junto con esta implementación

### P8b — Centro de notificaciones (carry-over P7f)
- Zustand store `notifications` con tipos: `undo_action`, `alert`, `info`
- Icono en navbar, dropdown con lista + timestamp relativo + botón de acción
- Timer 10 min para acciones undo — al vencer, botón se deshabilita
- Primera integración: `ImportProductsModal` al completar importación masiva
- RPC `undo_import` con guard `created_at < 10min`

### P9 — Ingreso de stock / Compras (planned)
- Flujo rápido desde `/gastos` para compras al contado
- Módulo completo `/compras` con tabla `purchase_orders` y estados
- RPC `register_stock_purchase` atómico — egreso financiero + ingreso de stock
- Tabla `expense_items` para líneas de compra
- `inventory_movements` con `source_type` + `source_id` para trazabilidad
- Separación ingresos/egresos operativos/compras de mercadería en stats

### P10 — Módulo contable (planned)
- Toggle `accounting_enabled` en `businesses` (ya existe la columna)
- Tabla `invoices` (ya existe en schema)
- Integraciones con Facturama/Alegra como intermediarios
- Audit log (`audit_log` table) como prerequisito
- Solo visible en plans superiores a free

---

## Deuda técnica conocida

### Componentes a mover/limpiar
- `DashboardView.tsx` + `StatsView.tsx` en `analytics/` → mover a `dashboard/` y `stats/`
- `ProductsPanel.tsx` (294L) probablemente abandonado → verificar y eliminar
- `components/sales/` directorio vacío → eliminar

### Refactors pendientes (post-beta)
- `InventoryPanel.tsx` (~1291 líneas, 5 componentes embebidos) → extraer componentes
- `CartPanel.tsx` (`EditSalePanel` embebido, ~920 líneas total) → separar
- `formatMoney` duplicado en 3 archivos (PaymentModal, ReceiptPreviewModal, ReceiptTemplate) → mover a `lib/utils.ts`
- `validateImageUrl` duplicado en NewProductModal + EditProductModal → extraer
- `FieldGroup` duplicado en ambos modales
- `DateRangeFilter.tsx`: `QUARTER_RANGES` con año bakeado al cargar el módulo → corregir
- Warnings Radix UI: `DialogContent` requiere `DialogTitle` → agregar `<VisuallyHidden><DialogTitle>` en todos los modales

### Anti-patrones menores
- `useEffect` para data fetching del historial en `CartPanel` (antes de React Query, no migrado)
- Prop `categories` en `POSView.tsx` declarada pero nunca usada (dead code)
- `!` assertions en env vars de Supabase (`client.ts`, `server.ts`)
- `CartItem` (client-only) mezclado con tipos de servidor en `lib/types/index.ts`
- `theme.tsx`: FOUC por `localStorage` post-hydration — debería usar cookie como sidebar
- `settings/page.tsx`: auth pattern inconsistente — único page con `getUser()` + try/catch en lugar de `requireAuthenticatedBusinessId`
- Guard `/stock` en `proxy.ts` es dead code (ruta real es `/inventory`)
- `operator-select/page.tsx`: `role` como unión literal manual en lugar de `Exclude<UserRole, 'owner'>`

---

## Reglas críticas (para Codex / Cursor)

1. Usar `proxy.ts` en la raíz, **NUNCA** `middleware.ts`
2. El `business_id` siempre viene de `profiles.business_id` — nunca se infiere de otros datos
3. Queries en Server Components siempre incluyen `.eq('business_id', businessId)` además de confiar en RLS
4. Las funciones SQL con bcrypt deben tener `set search_path = public, extensions` y usar `extensions.crypt()` / `extensions.gen_salt()`
5. `create_operator` y `update_operator` retornan JSON — chequear `data.success`, no solo `error`
6. Operadores sub-usuarios viven en `operators`. El owner **solo** en `profiles`. El owner **NUNCA** tiene entrada en `operators`
7. Cookie `operator_session`: httpOnly, sameSite: lax, secure en producción
8. Owner identificado en proxy por `operator?.role === 'owner'` o ausencia de cookie — nunca por DB lookup
9. `OWNER_PERMISSIONS` definido en `lib/operator.ts` — importado en todas partes, nunca duplicado
10. `UserRole = 'owner' | 'manager' | 'cashier' | 'custom'` — exportado de `lib/types/index.ts`, re-exportado desde `lib/operator.ts`
11. El precio final siempre se calcula con `calculateProductPrice` de `lib/price-lists.ts` — nunca inline
12. `normalizePayment`, `PAYMENT_LABELS`, `PAYMENT_COLORS` viven en `lib/payments.ts` — nunca duplicados
13. `createClient()` siempre dentro de `useMemo(() => createClient(), [])` en Client Components
14. Queries independientes en Server Components siempre con `Promise.all`
15. RPCs que retornan `{ data: [...] }` — siempre extraer `.data`, nunca iterar el wrapper
16. Al agregar un campo a `Permissions`: actualizar `lib/operator.ts` (OWNER_PERMISSIONS), `sidebar.tsx`, `api/operator/switch/route.ts`, `NewOperatorModal.tsx` — en el mismo commit
17. Filter chips: siempre `pill-tabs` / `pill-tab` / `pill-tab-active` (excepción: POS ProductPanel)
18. Sidebar collapsed: inicializar desde cookie `pos-sidebar-collapsed` en Server Component — nunca con `useEffect` post-hydration
19. Preferir `requireAuthenticatedBusinessId(supabase)` en pages
20. Logout route (`/api/operator/logout`) solo borra cookies — **NUNCA** restaura sesión owner
21. Rutas de stats en inglés: `/stats/payment-methods`, `/stats/operators`, `/stats/breakdown`, `/stats/top-products`
22. Catálogo público: **NUNCA** queries directas a `products`/`categories` — usar RPCs `get_catalog_products`/`get_catalog_categories`
23. Post-switch de operador: **SIEMPRE** `window.location.href`, **NUNCA** `router.push + router.refresh`
24. `businesses.settings` JSONB: siempre mergear con spread — nunca reemplazar el objeto completo
25. Storage path de imágenes de productos: `{businessId}/{uuid}.{ext}` — el primer segmento es el `businessId`, no el `product.id`
26. Flujo PKCE de recuperación: `redirectTo` debe apuntar a `/auth/callback?type=recovery`, no a la página de update-password directamente
27. Componentes que lean `localStorage` para UI deben usar el patrón `mounted` para evitar hydration mismatch
28. `BUSINESS_SLUG_REGEX = /^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/` para validación client-side del slug antes de llamar la RPC
29. No usar `backdrop-filter`, `backdrop-blur`, ni efectos de glass en ningún componente
30. Sin `<form>` HTML en React — usar handlers (`onClick`, `onChange`) para todas las interacciones de formulario
