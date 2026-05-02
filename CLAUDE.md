# Pulsar POS — Claude Code Reference

> **Source of truth for all AI sessions.** When this file and the code conflict, trust the code and update this file.
> Last verified against live Supabase: 2026-04-30.

---

## Skills

Skills location: `.agents/skills/`

| Skill | Trigger | Path |
|-------|---------|------|
| `impeccable` | Design, UI/UX critique, polish, layout, typography | `.agents/skills/impeccable/SKILL.md` |
| `design-taste-frontend` | High-end frontend visual design | `.agents/skills/design-taste-frontend/SKILL.md` |
| `high-end-visual-design` | Agency-grade visual standards | `.agents/skills/high-end-visual-design/SKILL.md` |
| `minimalist-ui` | Minimalist UI patterns | `.agents/skills/minimalist-ui/SKILL.md` |
| `gpt-taste` | Aesthetic judgment reference | `.agents/skills/gpt-taste/SKILL.md` |
| `redesign-existing-projects` | Redesign without breaking functionality | `.agents/skills/redesign-existing-projects/SKILL.md` |

---

## 1. Project Overview

**Pulsar POS** is a multi-tenant SaaS point-of-sale for SMBs in LATAM (primary market: Argentina). Target: almacén, kiosco, clothing store, ferretería owners who need a modern POS without expensive hardware. Free plan covers daily workflow.

**Name:** Double meaning — the physical act of pressing (tapping the screen) + neutron star (fast, dense, powerful). Target domain: `puls.ar`.

**Business model:** SaaS with plans `free → basic → standard → pro`. Billing features (facturación electrónica) are paid plans only.

### Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 16+ (App Router, Turbopack, React Compiler), TypeScript strict, Tailwind CSS, shadcn/ui |
| Client data | `@tanstack/react-query` — staleTime 30s, gcTime 5min, retry 1 |
| Backend | Supabase (PostgreSQL + Auth + Storage + RLS) |
| Deploy | Vercel, project `pulsarpos`, repo `github.com/sssebaguillen/POS` (master), region `gru1 (São Paulo)` |
| Analytics | PostHog (EU endpoint via `/ingest/*` rewrites) |
| Supabase project ID | `zrnthcznbrplzpmxmkwk` (sa-east-1) — ⚠️ CONTEXT.md has a typo: `zrnthycznbrplzpmxmkwk` |
| Supabase plan | FREE — do not suggest paid-plan features (e.g. Leaked Password Protection) |

---

## 2. Architecture Rules

### Middleware / Routing

- **ALWAYS use `src/proxy.ts`, NEVER `middleware.ts`.** Next.js 16+ resolves `src/proxy.ts` as the middleware entry point in this project. The file exports `proxy(request: NextRequest)` and `config.matcher`.
- CSP headers are set in `proxy.ts`. Static security headers (`X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`) are set via `next.config.ts`.
- No `backdrop-filter`, `backdrop-blur`, or glass effects anywhere.

### Multi-tenancy

- Every data table has `business_id` with RLS enforced via `get_business_id()` (STABLE, SECURITY DEFINER).
- Server Components always include `.eq('business_id', businessId)` as defense-in-depth even though RLS already enforces it.
- `business_id` always comes from `profiles.business_id` — never inferred from other data.

### Auth — Owner

- Owner authenticates with Supabase Auth (email + password).
- On `/operator-select`, owner enters the same Supabase password as their "PIN".
- Password recovery: PKCE flow via `/auth/callback?type=recovery` → `exchangeCodeForSession` → redirect to `/auth/update-password`. The `redirectTo` must point to `/auth/callback?type=recovery`, NOT to `/auth/update-password` directly (that triggers the legacy implicit flow with hash instead of PKCE with `?code=`).

### Auth — Operators

- Sub-operators authenticate with a 4-digit PIN, bcrypt-hashed via `pgcrypto`.
- PIN is normalized to digits-only, max 4 digits, in `/api/operator/switch/route.ts`.
- Active session stored in cookie `operator_session` (httpOnly, sameSite: lax, secure in prod):
  ```json
  { "profile_id": "uuid", "name": "string", "role": "UserRole", "permissions": { ...10 fields... } }
  ```
- Cookie `op_perms` (non-httpOnly) — copy of permissions for client-side sidebar reads.
- Owner identified by `operator?.role === 'owner'` or absence of cookie — **never by DB lookup in proxy**.
- Sub-operators live in `operators` table. Owner lives only in `profiles`. **Owner NEVER has a row in `operators`.**

### Auth — Server Components

Helpers in `lib/business.ts`:
- `getBusinessIdByUserId(supabase, userId)` → `string | null`
- `requireAuthenticatedBusinessId(supabase)` → `string` (throws if no user or businessId)
- `requireAuthenticatedBusinessContext(supabase)` → `{ userId, businessId }`

**Prefer `requireAuthenticatedBusinessId` in page components.**

### Operator Switch / Logout

- **ALWAYS** use `window.location.href = '/pos'` after operator switch — **NEVER** `router.push + router.refresh`. The `op_perms` cookie is read by the sidebar; client-side navigation leaves it stale.
- `/api/operator/logout` only deletes cookies — **NEVER** restores the owner session (privilege escalation vector).

### Sidebar Collapsed State (CLS-free)

- Initialized from cookie `pos-sidebar-collapsed` read in `(app)/layout.tsx`.
- Passed as prop `initialCollapsed` to `AppShell` — no `useEffect` post-hydration.
- Toggle writes `document.cookie` + `localStorage`.

### Hydration (mounted pattern)

Mandatory for any component that reads `localStorage` for UI:
```typescript
const [mounted, setMounted] = useState(false)
useEffect(() => setMounted(true), [])
const themeForUi = mounted ? theme : 'dark' // SSR-safe default
```
Applied in: `sidebar.tsx`, `theme.tsx` (ThemeToggle), `CatalogThemeProvider.tsx`, `CatalogView.tsx` (viewMode).

### POS — Sale Flow

