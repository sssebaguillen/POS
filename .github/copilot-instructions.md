# GitHub Copilot Instructions — POS System

## Stack
- Next.js 16+ App Router + TypeScript (strict mode)
- Supabase (PostgreSQL + Auth + RLS)
- Tailwind CSS + shadcn/ui
- Vercel (deploy, región gru1 São Paulo)

---

## Hard Rules — Never Do This

### No patching over broken code
If something does not work, identify the root cause before writing new code.
Do not layer fallbacks, workarounds, or "self-healing" logic on top of a broken flow.
Each fix must solve the actual problem, not mask a symptom.

### No chained fallbacks to infer critical data
Data that comes from a single source of truth must only come from that source.

```ts
// WRONG — never infer businessId from unrelated data
const businessId =
  profileBusinessId ??
  products?.[0]?.business_id ??
  categories?.[0]?.business_id ??
  null

// CORRECT — one source, fail explicitly if missing
const businessId = profileBusinessId
```

### No hardcoded values
Do not hardcode IDs, URLs, business names, role strings, or any value that belongs in the database or environment variables.

```ts
// WRONG
const role = 'owner'
const endpoint = 'https://zrnthycznbrplzpmxmkwk.supabase.co'

// CORRECT
const role = user.role
const endpoint = process.env.NEXT_PUBLIC_SUPABASE_URL
```

### No emojis in code
No emojis in variable names, comments, console.log, error messages, or any string inside logic.
Emojis belong only in user-facing UI content defined in the database (e.g. category icons stored as text fields).

### No silent error suppression
Never swallow errors silently. Always surface the real error message to the user or to the logs.

```ts
// WRONG
if (bizError || !business) {
  setError('Something went wrong')
}

// CORRECT
if (bizError || !business) {
  setError(bizError?.message ?? 'Failed to create business')
}
```

### No `any` types
Use proper TypeScript types. If the shape is unknown, use `unknown` with type narrowing.

```ts
// WRONG
const data: any = await fetchSomething()

// CORRECT
const data: Product[] = await fetchSomething()
```

### No duplicated logic
If the same logic appears in more than one place, extract it into a shared utility function or custom hook.

---

## Code Style

### Naming conventions
- Variables and functions: `camelCase` in English
- React components: `PascalCase`
- Component files: `PascalCase` (`ProductCard.tsx`)
- Route/page files: `kebab-case` (`new-product/page.tsx`)
- SQL functions: `snake_case`
- Database columns: `snake_case`

### TypeScript
- Always type component props explicitly with `interface` or `type`
- Prefer `const` over `let`
- Never use `as unknown as X` to bypass type errors — fix the type instead
- Use strict null checks; handle `null` and `undefined` explicitly

### Components
- One responsibility per component
- Server Components fetch data; Client Components handle interaction
- Do not fetch data inside Client Components unless necessary — prefer passing props from Server Components
- Keep components small and focused; extract sub-components when a file exceeds ~150 lines
- Never define a component function inside another component's render body — always define at module scope

---

## Multi-tenant Architecture

This system is strictly multi-tenant. Every piece of data belongs to a business.

### Core rules
- Every table (except `auth.users` and `profiles`) has a `business_id` column
- RLS is enabled on all tables and enforced via `get_business_id()` helper function
- `businessId` must always originate from `profiles.business_id` for the authenticated user
- Never pass `businessId` derived from product, category, or any other secondary table
- Never bypass RLS by using the service role key on the client side
- Always add `.eq('business_id', businessId)` to Server Component queries as defense-in-depth alongside RLS

### RLS public read policies
`products` and `categories` have NO anon access via REST API. Their `public_read_*` policies
only allow `business_id = get_business_id()` — no `auth.role() = 'anon'` exception.

The public catalog uses SECURITY DEFINER RPCs instead:
- `get_catalog_products(p_slug text)` — filters internally by slug → business_id
- `get_catalog_categories(p_slug text)` — same pattern

Both RPCs have `GRANT EXECUTE TO anon`. Never query `products` or `categories` directly
from an anon context — always use these RPCs for public catalog access.

`businesses` retains a permissive anon SELECT policy (needed for slug resolution inside the RPCs).

### Creating business data
The only way to create a new business and profile is via the `bootstrap_new_user` RPC function.

```ts
// CORRECT — use RPC to create business and profile
const { data, error } = await supabase.rpc('bootstrap_new_user', {
  p_user_id: authData.user.id,
  p_business_name: businessName,
  p_user_name: userName,
})
```

---

## Supabase Patterns

