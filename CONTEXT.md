# POS LATAM — Contexto técnico del proyecto

## Stack

- **Frontend:** Next.js 16+ (App Router), TypeScript (strict), Tailwind CSS, shadcn/ui
- **Backend:** Supabase (PostgreSQL + Auth + RLS), project ID: `zrnthycznbrplzpmxmkwk` (sa-east-1)
- **Deploy:** Vercel, team ID: `team_oHHmom6iEMv4RqPBq0HWbJxm`, repo: `github.com/sssebaguillen/POS` (master)
- **IMPORTANTE:** Next.js 16+ usa `proxy.ts` en la raíz, NO `middleware.ts`

---

## Decisiones de arquitectura

### Multi-tenancy
- Cada negocio tiene su propio `business_id`
- Toda tabla de datos tiene `business_id` con RLS via `get_business_id()`
- `profiles.id` tiene FK a `auth.users(id)` — solo el owner tiene entrada en `profiles`
- Sub-operadores viven en la tabla `operators` (sin entrada en `auth.users`)

### Autenticación de operadores
- El owner autentica con Supabase Auth (email + contraseña)
- Los operadores autentican con PIN de 4 dígitos hasheado con bcrypt (`pgcrypto`)
- La sesión activa se guarda en cookie httpOnly `operator_session`:
  ```json
  { "profile_id": "uuid", "name": "string", "role": "string", "permissions": {...} }
  ```
- `proxy.ts` protege rutas según permisos del operador activo
- Si no hay cookie y el user de Supabase es `owner`, el proxy auto-setea la cookie con permisos completos

### Pantalla de selección de operador (`/operator-select`)
- Muestra tarjeta "Administrador" (owner) al tope — autentica con contraseña de Supabase
- Muestra tarjetas de operadores PIN debajo
- Al cambiar de operador: botón en sidebar → logout route borra cookie → proxy redirige según rol

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
| role | text | default 'cashier', el owner tiene 'owner' |
| pin | text nullable | no usado para owner |
| permissions | jsonb | |
| created_at | timestamptz | |

### `operators`
| columna | tipo | notas |
|---------|------|-------|
| id | uuid PK | gen_random_uuid() |
| business_id | uuid | FK → businesses(id) |
| name | text | |
| role | text | 'manager' o 'cashier' |
| pin | text | bcrypt hasheado via extensions.crypt() |
| permissions | jsonb | asignado por rol al crear |
| is_active | bool | default true |
| created_at | timestamptz | |

**Permisos por rol:**
| rol | sales | stock | stats | settings |
|-----|-------|-------|-------|----------|
| owner | true | true | true | true |
| manager | true | true | true | false |
| cashier | true | "readonly" | false | false |

### `brands`
| columna | tipo | notas |
|---------|------|-------|
| id | uuid PK | gen_random_uuid() |
| business_id | uuid | FK → businesses(id) ON DELETE CASCADE |
| name | text | |
| created_at | timestamptz | |

**Constraints:** `UNIQUE (business_id, name)` — no pueden existir dos marcas con el mismo nombre en el mismo negocio.

**Regla:** la marca es siempre una entidad propia — nunca texto libre en productos. El usuario crea marcas desde el modal de Marcas en Stock, y luego las asigna a productos mediante un combobox de búsqueda. Esto garantiza consistencia y evita duplicados por diferencias tipográficas.

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
| multiplier | numeric(6,4) | 1.0 = base, 0.85 = −15%, 1.20 = +20% |
| is_default | boolean | default false — único por negocio (índice único parcial WHERE is_default = true) |
| created_at | timestamptz | |

**Regla:** siempre debe existir exactamente una lista con `is_default = true` por negocio una vez que se crea la primera lista. La primera lista creada se convierte en default automáticamente. La DB garantiza esta unicidad vía índice único parcial.