- Sales created atomically via `create_sale_transaction` RPC.
- Trigger `update_stock_on_sale` decrements stock automatically on `sale_items` insert.
- Cart store (`lib/store/cart.store.ts`) holds base price; `calculateProductPrice` applied at render and checkout.
- **Price override per line:** `priceIsManual` in Zustand excludes item from price-list recalculation. `unit_price_override` + `override_reason` persisted in `sale_items`.

### Price Calculation

`calculateProductPrice` in `lib/price-lists.ts` is the **only** source of truth for prices — never calculate inline in components.

Resolution order:
1. `cost > 0` → `cost × (product_override ?? brand_override ?? list.multiplier)`
2. `cost = 0, price > 0` → use `price` directly
3. Both 0 → return 0

When `unit_price_override` exists in a sale item, it takes precedence over everything.

### Price Lists — Manual Price Conflict

- `isPriceEdited = true` whenever the user edits price in the product form, even without an active price list.
- When creating/editing a price list that affects products with manual prices: show amber alert with affected list + two options: overwrite with list margin, or create `price_list_overrides` to preserve manual prices.

### Public Catalog

URL: `/catalogo/[slug]`

- **NEVER** direct queries to `products`/`categories` from anon client — always use RPCs:
  - `get_catalog_products(p_slug)` — SECURITY DEFINER, GRANT EXECUTE TO anon
  - `get_catalog_categories(p_slug)` — SECURITY DEFINER, GRANT EXECUTE TO anon
- Anon client: `persistSession: false, autoRefreshToken: false`.

### React Query

- Provider: `providers/query-provider.tsx`
- `createClient()` always inside `useMemo(() => createClient(), [])` in Client Components.
- Parallel independent queries in Server Components always via `Promise.all`.

### Mercadería Expenses (P9 partial)

The `expense_items` table and its RPCs (`create_mercaderia_expense`, `update_mercaderia_expense`) implement the stock-purchasing flow from `/expenses`. When a mercadería expense is saved, it can:
- Create `expense_items` line-items per product.
- Increment `products.stock`.
- Optionally update `products.cost` (with conflict detection on edit).
- Insert `inventory_movements` with `type = 'purchase'`, `reference_id = expense_id`.

The `update_mercaderia_expense` RPC performs delta-based stock reconciliation — it reverts removed items, applies quantity deltas, and warns on cost conflicts.

### General SQL Rules

- All RPC functions: `SECURITY DEFINER` + `set search_path = public, extensions`.
- `pgcrypto` functions: call as `extensions.crypt()` / `extensions.gen_salt()` — without the search_path, PostgreSQL won't find them.
- `create_operator` and `update_operator` return JSON — always check `data.success`, not just `error`.
- RPCs that return `{ data: [...] }`: always extract `.data` — never iterate the wrapper directly:
  ```ts
  const { data: rpcResult } = await supabase.rpc('get_top_products_detail', { ... })
  const rows = (rpcResult as unknown as { data: RowType[] } | null)?.data ?? []
  ```

---

## 3. Key Files