### Server-side data fetching (Server Components)
```ts
import { createClient } from '@/lib/supabase/server'

const supabase = await createClient()
const { data, error } = await supabase.from('products').select('...').eq('business_id', businessId)
```

### Client-side mutations (Client Components)
```ts
import { createClient } from '@/lib/supabase/client'

// ALWAYS inside useMemo — never at top level
const supabase = useMemo(() => createClient(), [])
```

### Parallel data fetching
Never await independent Supabase queries sequentially — always use `Promise.all`.

```ts
// WRONG — sequential, slow
const { data: products } = await supabase.from('products').select()
const { data: categories } = await supabase.from('categories').select()

// CORRECT — parallel
const [{ data: products }, { data: categories }] = await Promise.all([
  supabase.from('products').select(),
  supabase.from('categories').select(),
])
```

### RPC data extraction — CRITICAL
All stats and expenses RPCs return a jsonb wrapper `{ data: [...] }`. ALWAYS extract `.data` before using the result. Never iterate over the wrapper object directly.

```ts
// WRONG — iterates the wrapper object, throws "not iterable"
const { data: rows } = await supabase.rpc('get_top_products_detail', { ... })
rows.map(...) // CRASH

// CORRECT — extract the array from the wrapper
const { data: rpcResult } = await supabase.rpc('get_top_products_detail', { ... })
const rows = (rpcResult as unknown as { data: RowType[] } | null)?.data ?? []
rows.map(...) // OK
```

### Null-safe numeric fields from RPC results
Fields from RPC rows can arrive as `null` from PostgreSQL. Always guard numeric fields before calling methods:

```ts
// WRONG — crashes if value is null
row.total_amount.toLocaleString(...)

// CORRECT
(row.total_amount ?? 0).toLocaleString(...)
```

### Never use the service role key on the client
Server-side privileged operations must go through `security definer` SQL functions called via RPC.

### Never use select('*')
Always specify explicit column lists. Apply `Number()` coercion to numeric fields in mapping.

---

## SQL Functions

All SQL functions must have:
- `security definer` if they need elevated privileges
- `set search_path = public` always — without this, they are vulnerable to search_path hijacking

---

## File Structure Conventions

```
app/
  (auth)/
    login/page.tsx
    register/page.tsx
  (app)/
    layout.tsx              → reads pos-sidebar-collapsed cookie → passes initialCollapsed to AppShell
    operator-select/page.tsx
    settings/page.tsx
    inventory/page.tsx
    products/page.tsx
    price-lists/page.tsx
    dashboard/page.tsx
    stats/page.tsx
    stats/top-products/page.tsx
    stats/breakdown/page.tsx
    stats/metodos-pago/page.tsx
    stats/operadores/page.tsx
    gastos/page.tsx
    profile/page.tsx
    pos/page.tsx
  catalogo/
    [slug]/page.tsx          → public catalog, uses get_catalog_products + get_catalog_categories RPCs
    [slug]/layout.tsx        → CatalogThemeProvider wrapper
components/
  shared/               → FlashToast, PageHeader (breadcrumbs), DateRangeFilter, ExportCSVButton
  ui/                   → shadcn/ui primitives + SelectDropdown
  sidebar.tsx           → VENTAS / ANÁLISIS / FINANZAS / GESTIÓN / SISTEMA sections
  catalogo/             → CatalogView, CatalogThemeProvider
  stock/                → inventory-related components
  price-lists/          → price list management components
  dashboard/            → SalesHistoryTable, BalanceWidget
  stats/                → TopProductsDetailView, BreakdownDetailView, PaymentMethodDetailView, OperatorSalesDetailView
  expenses/             → GastosView, NewExpensePanel, ExpenseSummaryCards, ExpensesTable, ExpenseAttachmentUploader, SupplierSelectDropdown, SuppliersPanel, types.ts
  profile/              → ProfileView, EditEmailPanel, EditPasswordPanel
  settings/             → SettingsForm, OperatorList, NewOperatorModal (8 permission toggles)
  pos/                  → sales terminal components
lib/
  operator.ts           → UserRole, OWNER_PERMISSIONS (8 fields incl. expenses), getActiveOperator()
  payments.ts           → normalizePayment, PAYMENT_LABELS, PAYMENT_COLORS
  price-lists.ts        → calculateProductPrice (single source of truth)
  supabase/
    client.ts
    server.ts
```

---

## Permissions Model

`UserRole` is exported from `lib/operator.ts`:
```ts
export type UserRole = 'owner' | 'manager' | 'cashier' | 'custom'
```