### `price_list_overrides`
| columna | tipo | notas |
|---------|------|-------|
| id | uuid PK | gen_random_uuid() |
| price_list_id | uuid | FK → price_lists(id) ON DELETE CASCADE |
| product_id | uuid nullable | FK → products(id) ON DELETE CASCADE |
| brand_id | uuid nullable | FK → brands(id) ON DELETE CASCADE |
| multiplier | numeric(6,4) | multiplicador específico para este override |
| created_at | timestamptz | |

**Constraints:**
- `CHECK`: `(product_id IS NOT NULL AND brand_id IS NULL) OR (product_id IS NULL AND brand_id IS NOT NULL)` — cada override es por producto O por marca, nunca ambos ni ninguno
- `UNIQUE (price_list_id, product_id)` — un override por producto por lista
- `UNIQUE (price_list_id, brand_id)` — un override por marca por lista

**Lógica de precio en runtime:**
```
precio_final = cost × (override_producto ?? override_marca ?? lista.multiplier)
```

### `sales` / `sale_items` / `payments`
Estructura estándar. `sales` tiene `business_id`, `session_id`, `customer_id`, `subtotal`, `discount`, `total`, `status`, `notes`.

### `inventory_movements`
Tiene `created_by_operator` (FK → operators.id) y `created_by` (legacy, sin FK activa).

### `cash_sessions`
`opened_by` / `closed_by` → FK → profiles(id).

### `customers`
Campos: `name`, `phone`, `email`, `dni`, `credit_balance`, `notes`.

---

## Funciones SQL

Todas tienen `security definer` y `set search_path = public, extensions`.

| función | descripción |
|---------|-------------|
| `bootstrap_new_user(p_user_id, p_business_name, p_user_name)` | Crea businesses + profiles para nuevo registro |
| `get_business_id()` | Retorna business_id del usuario actual, usada en RLS |
| `create_operator(p_business_id, p_name, p_role, p_pin)` | Inserta operador con PIN bcrypt. Retorna `{ success, operator_id?, error? }` |
| `verify_operator_pin(p_business_id, p_operator_id, p_pin)` | Verifica PIN. Retorna `{ success, profile_id?, name?, role?, permissions?, error? }` |
| `update_stock_on_sale()` | Trigger que descuenta stock al crear venta |

**IMPORTANTE:** `create_operator` retorna JSON — siempre chequear `data.success`, no solo `error`.

---

## Rutas de la app

| ruta | descripción | protección |
|------|-------------|------------|
| `/login` | Login | pública |
| `/register` | Registro | pública |
| `/catalogo/[slug]` | Catálogo público | pública |
| `/operator-select` | Selección de operador | requiere Supabase session |
| `/ventas` | Terminal de ventas | cualquier operador activo |
| `/stock` | Inventario | permissions.stock !== false |
| `/price-lists` | Listas de precios | permissions.stock !== false |
| `/dashboard`, `/stats` | KPIs y estadísticas | permissions.stats === true |
| `/settings` | Configuración | permissions.settings === true |

---

## Archivos clave

