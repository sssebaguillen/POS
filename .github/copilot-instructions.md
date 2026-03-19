# GitHub Copilot Instructions — POS System

## Stack
- Next.js 16+ App Router + TypeScript (strict mode)
- Supabase (PostgreSQL + Auth + RLS)
- Tailwind CSS + shadcn/ui
- Vercel (deploy)

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
`public_read_*` policies (products, categories, businesses) are restricted to `auth.role() = 'anon'` only. Authenticated users see their own data exclusively via `tenant_isolation`. Never create a public read policy without the `auth.role() = 'anon'` guard.

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
    layout.tsx          → mounts FlashToast
    operator-select/page.tsx
    settings/page.tsx
    inventory/page.tsx
    price-lists/page.tsx
    dashboard/page.tsx
    stats/page.tsx
    ventas/page.tsx
components/
  shared/               → FlashToast, reusable cross-feature components
  ui/                   → shadcn/ui primitives + SelectDropdown
  stock/                → inventory-related components
  price-lists/          → price list management components
  dashboard/            → SalesHistoryTable and dashboard sub-components
  settings/             → SettingsForm, OperatorList, NewOperatorModal
  pos/                  → sales terminal components
lib/
  operator.ts           → UserRole, OWNER_PERMISSIONS, getActiveOperator()
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
  stats: true, price_lists: true, price_lists_write: true, settings: true,
  expenses: true
}
```

Permission map per route:
- `/stock` → `permissions.stock === true`
- `/price-lists` → `permissions.price_lists === true`
- `/dashboard`, `/stats` → `permissions.stats === true`
- `/settings` → `permissions.settings === true`

Owner identification in proxy: `operator?.role === 'owner'` or absence of `operator_session` cookie. Never use a DB lookup to identify the owner in middleware.

---

## Brands Module

- `products.brand_id` is always a FK to `brands.id` — never store brand as free text
- Brand assignment in forms uses a combobox (selection only, no free-text creation inline)
- New brands created via `BrandModal` using `create_brand_guarded` RPC
- Always join brands when fetching products: `brand_id, brands(id, name)`
- Map result: `brand: Array.isArray(p.brands) ? p.brands[0] ?? null : p.brands ?? null`

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

## Operator Session

- `operator_session` cookie: httpOnly, sameSite: lax — contains `{ profile_id, name, role: UserRole, permissions }`
- `op_perms` cookie: non-httpOnly — client-readable copy of permissions for sidebar
- Logout route: clears both cookies AND restores owner session before redirecting
- Registration flow: calls `/api/operator/logout` before redirecting to clear any stale cookies
- Flash messages: proxy sets `flash_toast=no-access` cookie (maxAge: 5, non-httpOnly) on unauthorized redirect; layout reads it server-side and passes to `FlashToast` component

---

## UI & Design

### No glass effects
Do not use `backdrop-filter`, `backdrop-blur`, or `bg-white/[0.xx]` anywhere. These effects are unreliable across browsers and have been removed from the project.

### Utility classes (defined in globals.css)
```css
.surface-elevated  → modals, dropdowns, popovers (solid opaque surface)
.surface-sidebar   → sidebar panel
.btn-primary-gradient → primary CTA button
.btn-danger        → destructive action button
```

### Component style reference
| Component | Style |
|---|---|
| Modals, dropdowns, popovers | `surface-elevated` |
| Sidebar | `surface-sidebar` |
| Primary CTA | `btn-primary-gradient` |
| Destructive action | `btn-danger` |
| Active nav item | `bg-primary/10 rounded-xl px-3 py-2` |

### Color palette
- **Primary:** `#1C4A3B` (dark green)
- **Background/Surface:** CSS variables only — never hardcoded hex in components
- Semantic: green = success, amber = warning, red = error/destructive, gray = inactive

### Typography
- Font: `DM Sans` via `next/font/google`
- Never mix more than 3 font sizes in a single card or panel

### Layout
- Sidebar: `position: fixed`, overlays content — never pushes layout
- Content area never has `margin-left` or `padding-left` based on sidebar state
- `SelectDropdown` component replaces all native `<select>` elements

### Iconography
- `lucide-react` exclusively — no other icon libraries
- Charts: `recharts` exclusively — no other chart libraries

---

## Component Structure

### Single responsibility + size limit
Each component does one thing. Extract sub-components when a file exceeds ~150 lines.

### Props
Always define props with a named `interface`. Never use optional props as a workaround for missing data. Guard nullable props at the call site, not by making the receiving prop nullable.

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
- Creating `public_read_*` RLS policies without `auth.role() = 'anon'` guard
- Making a DB lookup in proxy/middleware to identify the owner — use the cookie role
- Fetching `defaultPriceList` from anywhere other than `price_lists` where `is_default = true`
- Creating more than one `price_lists` row with `is_default = true` per business
- Upsert on `price_list_overrides` without the correct `onConflict` key