```
src/
├── proxy.ts                              # Middleware: route protection, CSP, cookie refresh
├── providers/
│   └── query-provider.tsx                # React Query provider
├── lib/
│   ├── business.ts                       # getBusinessIdByUserId, requireAuthenticatedBusinessId
│   ├── operator.ts                       # UserRole, Permissions (10 fields), OWNER_PERMISSIONS,
│   │                                     # getActiveOperator, parsePermissions, normalizePermissions
│   ├── payments.ts                       # normalizePayment, PAYMENT_LABELS, PAYMENT_COLORS, PAYMENT_OPTIONS
│   ├── price-lists.ts                    # calculateProductPrice — sole price calculation source
│   ├── date-utils.ts                     # DateRangePeriod, getDateRange, resolveDateRange, buildDateParams
│   ├── format.ts                         # formatMoney, formatNumber
│   ├── mappers.ts                        # normalizePriceList, unwrapRelation
│   ├── validation.ts                     # validateImageUrl, BUSINESS_SLUG_REGEX
│   ├── utils.ts                          # cn() and general utilities
│   ├── constants/
│   │   └── domain.ts                     # Typed role/payment values, domain constants
│   ├── store/
│   │   └── cart.store.ts                 # POS cart state (Zustand)
│   ├── printer/
│   │   ├── escpos.ts                     # ESC/POS command generation
│   │   ├── receipt.ts                    # Receipt print logic
│   │   └── types.ts
│   ├── types/
│   │   └── index.ts                      # Central types (UserRole, Permissions, entities, stats, CartItem)
│   └── supabase/
│       ├── client.ts                     # Browser Supabase client
│       └── server.ts                     # Server Supabase client
├── app/
│   ├── (auth)/
│   │   ├── login/page.tsx
│   │   └── register/page.tsx
│   ├── auth/
│   │   ├── callback/route.ts             # PKCE: exchangeCodeForSession → redirect by type
│   │   └── update-password/page.tsx      # New password form (session already set by callback)
│   ├── (app)/
│   │   ├── layout.tsx                    # Reads collapsed cookie → AppShell, theme, QueryProvider, FlashToast
│   │   ├── operator-select/page.tsx      # edge — operator selection with PIN
│   │   ├── settings/page.tsx             # ⚠️ uses getUser() + try/catch instead of requireAuthenticatedBusinessId
│   │   ├── inventory/page.tsx
│   │   ├── products/page.tsx
│   │   ├── price-lists/page.tsx
│   │   ├── dashboard/page.tsx            # edge — denormalizes operator_name + product names for SalesHistoryTable
│   │   ├── expenses/page.tsx             # Expenses + /expenses/providers sub-route
│   │   ├── stats/page.tsx                # edge
│   │   ├── stats/top-products/page.tsx
│   │   ├── stats/breakdown/page.tsx
│   │   ├── stats/payment-methods/page.tsx
│   │   ├── stats/operators/page.tsx
│   │   ├── profile/page.tsx              # Owner only
│   │   ├── operator/me/page.tsx          # Active operator personal profile
│   │   └── pos/page.tsx                  # edge
│   ├── api/operator/
│   │   ├── switch/route.ts               # Writes operator_session + op_perms (10 permissions)
│   │   └── logout/route.ts               # Only deletes cookies — NEVER restores owner session
│   └── catalogo/
│       ├── layout.tsx                    # CatalogThemeProvider wrapper
│       └── [slug]/page.tsx
└── components/
    ├── shared/
    │   ├── AppShell.tsx                  # Layout shell with SidebarContext
    │   ├── FlashToast.tsx                # Toast from cookie flash_toast (maxAge 5s)
    │   ├── PageHeader.tsx                # breadcrumbs?: { label: string; href: string }[]
    │   ├── DateRangeFilter.tsx           # today/week/month/quarter/year/custom
    │   ├── ExportCSVButton.tsx
    │   ├── KPICard.tsx
    │   ├── ConfirmModal.tsx
    │   ├── Toast.tsx                     # Imperative toast (separate from FlashToast)
    │   └── theme.tsx                     # useTheme hook (mounted pattern for SSR)
    ├── ui/                               # shadcn/ui primitives
    │   ├── SelectDropdown.tsx            # Replaces all native <select> elements
    │   └── ...
    ├── auth/
    │   └── UpdatePasswordView.tsx        # New password form — does NOT use onAuthStateChange
    ├── sidebar.tsx                       # 5 semantic sections; mounted pattern for ThemeToggle
    ├── pos/
    │   ├── POSView.tsx
    │   ├── ProductPanel.tsx
    │   ├── CartPanel.tsx                 # Price override per line + EditSalePanel embedded
    │   ├── PaymentModal.tsx
    │   ├── ReceiptPreviewModal.tsx
    │   ├── ReceiptTemplate.tsx
    │   └── types.ts
    ├── operator/
    │   ├── OperatorSelectView.tsx        # Forgot password button (when isOwnerSelected && error)
    │   └── OperatorSwitcher.tsx
    ├── dashboard/                        # ⚠️ DashboardView.tsx lives in analytics/ — needs moving
    │   ├── SalesHistoryTable.tsx         # 100% in-memory filter — data denormalized from page.tsx
    │   ├── BalanceWidget.tsx
    │   └── utils.ts
    ├── stats/                            # ⚠️ StatsView.tsx lives in analytics/ — needs moving
    │   ├── TopProductsDetailView.tsx
    │   ├── BreakdownDetailView.tsx
    │   ├── PaymentMethodDetailView.tsx
    │   └── OperatorSalesDetailView.tsx
    ├── inventory/
    │   ├── InventoryPanel.tsx            # ~1291 lines — refactor pending post-beta
    │   ├── NewProductModal.tsx
    │   ├── EditProductModal.tsx
    │   ├── ImportProductsModal.tsx
    │   ├── BulkActionBar.tsx
    │   ├── FilterSidebar.tsx
    │   ├── CategoryModal.tsx
    │   ├── BrandModal.tsx
    │   └── types.ts
    ├── price-lists/
    │   ├── PriceListsPanel.tsx
    │   ├── NewPriceListModal.tsx         # Conflict alert for manual prices
    │   ├── EditPriceListModal.tsx
    │   ├── ProductOverrideModal.tsx
    │   └── BrandOverrideModal.tsx
    ├── expenses/
    │   ├── types.ts
    │   ├── ExpensesView.tsx
    │   ├── NewExpensePanel.tsx
    │   ├── EditExpensePanel.tsx          # Edit existing expense
    │   ├── MercaderiaItemsSection.tsx    # Line-item editor for mercadería expenses
    │   ├── ProductSearchInput.tsx        # Product lookup for expense items
    │   ├── ProvidersView.tsx             # /expenses/providers tab view
    │   ├── ExpenseSummaryCards.tsx
    │   ├── ExpensesTable.tsx
    │   ├── ExpenseAttachmentUploader.tsx
    │   ├── ExpenseAttachmentModal.tsx
    │   ├── SupplierSelectDropdown.tsx
    │   └── SuppliersPanel.tsx
    ├── settings/
    │   ├── SettingsForm.tsx              # Slug input with puls.ar/{slug} preview + client-side validation
    │   ├── OperatorList.tsx
    │   ├── NewOperatorModal.tsx          # 10 permission toggles
    │   ├── EditOperatorModal.tsx
    │   └── types.ts
    ├── profile/
    │   └── ProfileView.tsx
    ├── operator-profile/
    │   └── OperatorProfileView.tsx       # Operator personal profile (/operator/me)
    └── catalog/
        ├── CatalogView.tsx               # viewMode starts as 'grid' (SSR-safe), useEffect reads localStorage
        ├── CatalogHeader.tsx
        ├── ProductGrid.tsx
        ├── CartPanel.tsx
        ├── CatalogThemeProvider.tsx
        └── types.ts
```

**Edge Runtime** (`export const runtime = 'edge'`): `/pos`, `/dashboard`, `/stats`, `/operator-select`

---

## 4. Database Schema

### Connection

- Project ID: `zrnthcznbrplzpmxmkwk`
- URL: `https://zrnthcznbrplzpmxmkwk.supabase.co`
- Region: sa-east-1

> All tables have RLS enabled. All policies use `get_business_id()` as the tenant boundary.

---

### `businesses`
| column | type | notes |
|--------|------|-------|
| id | uuid PK | gen_random_uuid() |
| name | text | |
| slug | text UNIQUE | CHECK: `^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$` (3–50 chars) |
| plan | text | default `'free'` |
| settings | jsonb | default `'{"currency":"ARS"}'`. Supported keys: `currency` (ISO 4217: ARS\|USD\|EUR\|BRL\|CLP\|UYU\|PEN\|COP\|MXN\|PYG\|BOB), `logo_upload_path` (storage path for uploaded logo), `primary_color` (hex). **Always merge with spread — never replace the whole object.** |
| created_at | timestamptz | now() |
| whatsapp | text nullable | digits + country code only |
| logo_url | text nullable | |
| description | text nullable | visible in public catalog |

> **Correction vs CONTEXT.md:** `accounting_enabled` column does NOT exist in the live DB. The `settings` JSONB also supports `currency` and `logo_upload_path` keys (not just `primary_color`).

