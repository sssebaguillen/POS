# Technical Context — POS System

## Stack
- **Frontend:** Next.js (App Router) + TypeScript + Tailwind CSS + shadcn/ui
- **Backend:** Supabase (PostgreSQL + Auth + RLS)
- **Deploy:** Vercel
- **Supabase project:** `pos` (ID: `zrnthcznbrplzpmxmkwk`, region: `sa-east-1`)

---

## Database Architecture

### Multi-tenant model
Every business (tenant) is isolated by `business_id`. All tables use RLS enforced by the helper function `get_business_id()`, which resolves the authenticated user's business by reading their profile.

### Tables
```
businesses          → tenants (id, name, slug, plan, settings, whatsapp, logo_url, description)
profiles            → business users (id → auth.users, business_id, role, name, pin)
categories          → product categories (business_id, name, icon, position)
products            → products (business_id, category_id, name, sku, barcode, price, cost, stock)
customers           → customers (business_id, name, phone, email, dni, credit_balance)
cash_sessions       → cash register shifts (business_id, opened_by, closed_by, opening_amount)
sales               → sales (business_id, session_id, customer_id, subtotal, discount, total)
sale_items          → line items (sale_id, product_id, quantity, unit_price, total)
payments            → payments (sale_id, method, amount, reference)
inventory_movements → stock movements (business_id, product_id, type, quantity)
```

### Active trigger
`on_sale_item_inserted` → on every `sale_item` insert, automatically decrements stock and logs an inventory movement.

---

## RLS — Row Level Security

### Helper function
```sql
get_business_id() → uuid
-- Returns the business_id of the authenticated user from the profiles table
-- security definer, set search_path = public
```

### Active policies
| Table | Policy | Type |
|-------|--------|------|
| businesses | tenant_isolation | ALL → id = get_business_id() |
| profiles | own_profile | ALL → id = auth.uid() |
| profiles | insert_own_profile | INSERT → id = auth.uid() |
| categories | tenant_isolation | ALL → business_id = get_business_id() |
| products | tenant_isolation | ALL → business_id = get_business_id() |
| customers | tenant_isolation | ALL → business_id = get_business_id() |
| cash_sessions | tenant_isolation | ALL → business_id = get_business_id() |
| sales | tenant_isolation | ALL → business_id = get_business_id() |
| sale_items | tenant_isolation | ALL → via join on sales |
| payments | tenant_isolation | ALL → via join on sales |
| inventory_movements | tenant_isolation | ALL → business_id = get_business_id() |

---

## SQL Functions

### `bootstrap_new_user(p_user_id, p_business_name, p_user_name)`
Creates the business and user profile in a single server-side call.
Invoked via `supabase.rpc()` immediately after `signUp`.
Uses `security definer` + `set search_path = public` — does not depend on client session.
```sql
-- Returns: { success: boolean, business_id: uuid, error?: string }
```

### `get_business_id()`
RLS helper used by all tenant isolation policies. `security definer`, `set search_path = public`.

### `update_stock_on_sale()`
Trigger function. Decrements stock and logs inventory movement on `sale_item` insert.
`security definer`, `set search_path = public`.

---

## Registration Flow

```
1. supabase.auth.signUp({ email, password })
2. supabase.rpc('bootstrap_new_user', { p_user_id, p_business_name, p_user_name })
   → creates businesses + profiles via security definer (no client session required)
3. supabase.auth.signInWithPassword({ email, password })
4. router.push('/dashboard')
```

**File:** `app/(auth)/register/page.tsx` (client component)

---

## Inventory Flow

```
InventoryPage (server component)
  → reads profile → gets business_id
  → fetches products + categories filtered by RLS
  → passes businessId to <InventoryPanel />
```

**Important:** `businessId` must always come from the user's profile. Never infer it from product or category data.
**File:** `app/(dashboard)/inventory/page.tsx`

---

## Security Status
- RLS enabled on all tables
- `search_path` fixed on all SQL functions
- `insert_own_business` policy removed (was overly permissive; no longer needed)
- `bootstrap_new_user` is the only way to create a new business
- Public read-only policies added for catalog (SELECT only, no write):
  - `public_read_businesses` on businesses
  - `public_read_products` on products (is_active = true AND show_in_catalog = true)
  - `public_read_categories` on categories (is_active = true)
- Leaked password protection: requires Supabase Pro plan (pending for production)
- Email confirmation: disabled for development (enable before going to production)

---

## Roadmap

| Priority | Feature | Status |
|----------|---------|--------|
| P0 | Sales terminal (product grid + cart) | Components created, not yet connected |
| P0 | Payment modal (payment methods) | `PaymentModal.tsx` created |
| P1 | Stock screen with filters and CRUD | Route exists, not implemented |
| P1 | Daily sales history | Pending |
| P2 | Dashboard with KPIs and charts | Done |
| P2 | Statistics with ranking | Done |
| P3 | Catalog + WhatsApp order | **In progress** — spec defined, DB ready, policies applied |
| P3 | Settings (business, users, roles) | Business config done (name, whatsapp, logo_url, description) |
| P4 | PIN login | Email/password works; PIN flow needs to be adapted |

### Current focus
**P3 — Catalog + WhatsApp order**

---

## Pending decisions
- [ ] Google OAuth login (free on Supabase, pending implementation)
- [ ] Enable email confirmation for production
- [ ] Enable leaked password protection when upgrading to Pro
- [ ] User roles: currently only `owner`, schema supports `cashier` and others

---

## P3 Spec — Catalog + WhatsApp Order

### URL
Public page, no login required: `tuapp.com/catalogo/[slug]`
`slug` comes from `businesses.slug`

### Business data shown
- Name, logo (`businesses.logo_url`), description (`businesses.description`)
- WhatsApp number from `businesses.whatsapp` (set in Settings)

### Database changes applied
```sql
alter table businesses
  add column whatsapp text,
  add column logo_url text,
  add column description text;
```

### Catalog behavior
- Shows all products where `is_active = true`
- Products with `stock = 0` are shown but disabled (cannot be added to cart)
- Category filter via tabs or chips at the top
- Product grid: image, name, price, `+` button

### Cart and order form
- Floating cart or side panel with item list and totals
- Form fields: name (required), phone (required), take away / delivery toggle, address (required if delivery), notes (optional)

### WhatsApp message format
```
Hola! Quisiera hacer un pedido:

• 2x Pan sin TACC x500g — $2.400
• 1x Galletitas de arroz — $850

Total: $3.250

Nombre: Juan Pérez
Teléfono: 11-1234-5678
Entrega: Delivery
Dirección: Av. Corrientes 1234
```
Opens via `https://wa.me/[whatsapp]?text=[encoded message]`

### Files to create
- `app/catalogo/[slug]/page.tsx` — public Server Component, fetches business + products + categories
- `components/catalogo/CatalogView.tsx` — main client component, cart state lives here
- `components/catalogo/ProductGrid.tsx` — product grid with category filter chips
- `components/catalogo/CartPanel.tsx` — cart summary + order form + WhatsApp button