`OWNER_PERMISSIONS` is exported from `lib/operator.ts` — never duplicated anywhere:
```ts
export const OWNER_PERMISSIONS: Permissions = {
  sales: true, stock: true, stock_write: true,
  stats: true, price_lists: true, price_lists_write: true,
  settings: true, expenses: true
}
```

`Permissions` interface has 8 fields:
```ts
export interface Permissions {
  sales: boolean
  stock: boolean
  stock_write: boolean
  stats: boolean
  price_lists: boolean
  price_lists_write: boolean
  settings: boolean
  expenses: boolean
}
```

**CRITICAL:** When adding a new field to `Permissions`, search the entire codebase for every file that manually constructs a `Permissions` object literal and add the field to ALL of them. Known files: `lib/operator.ts`, `sidebar.tsx`, `api/operator/switch/route.ts`. Missing even one will cause a TypeScript build error on Vercel.

Permission map per route:
- `/inventory` → `permissions.stock === true`
- `/price-lists` → `permissions.price_lists === true`
- `/dashboard`, `/stats`, `/stats/*` → `permissions.stats === true`
- `/gastos` → `permissions.expenses === true`
- `/settings` → `permissions.settings === true`
- `/profile` → no permission check (any authenticated operator)

Owner identification in proxy: `operator?.role === 'owner'` or absence of `operator_session` cookie. Never use a DB lookup to identify the owner in middleware.

---

## Sidebar Structure

The sidebar uses 5 named sections. Never collapse these into a flat list.

```
VENTAS      → Vender (/pos)
ANÁLISIS    → Dashboard (/dashboard), Estadísticas (/stats)
FINANZAS    → Gastos (/gastos) [requires expenses permission]
GESTIÓN     → Inventario (/inventory), Listas de precios (/price-lists)
SISTEMA     → Configuración (/settings)
```

Profile button in sidebar footer routes to `/profile`, not `/settings`.

---

## Breadcrumbs

`PageHeader` accepts `breadcrumbs?: { label: string; href: string }[]`.

- **Top-level routes** (`/dashboard`, `/stats`, `/gastos`, `/pos`, `/settings`, `/stock`, `/price-lists`, `/profile`): title only, NO breadcrumbs
- **Sub-routes**: always include breadcrumbs pointing to the parent

| Route | breadcrumbs | title |
|---|---|---|
| `/stats/top-products` | `[{ label: 'Estadísticas', href: '/stats' }]` | Top productos |
| `/stats/breakdown` | `[{ label: 'Estadísticas', href: '/stats' }]` | Breakdown |
| `/stats/metodos-pago` | `[{ label: 'Estadísticas', href: '/stats' }]` | Métodos de pago |
| `/stats/operadores` | `[{ label: 'Estadísticas', href: '/stats' }]` | Operadores |
| `/profile` | `[{ label: 'Configuración', href: '/settings' }]` | Perfil |

---

## Filter Chips (pill-tabs)

ALL filter chip rows in the app use these CSS classes from `globals.css`. Never use `flex gap-2` with custom border buttons for filter chips.

```
Container: pill-tabs (+ flex-wrap if many items, + flex-nowrap overflow-x-auto if horizontal scroll needed)
Inactive chip: pill-tab
Active chip: pill-tab-active
```

Exception: semantic status chips (e.g. amber/red sale status in EditSalePanel) keep their own color classes.

---

## Brands Module

- `products.brand_id` is always a FK to `brands.id` — never store brand as free text
- Brand assignment in forms uses a combobox (selection only, no free-text creation inline)
- New brands created via `BrandModal` using `create_brand_guarded` RPC
- Always join brands when fetching products: `brand_id, brands(id, name)`
- Map result: `brand: Array.isArray(p.brands) ? p.brands[0] ?? null : p.brands ?? null`

---

## Product Images

- `products.image_url text` — nullable HTTPS URL
- `products.image_source text CHECK ('upload', 'url')` — nullable
- Consistency constraint: both columns must be null together or non-null together — never one without the other
- Storage bucket: `product-images` (public), path `{business_id}/{uuid}.{ext}`
- Validation on save: HTTPS required — block `data:` `javascript:` `file:` `blob:` schemes
- Never use raw `<img>` for product images — always `next/image` with explicit `width`/`height` or `fill`
- `image_source = 'upload'` → URL comes from Supabase Storage; `image_source = 'url'` → external HTTPS URL
- Categories and brands have no images

---

## Price Lists Module