---

### `profiles`
| column | type | notes |
|--------|------|-------|
| id | uuid PK | FK → auth.users(id) |
| business_id | uuid nullable | FK → businesses(id) |
| role | text | default `'cashier'` (but in practice always `'owner'` for rows that exist here) |
| name | text | |
| pin | text nullable | not used for owner |
| created_at | timestamptz | now() |
| avatar_url | text nullable | |
| onboarding_state | jsonb | default `'{"completed":false,"tour_done":false,"steps_done":[],"wizard_step":0}'`. Keys: `completed` (bool), `wizard_step` (int 0-4), `steps_done` (array: `business_info\|category\|product\|operator`), `tour_done` (bool). |

> **Correction vs CONTEXT.md:** `onboarding_state` column exists and is documented here for the first time. `permissions` JSONB column was removed (confirmed absent from live schema).

RLS policies: `own_profile` (ALL where id = auth.uid()), `tenant_select_profiles` (SELECT where business_id = get_business_id()), `insert_own_profile` (INSERT).

---

### `operators`
| column | type | notes |
|--------|------|-------|
| id | uuid PK | gen_random_uuid() |
| business_id | uuid | FK → businesses(id) |
| name | text | |
| role | text | CHECK: `('cashier','manager','custom')` — no `'owner'` |
| pin | text | bcrypt via `extensions.crypt()` |
| permissions | jsonb | default has 9 keys (no `price_override` — soft-defaults to false in code) |
| is_active | bool | default true |
| created_at | timestamptz | now() |

---

### `categories`
| column | type | notes |
|--------|------|-------|
| id | uuid PK | gen_random_uuid() |
| business_id | uuid nullable | FK → businesses(id) |
| name | text | |
| icon | text nullable | default `'📦'` |
| position | int nullable | default 0 |
| is_active | bool nullable | default true |
| created_at | timestamptz | now() |

---

### `brands`
| column | type | notes |
|--------|------|-------|
| id | uuid PK | gen_random_uuid() |
| business_id | uuid | FK → businesses(id) |
| name | text | UNIQUE (business_id, name) |
| created_at | timestamptz | now() |

---

### `products`
| column | type | notes |
|--------|------|-------|
| id | uuid PK | gen_random_uuid() |
| business_id | uuid nullable | FK → businesses(id) |
| category_id | uuid nullable | FK → categories(id) |
| brand_id | uuid nullable | FK → brands(id) |
| name | text | |
| sku | text nullable | |
| barcode | text nullable | |
| price | numeric | default 0 |
| cost | numeric nullable | default 0 |
| stock | int | default 0 |
| min_stock | int nullable | default 0 |
| image_url | text nullable | HTTPS URL — `product-images` bucket or external URL |
| image_source | text nullable | CHECK: `('upload','url')`. Both null or both non-null. |
| is_active | bool nullable | default true |
| show_in_catalog | bool nullable | default true |
| sales_count | int nullable | default 0 |
| created_at | timestamptz | now() |

**Images:** `image_source = 'upload'` → path in bucket `product-images` (public). Storage path: `{businessId}/{uuid}.{ext}` — first segment is `businessId`, not `product.id`. Use `next/image` with `unoptimized={image_source === 'url'}` for external URLs.

---

### `price_lists`
| column | type | notes |
|--------|------|-------|
| id | uuid PK | gen_random_uuid() |
| business_id | uuid | FK → businesses(id) |
| name | text | |
| description | text nullable | |
| multiplier | numeric | default 1.0 — represents margin: 1.40 = 40% over cost |
| is_default | boolean | default false — unique partial index WHERE is_default = true |
| created_at | timestamptz | now() |

UI: user enters percentage (e.g. 40%) → stored as multiplier (1.40). Conversion only in UI, never in DB.

---

### `price_list_overrides`
| column | type | notes |
|--------|------|-------|
| id | uuid PK | gen_random_uuid() |
| price_list_id | uuid | FK → price_lists(id) ON DELETE CASCADE |
| product_id | uuid nullable | FK → products(id) ON DELETE CASCADE |
| brand_id | uuid nullable | FK → brands(id) ON DELETE CASCADE |
| multiplier | numeric | |
| created_at | timestamptz | now() |

Constraints: override by product OR by brand, never both or neither. UNIQUE (price_list_id, product_id), UNIQUE (price_list_id, brand_id).

---

### `sales`
| column | type | notes |
|--------|------|-------|
| id | uuid PK | gen_random_uuid() |
| business_id | uuid nullable | FK → businesses(id) |
| session_id | uuid nullable | FK → cash_sessions(id) |
| customer_id | uuid nullable | FK → customers(id) |
| operator_id | uuid nullable | FK → operators(id) |
| price_list_id | uuid nullable | FK → price_lists(id) ON DELETE SET NULL |
| subtotal | numeric | default 0 |
| discount | numeric nullable | default 0 |
| total | numeric | default 0 |
| status | text nullable | CHECK: `('completed','cancelled','refunded')` — default `'completed'` |
| notes | text nullable | |
| created_at | timestamptz | now() |

> **Correction vs CONTEXT.md:** Status CHECK is `('completed','cancelled','refunded')`, NOT `('pending','completed','cancelled')`. `pending` doesn't exist; `refunded` does.

---

### `sale_items`
| column | type | notes |
|--------|------|-------|
| id | uuid PK | gen_random_uuid() |
| sale_id | uuid nullable | FK → sales(id) |
| product_id | uuid nullable | FK → products(id) |
| quantity | int | default 1 |
| unit_price | numeric | price at time of sale |
| unit_price_override | numeric nullable | manually edited price in POS |
| override_reason | text nullable | free-text reason |
| total | numeric | |

---

### `payments`
| column | type | notes |
|--------|------|-------|
| id | uuid PK | gen_random_uuid() |
| sale_id | uuid nullable | FK → sales(id) |
| method | text | CHECK: `('cash','card','transfer','mercadopago')` |
| amount | numeric | |
| reference | text nullable | |
| status | text nullable | CHECK: `('completed','pending','refunded','cancelled')` — default `'completed'` |
| created_at | timestamptz | now() |

