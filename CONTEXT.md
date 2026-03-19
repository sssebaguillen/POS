# Pulsar POS — Contexto técnico del proyecto

## Stack

- **Frontend:** Next.js 16+ (App Router), TypeScript (strict), Tailwind CSS, shadcn/ui
- **Backend:** Supabase (PostgreSQL + Auth + RLS), project ID: `zrnthcznbrplzpmxmkwk` (sa-east-1)
- **Deploy:** Vercel, proyecto: `pulsarpos`, repo: `github.com/sssebaguillen/POS` (master), región: `gru1 (São Paulo)`
- **IMPORTANTE:** Next.js 16+ usa `proxy.ts` en la raíz, NO `middleware.ts`

---

## Decisiones de arquitectura

### Multi-tenancy
- Cada negocio tiene su propio `business_id`
- Toda tabla de datos tiene `business_id` con RLS via `get_business_id()`
- Queries en Server Components siempre incluyen `.eq('business_id', businessId)` como defensa adicional además de RLS
- `profiles.id` tiene FK a `auth.users(id)` — solo el owner tiene entrada en `profiles`
- Sub-operadores viven en la tabla `operators` (sin entrada en `auth.users`)

### Autenticación de operadores
- El owner autentica con Supabase Auth (email + contraseña)
- Los operadores autentican con PIN de 4 o 6 dígitos hasheado con bcrypt (`pgcrypto`)
- La sesión activa se guarda en cookie httpOnly `operator_session`:
  ```json
  { "profile_id": "uuid", "name": "string", "role": "UserRole", "permissions": {...} }
  ```
- Cookie `op_perms` (non-httpOnly) — copia de permissions para lectura client-side en sidebar
- `proxy.ts` protege rutas según permisos del operador activo
- Owner identificado por `operator?.role === 'owner'` o ausencia de cookie — nunca por DB lookup en proxy
- Al registrar un nuevo usuario, el flujo llama a `/api/operator/logout` para limpiar cookies previas

### Sidebar collapse (CLS-free)
- El estado collapsed del sidebar se inicializa desde la cookie `pos-sidebar-collapsed` leída en el Server Component `(app)/layout.tsx`
- Se pasa como prop `initialCollapsed` a `AppShell` — sin `useEffect` post-hydration que cause layout shift
- Al hacer toggle: escribe tanto `document.cookie` como `localStorage`

### Pantalla de selección de operador (`/operator-select`)
- Muestra tarjeta "Administrador" (owner) al tope — autentica con contraseña de Supabase
- Muestra tarjetas de operadores PIN debajo — incluye rol `'custom'`
- Al cambiar de operador: botón en sidebar → logout route borra cookies y restaura sesión owner → redirige a `/operator-select`

---

## Base de datos

### `businesses`
| columna | tipo | notas |
|---------|------|-------|
| id | uuid PK | gen_random_uuid() |
| name | text | |
| slug | text UNIQUE | formato: `nombre-timestamp` |
| plan | text | default 'free' |
| whatsapp | text nullable | solo números con código de país |
| logo_url | text nullable | |
| description | text nullable | visible en catálogo público |
| settings | jsonb nullable | |
| created_at | timestamptz | |

### `profiles`
| columna | tipo | notas |
|---------|------|-------|
| id | uuid PK | FK → auth.users(id) |
| business_id | uuid | FK → businesses(id) |
| name | text | |
| role | text | siempre `'owner'` |
| pin | text nullable | no usado para owner |
| permissions | jsonb | todos los permisos en true |
| avatar_url | text nullable | foto de perfil (upload futuro) |
| created_at | timestamptz | |

### `operators`
| columna | tipo | notas |
|---------|------|-------|
| id | uuid PK | gen_random_uuid() |
| business_id | uuid | FK → businesses(id) |
| name | text | |
| role | text | `'manager'`, `'cashier'`, o `'custom'` |
| pin | text | bcrypt hasheado via extensions.crypt() |
| permissions | jsonb | 8 campos — ver modelo de permisos |
| is_active | bool | default true |
| created_at | timestamptz | |