### Runtime price calculation
Always use `calculateProductPrice` from `lib/price-lists.ts`:
```
final_price = cost × (product_override ?? brand_override ?? list.multiplier)
```
Never inline this formula. Never duplicate it.

### Multiplier vs percentage
- DB stores `multiplier` (e.g. 1.40)
- UI shows percentage (e.g. 40%)
- Conversion on save: `multiplier = 1 + percentage / 100`
- Conversion on display: `percentage = (multiplier - 1) * 100`
- Never store percentage in the DB

### Override upsert
- Product override: `onConflict: 'price_list_id,product_id'`
- Brand override: `onConflict: 'price_list_id,brand_id'`

---

## Expenses Module

- Types defined in `components/expenses/types.ts`: `Expense`, `Supplier`, `BusinessBalance`, `ExpenseCategory`, `EXPENSE_CATEGORY_LABELS`
- `EXPENSE_CATEGORY_LABELS` is the single source of truth for category display names — never hardcode labels in components
- File uploads go to Supabase storage bucket `expense-receipts` using path `{business_id}/{uuid}.{ext}`
- `NewExpensePanel` is a fixed right-side panel (`fixed inset-y-0 right-0 max-w-md`) — never fullscreen
- `GastosView` uses a `showSuppliers` boolean state to toggle between expenses view and `SuppliersPanel` — no tab bar

---

## Catalog Module (Public)

The public catalog at `/catalogo/[slug]` is accessible without authentication.

- Never query `products` or `categories` tables directly from the catalog page — always use RPCs
- `get_catalog_products(p_slug text)` — returns active catalog products for the given slug
- `get_catalog_categories(p_slug text)` — returns active categories for the given slug
- Both RPCs are SECURITY DEFINER and handle business_id resolution internally
- The catalog client uses anon key with `persistSession: false, autoRefreshToken: false`
- Business info (name, description, logo_url, whatsapp) is fetched directly from `businesses` by slug — this is allowed since businesses has a permissive anon SELECT policy

---

## Operator Session

- `operator_session` cookie: httpOnly, sameSite: lax — contains `{ profile_id, name, role: UserRole, permissions }`
- `op_perms` cookie: non-httpOnly — client-readable copy of permissions for sidebar
- Logout route: clears both cookies AND restores owner session before redirecting
- Registration flow: calls `/api/operator/logout` before redirecting to clear any stale cookies
- Flash messages: proxy sets `flash_toast=no-access` cookie (maxAge: 5, non-httpOnly) on unauthorized redirect

---

## Sidebar Collapse (CLS-free)

- `(app)/layout.tsx` reads cookie `pos-sidebar-collapsed` server-side and passes it as `initialCollapsed` prop to `AppShell`
- `AppShell` initializes collapsed state from this prop — NO `useEffect` reading `localStorage` after mount
- Toggle writes both `document.cookie` and `localStorage`
- This eliminates the 184px layout shift (CLS) that would occur with post-hydration state changes

---

## UI & Design

### No glass effects
Do not use `backdrop-filter`, `backdrop-blur`, or `bg-white/[0.xx]` anywhere.

### Utility classes (defined in globals.css)
```css
.surface-elevated      → modals, dropdowns, popovers
.surface-sidebar       → sidebar panel
.btn-primary-gradient  → primary CTA button
.btn-danger            → destructive action button
.pill-tabs             → filter chip container
.pill-tab              → inactive filter chip
.pill-tab-active       → active filter chip
```

### Component style reference
| Component | Style |
|---|---|
| Modals, dropdowns, popovers | `surface-elevated` |
| Sidebar | `surface-sidebar` |
| Primary CTA | `btn-primary-gradient` or `rounded-lg text-xs bg-primary hover:bg-primary/90 text-primary-foreground` |
| Destructive action | `btn-danger` |
| Active nav item | `bg-primary/10 rounded-xl px-3 py-2` |
| Filter chips | `pill-tabs` / `pill-tab` / `pill-tab-active` |

### Color palette
- **Primary:** `#1C4A3B` (dark green)
- **Background/Surface:** CSS variables only — never hardcoded hex in components
- Semantic: green = success, amber = warning, red = error/destructive, gray = inactive

### Typography
- Font: `DM Sans` via `next/font/google` with `display: 'swap'`, `preload: true`, explicit weights `['400','500','600','700']`
- Never mix more than 3 font sizes in a single card or panel

### Layout
- Sidebar: `position: fixed`, overlays content
- `SelectDropdown` component replaces all native `<select>` elements

### Iconography
- `lucide-react` exclusively — no other icon libraries
- Charts: `recharts` exclusively — no other chart libraries

