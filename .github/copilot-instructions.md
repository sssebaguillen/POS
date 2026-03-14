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

### Creating business data
The only way to create a new business and profile is via the `bootstrap_new_user` RPC function.
Direct inserts into `businesses` from the client are blocked by RLS by design.

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
const { data, error } = await supabase.from('products').select('...')
```

### Client-side mutations (Client Components)
```ts
import { createClient } from '@/lib/supabase/client'

const supabase = createClient()
const { error } = await supabase.from('products').insert({ ... })
```

### Never use the service role key on the client
Server-side privileged operations must go through `security definer` SQL functions called via RPC.

---

## SQL Functions

All SQL functions must have:
- `security definer` if they need elevated privileges
- `set search_path = public` always — without this, they are vulnerable to search_path hijacking

```sql
-- CORRECT
create or replace function my_function()
returns void
language plpgsql
security definer
set search_path = public
as $$ ... $$;
```

---

## File Structure Conventions

```
app/
  (auth)/
    login/page.tsx
    register/page.tsx
  (app)/
    operator-select/page.tsx
    settings/page.tsx
    inventory/page.tsx
    price-lists/page.tsx
components/
  ui/              → shadcn/ui primitives only
  stock/           → inventory-related components
  price-lists/     → price list management components
  pos/             → sales terminal components
  shared/          → reusable components across features
lib/
  supabase/
    client.ts      → browser client
    server.ts      → server client
```

---

## Brands Module

Brands are a first-class entity in the `brands` table — never stored as free text on products.

### Rules
- `products.brand_id` is a FK to `brands.id` — always null or a valid brand ID
- Never store a brand name as a text field directly on a product
- Brand assignment in forms uses a combobox that searches existing brands — no free-text creation inline
- New brands are created via `BrandModal` (same pattern as `CategoryModal`)
- Deleting a brand sets `products.brand_id = null` via DB cascade (`ON DELETE SET NULL`) and removes related `price_list_overrides` via `ON DELETE CASCADE`
- When fetching products, always join brands: `brand_id, brands(id, name)`
- Map joined brands the same way categories are mapped: `brand: Array.isArray(p.brands) ? p.brands[0] ?? null : p.brands ?? null`

---

## Price Lists Module

### Runtime price calculation
The final selling price for a product in a given list is always:
```
final_price = cost × (product_override ?? brand_override ?? list.multiplier)
```
Priority: product-level override → brand-level override → list global multiplier.
Never calculate prices any other way.

### Default list rules
- Every business must have exactly one `price_lists` row with `is_default = true` once any list exists
- The default list is always fetched via `price_lists` where `is_default = true` and `business_id` matches — never inferred from other data
- The DB enforces uniqueness via a partial unique index on `(business_id) WHERE is_default = true`
- Never set more than one list as default in application code

### Override constraints
- Each `price_list_overrides` row targets either a `product_id` OR a `brand_id` — never both, never neither
- Enforced by a DB CHECK constraint and two UNIQUE constraints: `(price_list_id, product_id)` and `(price_list_id, brand_id)`
- Always use `upsert` with the correct `onConflict` key:
  - Product override: `onConflict: 'price_list_id,product_id'`
  - Brand override: `onConflict: 'price_list_id,brand_id'`

### Integration with product forms
- `NewProductModal` and `EditProductModal` accept `defaultPriceList: PriceList | null` as a prop
- When `cost` changes and a default list exists, `price` is auto-suggested as `cost × list.multiplier`
- If the user manually edits `price` to a value that diverges by more than `0.01`, a product-level override is upserted on save
- If the user returns the price to the suggested value, the override is deleted on save
- Override insert/delete is always best-effort — log errors, never block the product save flow

---

## UI & Design

### Theme system
The app supports light and dark modes via Tailwind's `dark:` variant and a `data-theme` attribute on `<html>`.
Theme is persisted in `localStorage` under the key `pos-theme` and applied before hydration to avoid flash.
Never hardcode a single-mode style — every visual decision must have both a light and a dark expression.

```tsx
// WRONG — single mode
<div className="bg-white text-black">

// CORRECT — both modes covered
<div className="bg-white dark:bg-zinc-900 text-zinc-900 dark:text-white">
```

---

### Color palette

#### Light mode
- **Primary:** dark green `#1C4A3B` — primary buttons, active nav items, key accents
- **Background:** off-white/cream `#F5F4F0` — main page background
- **Surface:** white `#FFFFFF` — cards, modals, sidebar
- **Border:** soft gray, low opacity — subtle, never heavy
- **Text primary:** `#111111`
- **Text secondary:** `#71717a` (zinc-500)