**Modelo de permisos (8 campos):**
| permiso | descripción | owner | manager | cashier |
|---------|-------------|-------|---------|---------|
| `sales` | Terminal de ventas | true | true | true |
| `stock` | Ver inventario | true | true | true |
| `stock_write` | Modificar inventario | true | true | false |
| `stats` | Dashboard y estadísticas | true | true | false |
| `price_lists` | Ver listas de precios | true | true | false |
| `price_lists_write` | Modificar listas de precios | true | true | false |
| `settings` | Configuración | true | false | false |
| `expenses` | Ver y cargar gastos | true | true | false |

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
| image_url | text nullable | |
| is_active | bool | default true |
| show_in_catalog | bool | default true |
| sales_count | int nullable | |
| created_at | timestamptz | |

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
| is_default | boolean | default false — único por negocio (índice único parcial WHERE is_default = true) |
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
precio_final = cost × (override_producto ?? override_marca ?? lista.multiplier)
```

### `sales`
Estructura estándar + `price_list_id uuid nullable` FK → price_lists(id) ON DELETE SET NULL + `operator_id uuid nullable` FK → operators(id).

### `sale_items` / `payments`
Estructura estándar.

### `inventory_movements`
Tiene `created_by_operator` (FK → operators.id) y `created_by` (legacy).

### `cash_sessions`
`opened_by` / `closed_by` → FK → profiles(id).

### `customers`
Campos: `name`, `phone`, `email`, `dni`, `credit_balance`, `notes`.

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
| attachment_type | expense_attachment_type ENUM | 'image','pdf','spreadsheet','other' |
| attachment_name | text nullable | |
| notes | text nullable | |
| created_at | timestamptz | |
| updated_at | timestamptz | trigger automático |

**Storage bucket:** `expense-receipts` — privado, 10MB máx, acepta jpg/png/webp/gif/pdf/xls/xlsx/csv. Path: `{business_id}/{uuid}.{ext}`

---

## Funciones SQL

Todas tienen `security definer` y `set search_path = public, extensions`.

| función | descripción |
|---------|-------------|
| `bootstrap_new_user(p_user_id, p_business_name, p_user_name)` | Crea businesses + profiles con permisos completos de owner |
| `get_business_id()` | Retorna business_id del usuario actual, usada en RLS |
| `create_operator(p_business_id, p_name, p_role, p_pin, p_permissions?)` | Inserta operador con PIN bcrypt. Retorna `{ success, operator_id?, error? }` |
| `verify_operator_pin(p_business_id, p_operator_id, p_pin)` | Verifica PIN. Retorna `{ success, profile_id?, name?, role?, permissions?, error? }` |
| `swap_default_price_list(p_price_list_id, p_business_id)` | Swap atómico de lista default |
| `update_stock_on_sale()` | Trigger que descuenta stock al crear venta |
| `create_category_guarded(p_operator_id, p_business_id, p_name, p_icon)` | Crea categoría verificando `stock_write` |
| `create_brand_guarded(p_operator_id, p_business_id, p_name)` | Crea marca verificando `stock_write` |
| `get_sale_detail(p_sale_id, p_business_id)` | Detalle completo de venta con items y pagos |
| `update_sale(p_sale_id, p_business_id, ...)` | Actualiza venta re-insertando sale_items para re-disparar triggers |
| `delete_sale(p_sale_id, p_business_id)` | Elimina venta y revierte stock |
| `get_business_balance(p_business_id, p_from?, p_to?)` | → `{ income, expenses, profit, margin, by_category, period_from, period_to }` |
| `get_expenses_list(p_business_id, p_from?, p_to?, p_category?, p_limit?, p_offset?)` | → `{ data: Expense[], total }` |
| `create_expense(p_business_id, p_category, p_amount, p_description, ...)` | → `{ success, id }` |
| `delete_expense(p_business_id, p_expense_id)` | → `{ success }` |
| `get_top_products_detail(p_business_id, p_from?, p_to?, p_limit?, p_offset?)` | → `{ data: ProductSalesDetail[], total }` |
| `get_sales_by_category_detail(p_business_id, p_from?, p_to?, p_limit?, p_offset?)` | → `{ data: CategorySalesDetail[], total }` |
| `get_sales_by_payment_detail(p_business_id, p_from?, p_to?)` | → `{ data: PaymentMethodDetail[] }` |
| `get_sales_by_operator_detail(p_business_id, p_from?, p_to?)` | → `{ data: OperatorSalesDetail[] }` |

**IMPORTANTE:** `create_operator` retorna JSON — siempre chequear `data.success`, no solo `error`.

**IMPORTANTE:** Todos los RPCs de stats y gastos retornan wrapper `{ data: [...] }` — siempre extraer `.data`:
```ts
const { data: rpcResult } = await supabase.rpc('get_top_products_detail', { ... })
const rows = (rpcResult as unknown as { data: RowType[] } | null)?.data ?? []
```

---

## Rutas de la app

| ruta | descripción | protección |
|------|-------------|------------|
| `/login` | Login | pública |
| `/register` | Registro | pública |
| `/catalogo/[slug]` | Catálogo público | pública (solo anon) |
| `/operator-select` | Selección de operador | requiere Supabase session |
| `/pos` | Terminal de ventas | cualquier operador activo |
| `/stock` | Inventario | `permissions.stock === true` |
| `/price-lists` | Listas de precios | `permissions.price_lists === true` |
| `/dashboard` | KPIs dashboard | `permissions.stats === true` |
| `/stats` | Estadísticas | `permissions.stats === true` |
| `/stats/top-products` | Detalle top productos | `permissions.stats === true` |
| `/stats/breakdown` | Detalle por categoría/marca | `permissions.stats === true` |
| `/stats/metodos-pago` | Detalle métodos de pago | `permissions.stats === true` |
| `/stats/operadores` | Detalle por operador | `permissions.stats === true` |
| `/gastos` | Módulo de gastos y proveedores | `permissions.expenses === true` |
| `/profile` | Perfil del usuario | cualquier operador activo |
| `/settings` | Configuración | `permissions.settings === true` |

**Edge Runtime** (`export const runtime = 'edge'`): `/pos`, `/dashboard`, `/stats`, `/operator-select`

---

## Estructura del sidebar

```
VENTAS
  Vender → /pos