---

## Component Structure

### Single responsibility + size limit
Each component does one thing. Extract sub-components when a file exceeds ~150 lines.

### Never define components inside render
Never define a React component function inside another component's render body. Always define at module scope. Inline component definitions create new references on every render, causing React to unmount/remount subtrees unnecessarily.

### Props
Always define props with a named `interface`. Never use optional props as a workaround for missing data.

### Server vs Client components
- Default to Server Components
- Never fetch data inside a Client Component when a Server Component can pass it as props
- `'use client'` only for interactivity or browser APIs

---

## State Management

- `useState` for local UI state
- No Zustand/Context for server data
- Forms: controlled inputs, clear errors on correction, disable submit during loading

---

## Next.js Best Practices

- Route groups: `(auth)` and `(app)`
- `page.tsx` files are thin — fetch data and pass to feature components
- Business logic lives in components, not `page.tsx`
- `next/image` for all images — never raw `<img>`
- Never `useEffect` for data fetching
- High-traffic pages use `export const runtime = 'edge'` for lower latency

---

## What Copilot Should NOT Suggest

- Wrapping broken code in try/catch and returning a generic fallback
- Adding `|| null` or `?? undefined` to bypass TypeScript errors without fixing the type
- Creating default/mock data to make a component render when real data is missing
- Adding `// @ts-ignore` or `// @ts-expect-error` comments
- Duplicating a component instead of making the existing one reusable
- Importing from `@/lib/supabase/server` inside a Client Component
- Calling `supabase.auth.getUser()` inside a Client Component
- Introducing new colors, fonts, or icon libraries not already in the stack
- Using `useEffect` to fetch data when a Server Component can do it
- Sequential `await` calls for independent Supabase queries — always `Promise.all`
- Inline prop types instead of named interfaces
- Adding emojis anywhere in the codebase
- Using `backdrop-filter`, `backdrop-blur`, or `bg-white/[0.xx]` — no glass effects
- Using native `<select>` elements — always use `SelectDropdown` from `components/ui/`
- Storing brand as free text on products — always `brand_id` FK to `brands` table
- Inlining price calculation — always use `calculateProductPrice` from `lib/price-lists.ts`
- Duplicating `normalizePayment`, `PAYMENT_LABELS`, or `PAYMENT_COLORS` — import from `lib/payments.ts`
- Duplicating `OWNER_PERMISSIONS` — import from `lib/operator.ts`
- Using `string` for `role` field — always use `UserRole` from `lib/operator.ts`
- Calling `createClient()` outside `useMemo` in Client Components
- Using `select('*')` — always specify explicit column lists
- Creating a `public_read_products` or `public_read_categories` RLS policy with anon access — catalog uses `get_catalog_products` / `get_catalog_categories` RPCs (SECURITY DEFINER) instead of direct table access
- Querying `products` or `categories` directly from `/catalogo/[slug]` — always use the catalog RPCs
- Making a DB lookup in proxy/middleware to identify the owner — use the cookie role
- Fetching `defaultPriceList` from anywhere other than `price_lists` where `is_default = true`
- Creating more than one `price_lists` row with `is_default = true` per business
- Upsert on `price_list_overrides` without the correct `onConflict` key
- Using custom `flex gap-2` border buttons for filter chips — always use `pill-tabs` / `pill-tab` / `pill-tab-active`
- Iterating directly over RPC results without extracting `.data` from the wrapper object
- Calling `.toLocaleString()` or any method on numeric RPC fields without null-guarding with `?? 0`
- Defining React component functions inside another component's render body
- Reading sidebar collapse state from `localStorage` in a `useEffect` — always initialize from the `pos-sidebar-collapsed` cookie server-side
- Adding a field to `Permissions` without updating ALL files that manually construct a `Permissions` object
- Replacing `product.price` in `cart.store.ts` `addItem` with `calculateProductPrice` — the store intentionally holds the base price; `activePriceList` and `priceListOverrides` are passed separately to `ProductPanel` and `CartPanel` where `calculateProductPrice` is applied at render time and at checkout
- Adding `/stock` as a route guard in `proxy.ts` — the actual deployed route is `/inventory`; `/stock` does not exist in the app directory
- Using raw `<img>` for product images — always `next/image`
- Setting `image_url` without `image_source`, or vice versa — both must be set together or both null
- Accepting non-HTTPS URLs or `data:` / `javascript:` / `file:` / `blob:` schemes for `image_url`
- Adding image fields to `categories` or `brands` — only `products` has images for now