#### Dark mode
- **Primary:** same green `#1C4A3B` or lightened to `#2D6A56` for better contrast on dark
- **Background:** deep blue-gray gradient — `#0f2027 → #203a43 → #2c5364`
- **Surface:** `rgba(255,255,255,0.06)` — glass cards replace solid white surfaces
- **Border:** `rgba(255,255,255,0.10)` — subtle light border
- **Text primary:** `#ffffff`
- **Text secondary:** `rgba(255,255,255,0.50)`

Semantic status colors are the same in both modes:
- Green → in stock / success
- Yellow/amber → low stock / warning
- Red → out of stock / error / destructive actions
- Gray → discontinued / inactive

### Glass utility classes (dark mode only)

Defined in `globals.css` under `@layer utilities`:

```css
.glass-clear {
  @apply bg-white/[0.06] border border-white/[0.10] rounded-2xl;
  backdrop-filter: blur(20px) saturate(140%);
  -webkit-backdrop-filter: blur(20px) saturate(140%);
}

.glass-frosted {
  @apply bg-white/[0.12] border border-white/[0.18] rounded-2xl;
  backdrop-filter: blur(32px) saturate(160%);
  -webkit-backdrop-filter: blur(32px) saturate(160%);
}

.glass-pill-active {
  @apply bg-white/[0.15] rounded-xl px-3 py-2 transition-colors;
}

.glass-btn-primary {
  @apply rounded-2xl py-4 px-6 text-white font-bold text-base border border-white/20 transition-colors;
  background: linear-gradient(135deg, rgba(255,200,80,0.9), rgba(255,140,40,0.9));
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
}

.glass-btn-danger {
  @apply rounded-2xl py-4 px-6 text-white font-bold text-base border border-white/20 transition-colors;
  background: rgba(255,69,58,0.75);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
}
```

#### When to use each class

| Component | Light mode | Dark mode |
|---|---|---|
| Product card | white surface + border | `glass-clear` |
| Page header / topbar | white surface | `glass-clear` |
| Item list in cart | white surface | `glass-clear` |
| Nav sidebar | white surface | `glass-frosted` |
| Active nav item | green pill | `glass-pill-active` |
| Action modal (edit, delete) | white modal | `glass-frosted` |
| Totals / checkout panel | white card | `glass-frosted` |
| Context menu / dropdown | white popover | `glass-frosted` |
| Toasts / notifications | white card | `glass-frosted` |
| Primary CTA (confirm sale) | `bg-primary` green | `glass-btn-primary` |
| Destructive action | red button | `glass-btn-danger` |

#### Applying glass conditionally per theme

```tsx
<div className="bg-white border border-zinc-200 rounded-2xl dark:glass-clear dark:border-transparent">
<div className="bg-white border border-zinc-200 rounded-2xl shadow-sm dark:glass-frosted dark:border-transparent dark:shadow-none">
<nav className="bg-white border-r border-zinc-100 dark:glass-frosted dark:border-transparent">
```

#### Dark mode background
```tsx
// app/layout.tsx
<body className="bg-[#F5F4F0] dark:bg-gradient-to-br dark:from-[#0f2027] dark:via-[#203a43] dark:to-[#2c5364] min-h-screen">
```

---

### Typography
- Font: `DM Sans` (Google Fonts) — add to `layout.tsx` via `next/font/google`
- Section labels: `text-xs uppercase tracking-widest text-zinc-500 dark:text-white/50`
- Card titles: `font-medium text-zinc-900 dark:text-white`
- Large values (prices, totals, KPIs): `text-2xl font-bold tracking-tight text-zinc-900 dark:text-white`
- Supporting info: `text-sm text-zinc-500 dark:text-white/50`
- Never mix more than 3 font sizes in a single card or panel

---

### Components

#### Cards
- Light: `bg-white border border-zinc-200 rounded-2xl`
- Dark: `dark:glass-clear dark:border-transparent`

#### Buttons
- Primary: `bg-[#1C4A3B] text-white dark:glass-btn-primary`
- Secondary: `bg-white border border-zinc-200 text-zinc-900 dark:bg-white/10 dark:border-white/15 dark:text-white`
- Destructive: `bg-red-500 text-white dark:glass-btn-danger`
- Never use icon-only buttons without a tooltip

#### Inputs
- Light: `bg-white border border-zinc-200 text-zinc-900 placeholder:text-zinc-400`
- Dark: `dark:bg-white/[0.08] dark:border-white/[0.12] dark:text-white dark:placeholder:text-white/30`