ANÁLISIS
  Dashboard → /dashboard (requires stats)
  Estadísticas → /stats (requires stats)

FINANZAS
  Gastos → /gastos (requires expenses)

GESTIÓN
  Stock → /stock (requires stock)
  Listas de precios → /price-lists (requires price_lists)

SISTEMA
  Configuración → /settings (requires settings)
```

---

## Archivos clave

```
src/
├── proxy.ts
├── lib/
│   ├── operator.ts                       # UserRole, OWNER_PERMISSIONS (8 permisos), getActiveOperator()
│   ├── payments.ts                       # normalizePayment, PAYMENT_LABELS, PAYMENT_COLORS
│   ├── price-lists.ts                    # calculateProductPrice
│   └── supabase/
│       ├── client.ts
│       └── server.ts
├── app/
│   ├── (auth)/
│   │   ├── login/page.tsx
│   │   └── register/page.tsx
│   ├── (app)/
│   │   ├── layout.tsx                    # Lee cookie pos-sidebar-collapsed → initialCollapsed prop
│   │   ├── operator-select/page.tsx
│   │   ├── settings/page.tsx
│   │   ├── inventory/page.tsx
│   │   ├── price-lists/page.tsx
│   │   ├── dashboard/page.tsx
│   │   ├── stats/page.tsx
│   │   ├── stats/top-products/page.tsx
│   │   ├── stats/breakdown/page.tsx
│   │   ├── stats/metodos-pago/page.tsx
│   │   ├── stats/operadores/page.tsx
│   │   ├── gastos/page.tsx
│   │   ├── profile/page.tsx
│   │   └── pos/page.tsx
│   ├── api/operator/
│   │   ├── switch/route.ts
│   │   └── logout/route.ts
│   └── catalogo/[slug]/page.tsx
└── components/
    ├── shared/
    │   ├── FlashToast.tsx
    │   ├── PageHeader.tsx                # breadcrumbs?: { label: string; href: string }[]
    │   ├── DateRangeFilter.tsx           # Filtro período reutilizable (URL-based)
    │   └── ExportCSVButton.tsx
    ├── ui/
    │   └── SelectDropdown.tsx
    ├── sidebar.tsx
    ├── operator/
    │   ├── OperatorSelectView.tsx
    │   └── OperatorSwitcher.tsx
    ├── settings/
    │   ├── SettingsForm.tsx
    │   ├── OperatorList.tsx
    │   ├── NewOperatorModal.tsx          # 8 toggles de permisos
    │   └── types.ts
    ├── stock/
    │   ├── types.ts
    │   ├── InventoryPanel.tsx
    │   ├── NewProductModal.tsx
    │   ├── EditProductModal.tsx
    │   ├── CategoryModal.tsx
    │   └── BrandModal.tsx
    ├── dashboard/
    │   ├── SalesHistoryTable.tsx
    │   └── BalanceWidget.tsx
    ├── stats/
    │   ├── TopProductsDetailView.tsx
    │   ├── BreakdownDetailView.tsx
    │   ├── PaymentMethodDetailView.tsx
    │   └── OperatorSalesDetailView.tsx
    ├── expenses/
    │   ├── types.ts
    │   ├── GastosView.tsx
    │   ├── NewExpensePanel.tsx           # fixed right side panel, max-w-md
    │   ├── ExpenseSummaryCards.tsx
    │   ├── ExpensesTable.tsx
    │   ├── ExpenseAttachmentUploader.tsx
    │   ├── SupplierSelectDropdown.tsx
    │   └── SuppliersPanel.tsx
    ├── profile/
    │   ├── ProfileView.tsx
    │   ├── EditEmailPanel.tsx
    │   └── EditPasswordPanel.tsx
    └── price-lists/
        ├── types.ts
        ├── PriceListsPanel.tsx
        ├── NewPriceListModal.tsx
        ├── EditPriceListModal.tsx
        ├── ProductOverrideModal.tsx
        └── BrandOverrideModal.tsx