```
src/
├── proxy.ts                          # Protección de rutas (NO middleware.ts)
├── lib/
│   ├── operator.ts                   # getActiveOperator(), hasPermission()
│   └── supabase/
│       ├── client.ts
│       └── server.ts
├── app/
│   ├── (auth)/
│   │   ├── login/page.tsx
│   │   └── register/page.tsx         # signUp → rpc('bootstrap_new_user') → signInWithPassword
│   ├── (app)/
│   │   ├── operator-select/page.tsx  # Fetch operators + ownerProfile → OperatorSelectView
│   │   ├── settings/page.tsx         # Fetch business + operators → SettingsForm
│   │   ├── inventory/page.tsx        # businessId SIEMPRE desde profiles.business_id
│   │   └── price-lists/page.tsx      # Fetch price_lists + products + overrides → PriceListsPanel
│   ├── (dashboard)/
│   │   ├── ventas/page.tsx
│   │   ├── stock/page.tsx
│   │   └── dashboard/page.tsx
│   ├── api/operator/
│   │   ├── switch/route.ts           # POST: verifica PIN o contraseña owner, setea cookie
│   │   └── logout/route.ts           # POST: borra cookie operator_session
│   └── catalogo/[slug]/page.tsx      # Catálogo público
└── components/
    ├── operator/
    │   ├── OperatorSelectView.tsx
    │   └── OperatorSwitcher.tsx
    ├── settings/
    │   └── SettingsForm.tsx
    ├── stock/
    │   ├── types.ts                  # InventoryProduct, InventoryCategory, InventoryBrand
    │   ├── InventoryPanel.tsx        # Panel principal — botón Marcas habilitado
    │   ├── NewProductModal.tsx       # Combobox de marca + integración lista default
    │   ├── EditProductModal.tsx      # Combobox de marca + gestión override lista default
    │   ├── CategoryModal.tsx         # CRUD de categorías
    │   └── BrandModal.tsx            # CRUD de marcas (crear / eliminar)
    └── price-lists/
        ├── types.ts                  # PriceList, PriceListOverride, PriceListProduct
        ├── PriceListsPanel.tsx       # Panel principal con tabs y agrupación por marca
        ├── NewPriceListModal.tsx
        ├── EditPriceListModal.tsx
        ├── ProductOverrideModal.tsx  # Override por producto
        └── BrandOverrideModal.tsx    # Override por marca (usa brand_id)
```

---

## Catálogo público

- URL: `/catalogo/[slug]` (en español, intencional para LATAM)
- Solo productos con `is_active = true` AND `show_in_catalog = true`
- Filtro por categorías, carrito, pedido por WhatsApp

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
| P6 | Selector de lista activa en módulo de ventas | 🔄 Next |

### P6 — Pendiente
- Selector de lista de precios al iniciar una venta (elegido manualmente por el vendedor)
- Los precios del carrito se recalculan según la lista seleccionada usando `cost × (override_producto ?? override_marca ?? lista.multiplier)`
- Link + botón copiar al catálogo público en `/settings`

---

## Design system

- **Background:** `#F5F4F0` (off-white), **Surface:** white, **Primary:** `#1C4A3B` (dark green)
- Cards: `rounded-xl` / `rounded-2xl`, border sutil
- Iconos: lucide-react únicamente · Charts: recharts únicamente
- Sin emojis en código · Sin valores hardcodeados · Sin tipos `any`
- Named interfaces para todas las props

---

## Reglas críticas para Copilot

1. Usar `proxy.ts` en la raíz, NUNCA `middleware.ts`
2. El `business_id` siempre viene de `profiles.business_id`, nunca se infiere de otros datos
3. Las funciones SQL con bcrypt deben tener `set search_path = public, extensions` y usar `extensions.crypt()` / `extensions.gen_salt()`
4. El RPC `create_operator` retorna JSON — chequear `data.success`, no solo `error`
5. Operadores sub-usuarios viven en `operators`, el owner solo en `profiles`
6. El owner NUNCA tiene entrada en `operators`
7. Cookie `operator_session`: httpOnly, sameSite: lax, secure en producción
8. El precio final siempre se calcula como `cost × (override_producto ?? override_marca ?? lista.multiplier)` — nunca hardcodear precios ni calcular de otra forma
9. La lista default se obtiene siempre desde `price_lists` donde `is_default = true` y `business_id` coincide — nunca inferirla de otro lugar
10. Nunca crear más de una lista con `is_default = true` por negocio — la DB lo garantiza vía índice único parcial, pero el código también debe respetarlo
11. La marca es siempre una entidad de la tabla `brands` — nunca texto libre en productos ni en overrides. `products.brand_id` y `price_list_overrides.brand_id` son FK a `brands.id`
12. Los overrides de precio se upsertean con `onConflict: 'price_list_id,product_id'` para overrides por producto y `onConflict: 'price_list_id,brand_id'` para overrides por marca