> **Correction vs CONTEXT.md:** method CHECK has only 4 values — `credit` and `otro` are NOT in the live schema. Status CHECK has `'refunded','cancelled'`, NOT `'failed'`.

---

### `inventory_movements`
| column | type | notes |
|--------|------|-------|
| id | uuid PK | gen_random_uuid() |
| business_id | uuid nullable | FK → businesses(id) |
| product_id | uuid nullable | FK → products(id) |
| type | text | CHECK: `('sale','purchase','adjustment','return')` |
| quantity | int | |
| reason | text nullable | human-readable reason |
| reference_id | uuid nullable | FK to source record (e.g. expense_id for purchases) |
| created_by | uuid nullable | legacy — no active FK (M-3, deferred) |
| created_by_operator | uuid nullable | FK → operators(id) — active field |
| created_at | timestamptz | now() |

> **Correction vs CONTEXT.md:** `reason` and `reference_id` columns exist in live DB but were not documented.

---

### `cash_sessions`
| column | type | notes |
|--------|------|-------|
| id | uuid PK | gen_random_uuid() |
| business_id | uuid nullable | FK → businesses(id) |
| opened_by | uuid nullable | FK → profiles(id) — G-3: should FK to operators |
| closed_by | uuid nullable | FK → profiles(id) |
| opening_amount | numeric nullable | default 0 |
| closing_amount | numeric nullable | |
| expected_amount | numeric nullable | |
| opened_at | timestamptz | now() |
| closed_at | timestamptz nullable | |
| notes | text nullable | |

> **Correction vs CONTEXT.md:** `status` and `difference` columns do NOT exist in live DB. `notes` exists instead.

---

### `customers`
| column | type | notes |
|--------|------|-------|
| id | uuid PK | gen_random_uuid() |
| business_id | uuid nullable | FK → businesses(id) |
| name | text | |
| phone | text nullable | |
| email | text nullable | |
| dni | text nullable | |
| credit_balance | numeric nullable | default 0 |
| notes | text nullable | |
| created_at | timestamptz | now() |

---

### `suppliers`
| column | type | notes |
|--------|------|-------|
| id | uuid PK | gen_random_uuid() |
| business_id | uuid | FK → businesses(id) |
| name | text | |
| contact_name | text nullable | |
| phone | text nullable | |
| email | text nullable | |
| address | text nullable | |
| notes | text nullable | |
| is_active | bool | default true |
| created_at | timestamptz | now() |

---

### `expenses`
| column | type | notes |
|--------|------|-------|
| id | uuid PK | gen_random_uuid() |
| business_id | uuid | FK → businesses(id) |
| operator_id | uuid nullable | FK → operators(id) ON DELETE SET NULL |
| supplier_id | uuid nullable | FK → suppliers(id) ON DELETE SET NULL |
| category | expense_category ENUM | `'mercaderia','alquiler','servicios','seguros','proveedores','sueldos','otro'` — default `'otro'` |
| amount | numeric | CHECK > 0 |
| description | text | |
| date | date | default CURRENT_DATE |
| attachment_url | text nullable | path in bucket `expense-receipts` |
| attachment_type | expense_attachment_type ENUM nullable | `'image','pdf','spreadsheet','other'` |
| attachment_name | text nullable | |
| notes | text nullable | |
| created_at | timestamptz | now() |
| updated_at | timestamptz | auto-updated by `set_updated_at` trigger |

Storage: `expense-receipts` bucket — private, 10MB max. Path: `{business_id}/{uuid}.{ext}`.

---

### `expense_items` ⭐ new — not in CONTEXT.md

Line items for `category = 'mercaderia'` expenses. Enables stock ingestion from the expenses module.

| column | type | notes |
|--------|------|-------|
| id | uuid PK | gen_random_uuid() |
| business_id | uuid | FK → businesses(id) |
| expense_id | uuid | FK → expenses(id) |
| product_id | uuid nullable | FK → products(id) — null allowed for unnamed items |
| product_name | text | captured at time of expense |
| quantity | int | CHECK > 0 |
| unit_cost | numeric | CHECK >= 0 |
| subtotal | numeric (generated) | `quantity * unit_cost` |
| update_cost | bool | default false — if true, updates `products.cost` on save |
| created_at | timestamptz | now() |

---

### `invoices`
| column | type | notes |
|--------|------|-------|
| id | uuid PK | |
| business_id | uuid | |
| sale_id | uuid | FK → sales(id) |
| provider | text | e.g. `'facturama'`, `'alegra'` |
| external_id | text | ID at the external provider |
| status | text | |
| pdf_url | text nullable | |
| created_at | timestamptz | |

Currently unused (P10, paid plans).

---

### RLS Policies Summary

All tables enforce tenant isolation via `get_business_id()`. Key exceptions:

| table | policy | effect |
|-------|--------|--------|
| businesses | `public_read_businesses` | anon can SELECT (for catalog slug lookup) |
| categories | `public_read_categories` | anon can SELECT (for catalog) |
| products | `public_read_products` | anon can SELECT (for catalog) |
| profiles | `own_profile` | user can only access their own row via `auth.uid()` |
| profiles | `tenant_select_profiles` | SELECT also by business_id (for operator lookups) |
| profiles | `insert_own_profile` | anyone can INSERT (registration flow) |
| payments | `tenant_isolation` | via sub-select on sales.business_id |
| sale_items | `tenant_isolation` | via sub-select on sales.business_id |
| price_list_overrides | `tenant_isolation` | via sub-select on price_lists.business_id |
| expense_items | `owner_manage_expense_items` | business_id = get_business_id() |

---

## 5. Permissions Model

### `Permissions` interface — 10 fields

Defined in `lib/operator.ts`. All 10 must be present when constructing the object manually.