#### Modals
- Light: white card, centered, `shadow-xl`
- Dark: `dark:glass-frosted dark:shadow-none`
- Action buttons always bottom right

---

### Layout
- Sidebar: fixed left, adapts per theme
- Header: sticky top bar — page title left, primary actions right
- Content area: off-white in light / transparent in dark
- Always respect horizontal padding — no full-bleed content

### Spacing and density
- Comfortable spacing — not cramped, not wasteful
- Consistent padding inside cards (`p-4` or `p-6`)
- Consistent gap between grid items (`gap-4` or `gap-6`)
- Use spacing to separate sections, not dividers

### Iconography
- Use lucide-react exclusively — do not mix icon libraries
- Icons must be paired with a label unless the action is universally understood (close, search)

### Charts
- Use recharts — do not introduce other chart libraries
- Charts must always have labeled axes and a legend for multiple series
- Empty chart state: clean placeholder with a short message, never a broken chart

---

## Component Structure

### Single responsibility
Each component does one thing. If a component handles both data fetching and complex rendering, split it.

### Size limit
If a component file exceeds ~150 lines, extract sub-components.

### Props
Always define props with a named `interface`. Never use optional props as a workaround for missing data.

```ts
// WRONG
interface Props {
  product?: Product
  businessId?: string
}

// CORRECT
interface Props {
  product: Product
  businessId: string
  onEdit?: () => void
}
```

### Server vs Client components
- Default to Server Components — only add `'use client'` when you need interactivity or browser APIs
- Never fetch data inside a Client Component when a Server Component can pass it as props
- Keep Client Components as leaf nodes in the tree when possible

---

## State Management

### Local state first
Use `useState` for UI state scoped to a single component.

### No global state for server data
Do not use Zustand, Context, or any global store for data that comes from Supabase.

### Forms
- Use controlled inputs (`value` + `onChange`)
- Clear error state when the user starts correcting a field
- Disable submit button while loading
- Always show the real error from the server

### Loading, empty, and error states
Every data-dependent component must handle all three states explicitly.

---

## Next.js Best Practices

### Parallel data fetching
Never await independent Supabase queries sequentially — always use `Promise.all`.

```ts
// WRONG
const { data: products } = await supabase.from('products').select()
const { data: categories } = await supabase.from('categories').select()

// CORRECT
const [{ data: products }, { data: categories }] = await Promise.all([
  supabase.from('products').select(),
  supabase.from('categories').select(),
])
```

### Route and page structure
- Use route groups `(auth)` and `(app)` to separate layouts
- Keep `page.tsx` thin — fetch data and pass it to a feature component
- Business logic lives in components, not in `page.tsx`

### Performance
- Use `next/image` for all images — never raw `<img>` tags
- Avoid `useEffect` for data fetching — use Server Components instead
- Never import heavy libraries inside components that re-render frequently

---

## What Copilot Should NOT Suggest

- Wrapping broken code in try/catch and returning a generic fallback
- Adding `|| null` or `?? undefined` to bypass TypeScript errors without fixing the type
- Creating default/mock data to make a component render when real data is missing
- Adding `// @ts-ignore` or `// @ts-expect-error` comments
- Duplicating a component instead of making the existing one reusable
- Importing from `@/lib/supabase/server` inside a Client Component
- Calling `supabase.auth.getUser()` inside a Client Component when a Server Component can pass the user as a prop
- Introducing new colors, fonts, or icon libraries not already in the stack
- Using `useEffect` to fetch data when a Server Component can do it
- Sequential `await` calls for independent Supabase queries
- Inline prop types instead of named interfaces
- Adding emojis anywhere in the codebase
- Writing `backdrop-filter` or `bg-white/10` inline — always use the `.glass-*` classes from globals.css
- Applying `.glass-*` classes without the `dark:` prefix — glass only activates in dark mode
- Hardcoding a single-mode color without its `dark:` counterpart
- Storing brand as a free-text field on products — always use `brand_id` FK to the `brands` table
- Calculating product prices with any formula other than `cost × (product_override ?? brand_override ?? list.multiplier)`
- Fetching the default price list from anywhere other than `price_lists` where `is_default = true` and `business_id` matches
- Creating more than one `price_lists` row with `is_default = true` per business
- Using upsert on `price_list_overrides` without specifying the correct `onConflict` key (`price_list_id,product_id` for product overrides, `price_list_id,brand_id` for brand overrides)
- Joining brands in a product query without mapping the result: always normalize `brands(id, name)` the same way `categories(name, icon)` is mapped
