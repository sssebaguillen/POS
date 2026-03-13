# GitHub Copilot Instructions — POS System

## Stack
- Next.js 14+ App Router + TypeScript (strict mode)
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
const endpoint = 'https://zrnthcznbrplzpmxmkwk.supabase.co'

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
  (dashboard)/
    dashboard/page.tsx
    inventory/page.tsx
    sales/page.tsx
components/
  ui/              → shadcn/ui primitives only
  stock/           → inventory-related components
  pos/             → sales terminal components
  shared/          → reusable components across features
lib/
  supabase/
    client.ts      → browser client
    server.ts      → server client
```

---

## UI & Design

### Color palette
The system uses a strict color palette. Do not introduce new colors outside of this set.
- **Primary:** dark green `#1C4A3B` — used for primary buttons, active nav items, key accents
- **Background:** off-white/cream `#F5F4F0` — main page background
- **Surface:** white `#FFFFFF` — cards, modals, sidebar
- **Border:** soft gray, low opacity — subtle, never heavy
- **Semantic status colors:**
  - Green → in stock / success
  - Yellow/amber → low stock / warning
  - Red → out of stock / error / destructive actions
  - Gray → discontinued / inactive

Never use arbitrary Tailwind colors like `bg-blue-500` or `text-purple-400` for UI elements. Use CSS variables or the palette above.

### Typography
- Section labels: small, uppercase, muted, tracked (`text-xs uppercase text-muted-foreground tracking-wide`)
- Card titles: medium weight, dark (`font-medium text-foreground`)
- Large values (prices, totals, KPIs): large and bold (`text-2xl font-bold` or larger)
- Supporting info: small and muted (`text-sm text-muted-foreground`)
- Never mix more than 3 font sizes in a single card or panel

### Components
- Cards: white background, rounded corners (`rounded-xl` or `rounded-2xl`), subtle border, soft shadow or none
- Buttons:
  - Primary: solid dark green, white text (`bg-primary text-white`)
  - Secondary: white background, border, dark text
  - Destructive: red, only for irreversible actions
  - Never use icon-only buttons without a tooltip
- Badges/status chips: small, colored background with matching text, no heavy borders
- Inputs: clean, minimal, placeholder in muted color
- Modals: white card centered, clear title, action buttons bottom right

### Layout
- Sidebar: fixed left, white, grouped nav sections with uppercase labels
- Header: sticky top bar — page title left, primary actions right
- Content area: off-white background, padded grid or flex layout
- Always respect horizontal padding — no full-bleed content

### Spacing and density
- Comfortable spacing — not cramped, not wasteful
- Consistent padding inside cards (`p-4` or `p-6`)
- Consistent gap between grid items (`gap-4` or `gap-6`)
- Use spacing to separate sections, not dividers — avoid overusing `<hr>` or border lines

### Iconography
- Use lucide-react exclusively — do not mix icon libraries
- Icons must be paired with a label unless the action is universally understood (close, search)

### Charts
- Use the primary green palette for fills — light green for bars/areas, dark green for active states
- Charts must always have labeled axes and a legend for multiple series
- Empty chart state: clean placeholder with a short message, never a broken chart
- Use recharts — do not introduce other chart libraries

---

## Component Structure

### Single responsibility
Each component does one thing. If a component handles both data fetching and complex rendering, split it.

### Size limit
If a component file exceeds ~150 lines, extract sub-components. Prefer many small focused files over one large file.

### Props
Always define props with a named `interface`, not inline types. Never use optional props as a workaround for missing data.

```ts
// WRONG
interface Props {
  product?: Product
  businessId?: string
}

// CORRECT — be explicit about what is truly optional
interface Props {
  product: Product
  businessId: string
  onEdit?: () => void  // genuinely optional callback
}
```

### Server vs Client components
- Default to Server Components — only add `'use client'` when you need interactivity or browser APIs
- Never fetch data inside a Client Component when a Server Component can pass it as props
- Keep Client Components as leaf nodes in the tree when possible

### Composition over configuration
Prefer composing small components over passing many props to a single large one.

---

## State Management

### Local state first
Use `useState` for UI state scoped to a single component (open/close, selected tab, form input).

### No global state for server data
Do not use Zustand, Context, or any global store for data that comes from Supabase. Re-fetch when needed.

### Forms
- Use controlled inputs (`value` + `onChange`)
- Clear error state when the user starts correcting a field
- Disable submit button while loading — never allow double submission
- Always show the real error from the server, not a generic message

### Loading, empty, and error states
Every data-dependent component must handle all three states explicitly:

```tsx
if (loading) return <SkeletonGrid />
if (error) return <ErrorMessage message={error.message} />
if (!products.length) return <EmptyState message="No products yet" />
return <ProductGrid products={products} />
```

---

## Next.js Best Practices

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

### Route and page structure
- Use route groups `(auth)` and `(dashboard)` to separate layouts
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