| field | description | owner | manager | cashier |
|-------|-------------|-------|---------|---------|
| `sales` | POS terminal | ✓ | ✓ | ✓ |
| `stock` | View inventory | ✓ | ✓ | ✓ |
| `stock_write` | Modify inventory | ✓ | ✓ | ✗ |
| `stats` | Dashboard & statistics | ✓ | ✓ | ✗ |
| `price_lists` | View price lists | ✓ | ✓ | ✗ |
| `price_lists_write` | Modify price lists | ✓ | ✓ | ✗ |
| `expenses` | View and create expenses | ✓ | ✓ | ✗ |
| `settings` | Business settings | ✓ | ✗ | ✗ |
| `operators_write` | Create/edit operators (sub-toggle of settings) | ✓ | ✗ | ✗ |
| `price_override` | Edit per-item price in POS | ✓ | ✓ | ✗ |

> `operators_write` requires `settings: true` as prerequisite — it's a sub-toggle in `NewOperatorModal`.
>
> **Note on CONTEXT.md:** it says "9 campos" but there are 10. `price_override` is the 10th.

### `OWNER_PERMISSIONS`

Defined in `lib/operator.ts`. All 10 fields set to `true`. Imported everywhere — never duplicate.

### `operator_session` cookie

```json
{
  "profile_id": "uuid",
  "name": "string",
  "role": "owner|manager|cashier|custom",
  "permissions": { ...all 10 fields... }
}
```

httpOnly, sameSite: lax, secure in production.

### `op_perms` cookie

Non-httpOnly copy of `permissions` object. Read by sidebar client-side. Written by `proxy.ts` on every request and by `/api/operator/switch`.

### `parsePermissions` soft defaults

`price_override` and `operators_write` soft-default to `false` if absent from the cookie (backward compat with old cookies that predated these fields).

### When adding a new permission field

Update ALL of these in the same commit:
1. `lib/operator.ts` — `Permissions` interface + `OWNER_PERMISSIONS` + `DEFAULT_PERMISSIONS`
2. `lib/operator.ts` — `parsePermissions` + `normalizePermissions`
3. `src/app/api/operator/switch/route.ts` — `parseVerifyResult`
4. `src/components/sidebar.tsx`
5. `src/components/settings/NewOperatorModal.tsx`
6. DB: `operators.permissions` default JSONB

---

## 6. Naming and Language Conventions

- **Codebase language:** English — all files, variables, functions, types, comments, DB columns.
- **UI language:** Spanish only — all labels, button text, error messages, placeholders visible to users.
- DB values that appear in the UI (e.g. category names, expense categories) are stored in English/neutral form and translated in the frontend.
- No emojis in code. No hardcoded values. No `any` types.
- Named interfaces for all props.
- File and directory naming: kebab-case for files, PascalCase for React components.

### Routes

All routes are in English: `/stats/payment-methods`, `/stats/operators`, `/stats/breakdown`, `/stats/top-products`.

### Design System

- **Background:** CSS var `--background` | **Surface:** `--surface` | **Primary:** `#7a3e10` (warm brown, overridable via `businesses.settings.primary_color`)
- **Typography:** DM Sans — 7 semantic classes in `globals.css`: `.text-display`, `.text-heading`, `.text-subheading`, `.text-body`, `.text-caption`, `.text-label`, `.text-metric`
- Custom properties: `--body-secondary`, `--support`
- Cards: `rounded-xl` / `rounded-2xl`, subtle border, class `surface-card`
- Dropdowns/popovers: class `surface-elevated`
- Sidebar: class `surface-sidebar`
- Filter chips: `pill-tabs` (container) / `pill-tab` (inactive) / `pill-tab-active` (active) — use everywhere **except** POS ProductPanel (intentional own style with `rounded-full`, `bg-primary` active)
- Icons: lucide-react | Charts: recharts
- No `backdrop-filter` or `backdrop-blur` anywhere
- No `<form>` HTML — use onClick/onChange handlers

### Breadcrumbs

`PageHeader` accepts `breadcrumbs?: { label: string; href: string }[]`. Required on sub-routes, not on top-level routes.

| Route | breadcrumbs |
|-------|------------|
| `/stats/top-products` | `[{ label: 'Estadísticas', href: '/stats' }]` |
| `/stats/breakdown` | `[{ label: 'Estadísticas', href: '/stats' }]` |
| `/stats/payment-methods` | `[{ label: 'Estadísticas', href: '/stats' }]` |
| `/stats/operators` | `[{ label: 'Estadísticas', href: '/stats' }]` |

---

## 7. SQL Functions Reference

All SECURITY DEFINER, all with `set search_path = public, extensions`.