```

---

## Catálogo público

- URL: `/catalogo/[slug]`
- Políticas RLS `public_read_*` restringidas a `auth.role() = 'anon'`
- Solo productos con `is_active = true` AND `show_in_catalog = true`

---

## Roadmap

| Prioridad | Feature | Estado |
|-----------|---------|--------|
| P0 | Terminal de ventas + modal de pago | ✅ Done |
| P1 | Stock + historial de ventas diarias | ✅ Done |
| P2 | Dashboard KPIs + estadísticas | ✅ Done |
| P3 | Catálogo público + WhatsApp + Settings | ✅ Done |
| P4 | Switch de operadores por PIN + permisos | ✅ Done |
| P5 | Listas de precios + marcas (tabla propia) | ✅ Done |
| P6 | Auditoría de código + seguridad + performance | ✅ Done |
| P7 | UX polish + gastos + stats detalladas + /profile + performance | ✅ Done |
| P8 | Pruebas automatizadas (SQL security + Playwright E2E) | 🔄 Next |

---

## Design system

- **Background:** CSS var `--background`, **Surface:** CSS var `--surface`, **Primary:** `#1C4A3B` (dark green)
- Cards: `rounded-xl` / `rounded-2xl`, border sutil
- Dropdowns/popovers: clase `surface-elevated`
- Sidebar: clase `surface-sidebar`
- Filter chips: `pill-tabs` (container) / `pill-tab` (inactive) / `pill-tab-active` (active) — usar en TODOS los filtros
- Sin `backdrop-filter` ni `backdrop-blur`
- Iconos: lucide-react · Charts: recharts
- Sin emojis en código · Sin valores hardcodeados · Sin tipos `any`
- Named interfaces para todas las props

### Breadcrumbs
`PageHeader` acepta `breadcrumbs?: { label: string; href: string }[]`. Requerido en sub-rutas. No usar en rutas top-level.

---

## Reglas críticas para Copilot

1. Usar `proxy.ts` en la raíz, NUNCA `middleware.ts`
2. El `business_id` siempre viene de `profiles.business_id`, nunca se infiere de otros datos
3. Queries en Server Components siempre incluyen `.eq('business_id', businessId)` además de confiar en RLS
4. Las funciones SQL con bcrypt deben tener `set search_path = public, extensions` y usar `extensions.crypt()` / `extensions.gen_salt()`
5. El RPC `create_operator` retorna JSON — chequear `data.success`, no solo `error`
6. Operadores sub-usuarios viven en `operators`, el owner solo en `profiles`
7. El owner NUNCA tiene entrada en `operators`
8. Cookie `operator_session`: httpOnly, sameSite: lax, secure en producción
9. Owner identificado en proxy por `operator?.role === 'owner'` o ausencia de cookie — nunca por DB lookup
10. `OWNER_PERMISSIONS` definido en `lib/operator.ts` — importado en todas partes, nunca duplicado
11. `UserRole = 'owner' | 'manager' | 'cashier' | 'custom'` — exportado de `lib/operator.ts`
12. El precio final siempre se calcula con `calculateProductPrice` de `lib/price-lists.ts` — nunca inline
13. La lista default se obtiene siempre desde `price_lists` donde `is_default = true` y `business_id` coincide
14. La marca es siempre una entidad de `brands` — nunca texto libre
15. Overrides: upsert con `onConflict: 'price_list_id,product_id'` o `onConflict: 'price_list_id,brand_id'`
16. Políticas `public_read_*` solo aplican a `auth.role() = 'anon'`
17. `normalizePayment`, `PAYMENT_LABELS`, `PAYMENT_COLORS` viven en `lib/payments.ts` — nunca duplicados
18. `createClient()` siempre dentro de `useMemo(() => createClient(), [])` en Client Components
19. Queries independientes en Server Components siempre con `Promise.all`
20. RPCs que retornan `{ data: [...] }` — siempre extraer `.data`, nunca iterar el wrapper directamente
21. Al agregar un campo a `Permissions`: buscar en TODO el codebase y actualizar todos los archivos que construyen el objeto manualmente (sidebar.tsx, api/operator/switch/route.ts, etc.)
22. Filter chips: siempre `pill-tabs` / `pill-tab` / `pill-tab-active` — nunca `flex gap-2` con borders custom
23. Sidebar collapsed: inicializar desde cookie `pos-sidebar-collapsed` en Server Component — nunca con `useEffect` post-hydration