| function | description |
|----------|-------------|
| `bootstrap_new_user(p_user_id, p_business_name, p_user_name)` | Creates businesses + profiles |
| `get_business_id()` | STABLE — used in RLS policies. Returns auth.uid()'s business_id |
| `create_sale_transaction(...)` | Atomically inserts sale + sale_items + payments |
| `update_sale(p_sale_id, p_business_id, ...)` | Reverts stock manually, DELETEs items, INSERTs new; calls `reconcile_sales_count` |
| `delete_sale(p_sale_id, p_business_id)` | Deletes sale + reverts stock |
| `get_sale_detail(p_sale_id, p_business_id)` | Full sale with items and payments |
| `reconcile_sales_count(p_business_id)` | Recalculates `sales_count` from sale_items JOIN sales |
| `create_operator(p_business_id, p_name, p_role, p_pin, p_permissions?)` | Returns `{success, operator_id?, error?}` |
| `update_operator(p_operator_id, p_business_id, p_name, p_role, p_permissions)` | Returns `{success, error?}` |
| `verify_operator_pin(p_business_id, p_operator_id, p_pin)` | Returns `{success, profile_id?, name?, role?, permissions?, error?}` |
| `get_operator_stats(p_business_id, p_operator_id, p_date_from?, p_date_to?)` | Sales stats for a sub-operator |
| `get_owner_stats(p_business_id, p_date_from?, p_date_to?)` | Sales stats for owner |
| `swap_default_price_list(p_price_list_id, p_business_id)` | Atomic default swap |
| `update_business_slug(p_slug)` | Validates format + uniqueness; throws in Spanish on failure; GRANT EXECUTE TO authenticated |
| `create_category_guarded(p_operator_id, p_business_id, p_name, p_icon)` | Verifies `stock_write` |
| `create_brand_guarded(p_operator_id, p_business_id, p_name)` | Verifies `stock_write` |
| `get_business_balance(p_business_id, p_from?, p_to?)` | `{income, expenses, profit, margin, by_category, period_from, period_to}` |
| `get_expenses_list(p_business_id, p_from?, p_to?, p_category?, p_limit?, p_offset?)` | `{data: Expense[], total}` |
| `create_expense(p_business_id, p_category, p_amount, p_description, ...)` | `{success, id}` |
| `update_expense(p_business_id, p_expense_id, p_description, p_date, ...)` | Edits non-mercadería expenses; rejects if category = 'mercadería'. Returns `{success, error?}` |
| `delete_expense(p_business_id, p_expense_id)` | `{success}` |
| `create_mercaderia_expense(p_business_id, p_description, p_date?, p_supplier_id?, p_operator_id?, p_notes?, p_items?, p_update_stock?)` | Creates mercadería expense + expense_items + optional stock updates. Returns `{success, id, total}` |
| `update_mercaderia_expense(p_business_id, p_expense_id, p_description, p_date, p_supplier_id?, p_notes?, p_items?)` | Delta-based edit: reverts removed items, applies qty deltas, warns on cost conflicts. Returns `{success, warnings}` |
| `get_stats_kpis(p_business_id, p_from?, p_to?)` | KPIs with `total_units`, `peak_day`, `day_of_week` |
| `get_stats_evolution(p_business_id, p_from?, p_to?)` | Sales evolution with prev_period overlay |
| `get_stats_breakdown(p_business_id, p_from?, p_to?)` | Breakdown by category and brand |
| `get_top_products_detail(p_business_id, p_from?, p_to?, p_limit?, p_offset?)` | `{data: ProductSalesDetail[], total}` |
| `get_sales_by_category_detail(p_business_id, p_from?, p_to?, p_limit?, p_offset?)` | `{data: CategorySalesDetail[], total}` |
| `get_sales_by_payment_detail(p_business_id, p_from?, p_to?)` | `{data: PaymentMethodDetail[]}` |
| `get_sales_by_operator_detail(p_business_id, p_from?, p_to?)` | `{data: OperatorSalesDetail[]}` |
| `bulk_delete_products(p_business_id, p_ids uuid[])` | Bulk delete with business_id guard |
| `bulk_set_product_status(p_business_id, p_ids uuid[], p_status text)` | Bulk activate/discontinue |
| `bulk_update_product_category(p_business_id, p_ids uuid[], p_category_id uuid)` | Bulk category change |
| `bulk_update_product_brand(p_business_id, p_ids uuid[], p_brand_id uuid)` | Bulk brand change |
| `get_catalog_products(p_slug)` | Public catalog products (SECURITY DEFINER, GRANT EXECUTE TO anon) |
| `get_catalog_categories(p_slug)` | Public catalog categories (SECURITY DEFINER, GRANT EXECUTE TO anon) |
| `set_updated_at()` | Trigger function: sets `updated_at = now()` on UPDATE |
| `rls_auto_enable` | Admin utility — enables RLS on all tables automatically |

> **`undo_import` does NOT exist in the live DB.** CONTEXT.md documents it as existing, but it was not created. It is planned for P8b.

> **RPC wrapper pattern:** Stats and expenses RPCs return `{ data: [...] }`. Always extract `.data`:
> ```ts
> const rows = (rpcResult as unknown as { data: RowType[] } | null)?.data ?? []
> ```

---

## 8. Route Map

| route | description | protection |
|-------|-------------|-----------|
| `/login` | Login | public |
| `/register` | Register | public |
| `/auth/callback` | PKCE handler | public |
| `/auth/update-password` | New password form | public (session set by callback) |
| `/catalogo/[slug]` | Public catalog | public (anon, uses RPCs) |
| `/operator-select` | Operator selection | requires Supabase session |
| `/pos` | POS terminal | any active operator |
| `/inventory` | Inventory (read) | `permissions.stock` |
| `/products` | Inventory (write) | `permissions.stock` + `permissions.stock_write` |
| `/price-lists` | Price lists | `permissions.price_lists` |
| `/dashboard` | KPI dashboard | `permissions.stats` |
| `/stats` | Statistics | `permissions.stats` |
| `/stats/top-products` | Top products detail | `permissions.stats` |
| `/stats/breakdown` | Category/brand breakdown | `permissions.stats` |
| `/stats/payment-methods` | Payment methods detail | `permissions.stats` |
| `/stats/operators` | Operator sales detail | `permissions.stats` |
| `/expenses` | Expenses module | `permissions.expenses` |
| `/expenses/providers` | Supplier management | `permissions.expenses` |
| `/profile` | Owner profile | owner only (non-owners get flash → /pos) |
| `/operator/me` | Active operator profile | any operator (owner included) |
| `/settings` | Business settings + operators | `permissions.settings` |

**Flash toast system:** `proxy.ts` sets cookie `flash_toast=no-access` (maxAge 5s, non-httpOnly) on permission redirect. `(app)/layout.tsx` reads it server-side and passes to `FlashToast` component.

---

## 9. Known Pending Issues

### DB Audit — Pending (non-critical for beta)

| ID | Issue | Status |
|----|-------|--------|
| G-3 | `cash_sessions.opened_by` → FK to `profiles` but should FK to `operators`. Deferred until P8a (cash session UI). | ⏳ |
| M-3 | `inventory_movements.created_by` has no active FK and trigger doesn't populate it. Deferred. | ⏳ |

### Dead Code in proxy.ts

The CONTEXT.md mentions a dead `/stock` guard in `proxy.ts`. This does NOT appear in the current `proxy.ts` source — it was already removed or never added. No action needed.

### CONTEXT.md Errors (not yet corrected in that file)

| Area | Documented | Reality |
|------|-----------|---------|
| Project ID | `zrnthycznbrplzpmxmkwk` | `zrnthcznbrplzpmxmkwk` |
| `businesses.accounting_enabled` | Listed as existing | Does not exist in live DB |
| `businesses.settings` keys | Only `primary_color` mentioned | Also supports `currency` and `logo_upload_path` |
| `profiles.onboarding_state` | Not documented | Exists with onboarding wizard state |
| `sales.status` CHECK | `('pending','completed','cancelled')` | `('completed','cancelled','refunded')` — no `pending`, has `refunded` |
| `cash_sessions` columns | Lists `status`, `difference` | Neither exists in live DB; `notes` exists instead |
| `payments.method` CHECK | Lists `credit`, `otro` | Not in live DB — only `cash,card,transfer,mercadopago` |
| `payments.status` CHECK | `('pending','completed','failed')` | `('completed','pending','refunded','cancelled')` — no `failed` |
| `expense_items` table | Not documented | Exists — full line-item system for mercadería |
| `inventory_movements` | No `reason`, `reference_id` | Both exist in live DB |
| `undo_import` RPC | Documented as existing | Does NOT exist in live DB |
| `update_expense` RPC | Not documented | Exists — for editing non-mercadería expenses |
| `create_mercaderia_expense` RPC | Not documented | Exists |
| `update_mercaderia_expense` RPC | Not documented | Exists |
| Permissions count | "9 campos" | 10 fields — `price_override` is the 10th |

### Technical Debt — Pending Post-Beta

| Item | Notes |
|------|-------|
| `InventoryPanel.tsx` (~1291 lines) | Extract 5 embedded sub-components |
| `CartPanel.tsx` (~920 lines) | `EditSalePanel` is embedded — separate it |
| `DashboardView.tsx` in `analytics/` | Move to `dashboard/` |
| `StatsView.tsx` in `analytics/` | Move to `stats/` |
| `ProductsPanel.tsx` (294L) | Probably abandoned — verify and delete |
| `components/sales/` | Empty directory — delete |
| `formatMoney` duplicated | In PaymentModal, ReceiptPreviewModal, ReceiptTemplate — centralize in `lib/utils.ts` |
| `validateImageUrl` duplicated | In NewProductModal + EditProductModal |
| `FieldGroup` duplicated | In both product modals |
| `DateRangeFilter.tsx` | `QUARTER_RANGES` bakes current year at module load time |
| Radix `DialogTitle` warnings | Add `<VisuallyHidden><DialogTitle>` to all modals |
| `useEffect` for sale history in `CartPanel` | Pre-React Query pattern, not migrated |
| `theme.tsx` FOUC | `localStorage` post-hydration causes flash — should use cookie like sidebar |
| `settings/page.tsx` auth | Uses `getUser()` + try/catch instead of `requireAuthenticatedBusinessId` |
| `operator-select/page.tsx` | `role` typed as manual literal union instead of `Exclude<UserRole, 'owner'>` |
| `!` assertions in env vars | In `client.ts` and `server.ts` |
| `CartItem` in `lib/types/index.ts` | Client-only type mixed with server types |
| `categories.public_read_categories` policy | Allows anon SELECT — fine for catalog but broad |

---

## 10. Critical Rules (Quick Reference)

1. `src/proxy.ts` is the middleware — **NEVER** create or use `middleware.ts`.
2. `business_id` always from `profiles.business_id` — never inferred from other data.
3. Server Components always `.eq('business_id', businessId)` in addition to RLS.
4. SQL with bcrypt: `set search_path = public, extensions` and call `extensions.crypt()` / `extensions.gen_salt()`.
5. `create_operator` / `update_operator` return JSON — check `data.success`, not just `error`.
6. Sub-operators in `operators` table. Owner **only** in `profiles`. Owner **NEVER** in `operators`.
7. `operator_session` cookie: httpOnly, sameSite: lax, secure in production.
8. Owner identified in proxy by `operator?.role === 'owner'` or absent cookie — never DB lookup.
9. `OWNER_PERMISSIONS` from `lib/operator.ts` — imported everywhere, never duplicated.
10. `UserRole = 'owner' | 'manager' | 'cashier' | 'custom'` — from `lib/types/index.ts`, re-exported by `lib/operator.ts`.
11. Price calculation via `calculateProductPrice` in `lib/price-lists.ts` — never inline.
12. `normalizePayment`, `PAYMENT_LABELS`, `PAYMENT_COLORS` from `lib/payments.ts` — never duplicated.
13. `createClient()` always inside `useMemo(() => createClient(), [])` in Client Components.
14. Independent queries in Server Components: always `Promise.all`.
15. RPCs returning `{data: [...]}`: always extract `.data`, never iterate the wrapper.
16. New permission field: update `lib/operator.ts`, `sidebar.tsx`, `api/operator/switch/route.ts`, `NewOperatorModal.tsx` — same commit.
17. Filter chips: `pill-tabs` / `pill-tab` / `pill-tab-active` everywhere (exception: POS ProductPanel).
18. Sidebar collapsed: from cookie `pos-sidebar-collapsed` in Server Component — no post-hydration `useEffect`.
19. Prefer `requireAuthenticatedBusinessId(supabase)` in page components.
20. `/api/operator/logout`: only deletes cookies — **NEVER** restores owner session.
21. Post-operator-switch navigation: **ALWAYS** `window.location.href`, **NEVER** `router.push + router.refresh`.
22. `businesses.settings` JSONB: always spread-merge — never replace the whole object.
23. Product image storage path: `{businessId}/{uuid}.{ext}` — `businessId` is first segment, not `product.id`.
24. PKCE recovery: `redirectTo` must be `/auth/callback?type=recovery`, not `/auth/update-password`.
25. Components reading `localStorage` for UI: use the `mounted` pattern to prevent hydration mismatch.
26. Slug validation: `BUSINESS_SLUG_REGEX = /^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/` client-side before calling RPC.
27. No `backdrop-filter`, `backdrop-blur`, or glass effects.
28. No `<form>` HTML — use `onClick`/`onChange` handlers.
29. Public catalog: **NEVER** direct queries to `products`/`categories` from anon client — use `get_catalog_products`/`get_catalog_categories` RPCs.
30. `mercadería` expenses: use `create_mercaderia_expense` / `update_mercaderia_expense` RPCs — not `create_expense` / `update_expense`.
