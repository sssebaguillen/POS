# Pulsar POS — Claude Code Reference

> **Source of truth for all AI sessions.** When this file and the code conflict, trust the code and update this file.
> Last verified against live Supabase: 2026-05-16.

**Companion docs (read on demand):**
- [`docs/db.md`](docs/db.md) — full DB schema, RPC signatures, RLS rules, migration naming.
- [`docs/conventions.md`](docs/conventions.md) — UI patterns (pill tabs vs chips), design system, permissions model, route map, payment methods, flash toast system, skills.
- [`docs/todo/backlog.md`](docs/todo/backlog.md) — P7h/P8/P9/P10 status, known bugs, CONTEXT.md errors, post-beta tech debt.

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
| Supabase project ID | `zrnthcznbrplzpmxmkwk` (sa-east-1) |
| Supabase plan | FREE — do not suggest paid-plan features (e.g. Leaked Password Protection) |

### Commands

| | |
|--|--|
| `npm run dev` | Start dev server (Next + webpack) |
| `npm run build` | Production build |
| `npm run start` | Run production build |
| `npm run lint` | ESLint |

No `typecheck` script — `tsc --noEmit` runs implicitly during `next build`.

---

## 2. Architecture Rules

### Middleware / Routing

- **ALWAYS use `src/proxy.ts`, NEVER `middleware.ts`.** Next.js 16+ resolves `src/proxy.ts` as the middleware entry point in this project. The file exports `proxy(request: NextRequest)` and `config.matcher`.
- CSP headers are set in `proxy.ts`. Static security headers (`X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`) are set via `next.config.ts`.
- `backdrop-blur-sm` is the standard for modal overlays — applied via `ui/dialog.tsx` and matched in any bespoke modal. Do **not** use blur/glass effects elsewhere (cards, panels, sidebars, page backgrounds).

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
- `verify_operator_pin` (SECURITY DEFINER): **authenticated-only** (anon revocado — el único llamador es el switch route con la sesión del dueño), con guard `assert_tenant(p_business_id)` y **lockout**: 5 PIN fallidos → bloqueo 15 min vía `operators.failed_pin_attempts` + `pin_locked_until` (se resetea al acertar). Devuelve `{success:false, locked:true, error}` al bloquear; el route surface ese `error`. No quitar el lockout ni re-otorgar anon. Mig. `20260529_05`.
- Active session stored in cookie `operator_session` (httpOnly, sameSite: lax, secure in prod): `{ profile_id, name, role, permissions }`. See `docs/conventions.md` for the full permission shape.
- **`operator_session` está firmada con HMAC-SHA256** (formato `base64url(json).base64url(sig)`, Web Crypto, secreto `OPERATOR_SESSION_SECRET`). La firma la genera `signOperatorSession` en `/api/operator/switch`; `getActiveOperator` (async) la verifica y **rechaza cookies sin firma o manipuladas** (→ `/operator-select`). Razón: los operadores montan sobre la sesión Supabase del dueño, así que la cookie es lo único que limita su rol/permisos; sin firma un sub-operador la editaba a `role:'owner'` (escalada de privilegios). **Nunca** volver a confiar en `operator_session` sin verificar la firma, ni serializarla con `JSON.stringify` plano. `OPERATOR_SESSION_SECRET` es obligatoria en todos los entornos (sin ella `getActiveOperator` lanza y nadie puede operar).
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
Applied in: `sidebar.tsx`, `theme.tsx` (ThemeToggle), `CatalogThemeProvider.tsx`.

### POS — Sale Flow

- Sales created atomically via `create_sale_transaction` RPC.
- Trigger `update_stock_on_sale` decrements stock automatically on `sale_items` insert.
- Cart store (`lib/store/cart.store.ts`) holds base price; `calculateProductPrice` applied at render and checkout.
- **Price override per line:** `priceIsManual` in Zustand excludes item from price-list recalculation. `unit_price_override` + `override_reason` persisted in `sale_items`.

### Price Calculation

`calculateProductPrice` in `lib/price-lists.ts` is the **only** source of truth for prices on the client. Its SQL mirror is `compute_effective_price(...)` in Postgres, used by the catalog RPCs (`get_catalog_products`, `get_catalog_product_with_variants`). **Both implement the same rule** — change them together.

Resolution order (variant-aware):
1. `variantPrice > 0` → `variantPrice` (precio explícito de variante manda; la lista NO lo modifica)
2. `cost > 0` → `cost × (product_override ?? brand_override ?? list.multiplier)`
3. `cost = 0` → use `price` directly
4. Both 0 → return 0

For variants: pass the variant's own `cost` and `price`; the override lookup uses the **parent's** `product_id` and `brand_id` (no per-variant overrides today). The `variantPrice` parameter is what makes paridad POS↔catálogo cumplir — sin él, las listas de precios romperían variantes con precio manual.

When `unit_price_override` exists in a sale item, it takes precedence over everything.

### Price Lists — Manual Price Conflict

- `isPriceEdited = true` whenever the user edits price in the product form, even without an active price list.
- When creating/editing a price list that affects products with manual prices: show amber alert with affected list + two options: overwrite with list margin, or create `price_list_overrides` to preserve manual prices.

### Promociones (Promos y Ofertas)

Plan y semántica completa: [`docs/todo/promotions.md`](docs/todo/promotions.md). Implementado 2026-06-10 (F1–F5).

- **Pipeline de precedencia:** precio efectivo (base/variante o lista+redondeo, SIN cambios) → promo unitaria (`percent`/`offer_price`) → promo de cantidad (2x1/3x2/2da al X%, modelo N/K/P) → override manual gana todo (`priceIsManual` excluye listas Y promos) → descuento de carrito.
- **Resolución:** una línea matchea UNA promo (sin stacking): más específica gana (producto > categoría > marca); a igual especificidad, la más reciente. UI avisa solapamientos al crear (ámbar, no bloquea).
- **Espejo SQL↔TS (extiende la regla 11):** `find_applicable_promotion` / `apply_unit_promo` / `compute_quantity_promo_discount` (SQL) ↔ `src/lib/promotions.ts` (TS). Cambiarlos juntos.
- **Tracking informativo, líneas NETAS:** promo unitaria baja `unit_price` (total = qty×unit); promo de cantidad deja el unitario y descuenta a nivel línea (total = qty×unit − promo_discount). `sale_items.promotion_id`/`promo_discount` y sus pares en `catalog_order_items` son informativos — `sales.discount` sigue siendo SOLO el descuento de carrito. Invariantes R1/R12 en `docs/tests/06-reconciliacion.sql`.
- **Catálogo:** la promo se aplica **server-side** (`get_catalog_products`, `get_catalog_product_with_variants`, `create_catalog_order`) — el precio mostrado es promesa, el checkout re-precia con la misma promo. La conversión a venta arrastra `promotion_id`/`promo_discount`. `show_in_catalog` solo controla la sección Ofertas destacada; el precio aplica siempre (paridad POS↔catálogo).
- **Ciclo de vida:** promo usada en ventas se ARCHIVA (`archive_promotion`), nunca se borra. CRUD vía `create/update/archive_promotion` (guard `inventory_write` + audit `entity_type='promotion'`). `daily_snapshots.promo_discounts_total`/`promo_sales_count` alimentan a P12.

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

### Audit Log (P7h)

- `audit_log` table records every business mutation. Inventory mutations (create/update/delete product, category, brand, bulk product ops) and sale mutations (create/update/delete) all go through SECURITY DEFINER RPCs that call `log_audit_event(...)`. Phase 2 (shipped 2026-05-16) extended this to expenses, suppliers, price lists, settings, operators.
- **`operator_id` is NULL when the owner performed the action.** Owners are not in the `operators` table — never look them up. The read RPC `get_audit_log` LEFT JOINs operators and projects `actor_name = COALESCE(o.name, 'Dueño')`; the UI mirrors this with sentinel UUID `'00000000-0000-0000-0000-000000000000'` for the "Owner only" filter (maps to `operator_id IS NULL` in the RPC).
- All audit-logged RPCs accept `p_operator_id uuid` (nullable). Server-side callers pass `getActorOperatorId(operator)` from `lib/operator.ts` (returns `null` for owner, `profile_id` otherwise).
- Audit retention is indefinite. **Do not** add cleanup jobs or TTL.

See `docs/todo/backlog.md` for Fase 2 RPC signature changes and remaining Fase 3 scope.

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
│   ├── operator.ts                       # UserRole, Permissions (8 capabilities, 4 areas), OWNER_PERMISSIONS,
│   │                                     # getActiveOperator, getActorOperatorId, parsePermissions/normalizePermissions (bi-shape, mirror of SQL normalize_permissions)
│   ├── payments.ts                       # normalizePayment, PAYMENT_LABELS, PAYMENT_COLORS, PAYMENT_OPTIONS
│   ├── price-lists.ts                    # calculateProductPrice — sole price calculation source
│   ├── promotions.ts                     # Espejo TS de promos: findApplicablePromo, applyUnitPromo, computeQuantityDiscount, resolvePromoLine, promoBadgeLabel
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
│   ├── (standalone)/                     # Route group WITHOUT the heavy (app) layout — inherits only root layout (html/body/theme)
│   │   └── operator-select/page.tsx      # edge — operator selection with PIN. ⚠️ SÍ renderiza AppShell/Sidebar (y por ende FeedbackButton) aunque está en (standalone), FUERA del ToastProvider de (app)/layout → hooks de contexto consumidos por el Sidebar deben degradar (no lanzar) si no hay provider
│   ├── (app)/
│   │   ├── layout.tsx                    # Reads collapsed cookie → AppShell, theme, QueryProvider, ToastProvider, FlashToast
│   │   ├── settings/page.tsx             # ⚠️ uses getUser() + try/catch instead of requireAuthenticatedBusinessId
│   │   ├── inventory/page.tsx
│   │   ├── products/page.tsx
│   │   ├── price-lists/page.tsx
│   │   ├── promotions/page.tsx           # Promos y ofertas — gate inventory_read; CRUD vía RPCs guardadas
│   │   ├── dashboard/page.tsx            # edge — denormalizes operator_name + product names for SalesHistoryTable
│   │   ├── expenses/page.tsx             # Expenses + /expenses/providers sub-route
│   │   ├── stats/page.tsx                # edge
│   │   ├── stats/top-products/page.tsx
│   │   ├── stats/breakdown/page.tsx
│   │   ├── stats/payment-methods/page.tsx
│   │   ├── stats/operators/page.tsx
│   │   ├── stats/trends/page.tsx           # edge — period comparison via get_period_comparison RPC
│   │   ├── stats/heatmap/page.tsx          # edge — sales heatmap by weekday/hour (business-local tz)
│   │   ├── stats/report/page.tsx           # edge — printable PDF report by date range; gates `reports` perm
│   │   ├── stats/inventory-health/page.tsx  # edge — Salud de inventario: 2 lentes (Stock inmovilizado / Sobrestock); gates `reports`; Promise.all([get_dead_stock, get_overstock]) sin filtro (tope 500), filtra/pagina en memoria
│   │   ├── profile/page.tsx              # Owner only
│   │   ├── operator/me/page.tsx          # Active operator personal profile
│   │   ├── activity/page.tsx             # edge — audit log with chip+DateRangeFilter+operator filters; defense-in-depth `reports` perm check
│   │   ├── orders/page.tsx               # Pedidos Online — list of catalog orders
│   │   ├── customers/page.tsx            # Customers list
│   │   ├── cash-sessions/page.tsx        # Cash sessions history + active session
│   │   └── pos/page.tsx                  # edge
│   ├── api/catalog/
│   │   └── orders/route.ts               # POST: anon catalog checkout → create_catalog_order; per-IP rate limit
│   ├── api/operator/
│   │   ├── switch/route.ts               # Writes operator_session + op_perms (8 permissions)
│   │   └── logout/route.ts               # Only deletes cookies — NEVER restores owner session
│   └── catalogo/
│       ├── layout.tsx                    # CatalogThemeProvider wrapper
│       ├── error.tsx                     # Error temporal amigable (es) con Reintentar — cubre los throw de RPC de las 3 páginas
│       ├── not-found.tsx                 # Slug/producto inexistente → "Este catálogo no existe"
│       └── [slug]/
│           ├── page.tsx
│           ├── loading.tsx               # Skeleton espejo de ProductGrid (mismos breakpoints) — cubre también detalle y promotions
│           ├── promotions/page.tsx       # Página pública de ofertas del negocio
│           └── [productId]/page.tsx      # Detalle de producto — envuelto en CatalogShell (navbar + carrito + footer)
└── components/
    ├── shared/
    │   ├── AppShell.tsx                  # Layout shell with SidebarContext
    │   ├── ToastProvider.tsx             # Global toast (context + único <Toast>). useToast() lee del context; no-op fuera del provider. Montado en (app)/layout
    │   ├── FlashToast.tsx                # Lee cookie flash_toast y dispara el toast global vía useToast (no renderiza)
    │   ├── PageHeader.tsx                # breadcrumbs?: { label: string; href: string }[]
    │   ├── DateRangeFilter.tsx           # today/week/month/quarter/year/custom
    │   ├── ExportCSVButton.tsx
    │   ├── KPICard.tsx
    │   ├── ConfirmModal.tsx
    │   ├── Toast.tsx                     # Visual del toast (renderizado centralmente por ToastProvider); variant warning usa token --warning
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
    ├── activity/
    │   ├── ActivityView.tsx              # Entity dropdown + DateRangeFilter + operator dropdown; useTransition for optimistic filter state
    │   ├── ActivityDetail.tsx            # Per-action human-readable detail panel (SaleDiff, ProductDiff, BulkProduct*, CategoryDiff, BrandDiff)
    │   └── types.ts                      # ActivityEntityFilter, ActivityFilterOperator, ActivityLogRow, ActivityActionTone
    ├── dashboard/
    │   ├── DashboardView.tsx             # Exports RecentActivityRow (id, action, entity_type, entity_label, actor_name, created_at, old_data, new_data)
    │   ├── SalesHistoryTable.tsx         # 100% in-memory filter — data denormalized from page.tsx
    │   ├── BalanceWidget.tsx
    │   └── RecentActivityWidget.tsx      # Last 5 audit_log entries; "Ver detalle →" to /activity; shows sale total when entity_label is null
    ├── stats/
    │   ├── TopProductsDetailView.tsx
    │   ├── BreakdownDetailView.tsx
    │   ├── PaymentMethodDetailView.tsx
    │   ├── OperatorSalesDetailView.tsx
    │   ├── TrendsDetailView.tsx           # P11.2 — daily trends + period-over-period comparison
    │   ├── SalesHeatmap.tsx                # P11.3 — reusable 7×24 grid component (compact prop for /stats widget)
    │   ├── SalesHeatmapView.tsx            # P11.3 — /stats/heatmap detail view
    │   ├── ReportView.tsx                   # P11.3 — /stats/report printable PDF doc (window.print + @media print); reuses stats RPCs, no new migration
    │   ├── InventoryHealthView.tsx          # Salud de inventario: shell + pill-tabs de lente (Stock inmovilizado / Sobrestock, usePillIndicator), swap in-memory instantáneo; URL sync ?lens= con history.replaceState
    │   ├── DeadStockLens.tsx                 # Lente recencia: listado (never_sold + dead 90d), chips Todos/Sin movimiento/Nunca vendido, KPIs (capital inmovilizado), tabla read-only; filtro+paginación in-memory; export CSV
    │   └── OverstockLens.tsx                 # Lente cobertura: productos que rotan con 6+ meses de stock; KPI "capital comprado de más" (excedente, no stock entero), columnas velocidad/meses de stock/excedente; in-memory; export CSV
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
    ├── promotions/
    │   ├── PromotionsView.tsx            # Chips de estado + tabla + pausar/reanudar/archivar
    │   ├── PromotionModal.tsx            # New/Edit compartido: 4 tipos en lenguaje natural (mapea a N/K/P), preview, aviso de solapamiento
    │   └── types.ts                      # getPromotionStatus, describePromotion, coveredProductIds
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
    ├── orders/
    │   ├── OrdersView.tsx                 # List + chip status filters; polls every 10s
    │   ├── OrderDetailPanel.tsx           # Right-side drawer with state machine actions
    │   ├── StatusBadge.tsx
    │   ├── UnreadBadge.tsx                # exports useUnreadOrdersCount hook
    │   ├── NewOrderNotifier.tsx           # Mounted in (app)/layout.tsx; sound+toast on /pos, /dashboard
    │   └── types.ts
    ├── settings/
    │   ├── SettingsForm.tsx              # Slug input with puls.ar/{slug} preview + client-side validation
    │   ├── OperatorList.tsx
    │   ├── NewOperatorModal.tsx          # 8 permission toggles (4 areas, via operatorPermissions.tsx)
    │   ├── EditOperatorModal.tsx
    │   └── types.ts
    ├── profile/
    │   └── ProfileView.tsx
    ├── operator-profile/
    │   └── OperatorProfileView.tsx       # Operator personal profile (/operator/me)
    └── catalog/
        ├── CatalogShell.tsx              # Shell de las 3 páginas públicas: ES el contenedor de scroll (h-screen overflow-y-auto — el body global tiene overflow:hidden), contexto de carrito, navbar sticky, footer, cart sheet global (bottom mobile / right desktop) y barra inferior mobile "Ver pedido". Carrito hidratado de localStorage con mounted pattern; en la main revalida contra products frescos, en detalle/promos usa getStoredCartItemsUnvalidated
        ├── CatalogNavbar.tsx             # Sticky: logo+nombre | search (centro) | nav Inicio/Ofertas (solo md+) | theme toggle + carrito con badge. En mobile la nav vive en un hamburger que abre sidebar izquierdo (Sheet side=left) y el search baja a fila propia
        ├── CatalogSearch.tsx             # Typeahead del navbar: dropdown anclado al input (imagen, nombre, categoría · marca, variantes, precio con promo) que navega al detalle — NO filtra la grilla. En la main usa products/categories del server; en detalle/promos los trae lazy (RPCs anon) al primer tipeo
        ├── CatalogFooter.tsx             # Datos del negocio + nav Inicio/Ofertas + link WhatsApp
        ├── CatalogView.tsx               # Hero de ofertas + fila única (chips de categoría scrolleables + sort dropdown + "Más filtros") + línea de feedback solo con filtros activos (conteo + chips removibles); todo el filtrado/orden vive acá. Drawer "Más filtros" reducido a marca/variantes/precio. El carrito vive SOLO en el sheet global del shell (sin columna sticky propia)
        ├── ProductGrid.tsx               # Solo grilla + empty states (sin toolbar ni vista lista — eliminada 2026-06-11)
        ├── ProductCard.tsx               # Quick-selector de variantes en hover (prefetch lazy cacheado en mouseenter)
        ├── VariantQuickSelector.tsx
        ├── ProductDetailView.tsx         # Detalle con selección de variantes; agrega al carrito vía contexto del shell
        ├── OffersCarousel.tsx            # Hero de ofertas destacadas (promos con show_in_catalog)
        ├── PromotionsView.tsx            # Vista de /catalogo/[slug]/promotions
        ├── CartPanel.tsx                 # Checkout anónimo; prop `embedded` para el sheet mobile; tras enviar muestra link wa.me explícito (popup blockers matan window.open post-await). El pedido queda registrado en /orders al submit — WhatsApp es coordinación opcional, no el canal de entrega
        ├── CatalogThemeProvider.tsx
        ├── mapProducts.ts
        └── types.ts
```

**Edge Runtime** (`export const runtime = 'edge'`): `/pos`, `/dashboard`, `/stats`, `/stats/trends`, `/stats/heatmap`, `/stats/report`, `/stats/inventory-health`, `/operator-select`, `/activity`

Full route map with permission gates: `docs/conventions.md`.

---

## 4. Critical Rules (Quick Reference)

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
11. Price calculation via `calculateProductPrice` in `lib/price-lists.ts` (client) o `compute_effective_price(...)` (Postgres) — never inline. Mantener ambas implementaciones en sync. **Para variantes, `variant.price > 0` siempre gana sobre la lista de precios** (precio explícito de variante manda); pasar el precio de la variante como último parámetro a la función.
12. `normalizePayment`, `PAYMENT_LABELS`, `PAYMENT_COLORS` from `lib/payments.ts` — never duplicated.
13. `createClient()` always inside `useMemo(() => createClient(), [])` in Client Components.
14. Independent queries in Server Components: always `Promise.all`.
15. RPCs returning `{data: [...]}`: always extract `.data`, never iterate the wrapper.
16. **Permisos de operario: modelo de 8 capacidades en 4 áreas** (Mostrador: `pos_pricing`, `online_orders` · Inventario: `inventory_read`, `inventory_write` · Reportes: `reports`, `expenses` · Administración: `settings`, `manage_operators`). El normalizador canónico es `normalize_permissions(jsonb)` en Postgres ↔ `normalizePermissions()`/`parsePermissions()` en `lib/operator.ts` (**bi-shape**: aceptan el shape viejo de 11 flags y el nuevo; mantener ambas implementaciones en sync — regla 11). **Las guardas `SECURITY DEFINER` leen el permiso vía `normalize_permissions(permissions)->>'<key>'`** (no por columna directa) — al sumar/renombrar una capacidad, actualizar el helper SQL **y** el TS, o las guardas fallan abierto en silencio. Lugares a tocar para una capacidad nueva: `lib/operator.ts` (interface + defaults + `OPERATOR_MANAGEMENT_PERMISSION_KEYS` + `PERMISSION_LABELS`), `normalize_permissions` (SQL) + su espejo TS, las guardas que la consuman, `proxy.ts`, `sidebar.tsx`, `api/operator/switch/route.ts`, `components/settings/operatorPermissions.tsx` (presets + áreas + `applyPermissionToggle`), y el default de columna + role-defaults de `create_operator`/`update_operator`. Historia y plan: `docs/todo/permisos-operario-redesign.md`.
17. Filter pattern split: **pill tabs** (with `usePillIndicator`) only for `DateRangeFilter` and section/view navigation; **chips** (flat `pill-tab` buttons, active class `bg-primary/10 text-primary border border-primary/20`) for all data filters. Reference: `SalesHistoryTable.tsx`. Exception: POS `ProductPanel` keeps its own style. Details in `docs/conventions.md`.
18. Sidebar collapsed: from cookie `pos-sidebar-collapsed` in Server Component — no post-hydration `useEffect`.
19. Prefer `requireAuthenticatedBusinessId(supabase)` in page components.
20. `/api/operator/logout`: only deletes cookies — **NEVER** restores owner session.
21. Post-operator-switch navigation: **ALWAYS** `window.location.href`, **NEVER** `router.push + router.refresh`.
22. `businesses.settings` JSONB: always spread-merge — never replace the whole object.
23. Product image storage path: `{businessId}/{uuid}.{ext}` — `businessId` is first segment, not `product.id`.
24. PKCE recovery: `redirectTo` must be `/auth/callback?type=recovery`, not `/auth/update-password`.
25. Components reading `localStorage` for UI: use the `mounted` pattern to prevent hydration mismatch.
26. Slug validation: `BUSINESS_SLUG_REGEX = /^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/` client-side before calling RPC.
27. `backdrop-blur-sm` is reserved for modal overlays — applied centrally via `ui/dialog.tsx` and matched on bespoke modals (e.g. `ReceiptPreviewModal`, `ExpenseAttachmentModal`). Never use blur/glass on cards, panels, sidebars, or page-level backgrounds.
28. `<form>` is fine for login/PIN/settings/multi-field input flows where Enter-to-submit and password-manager integration are useful. Always call `e.preventDefault()` in `onSubmit` to avoid page reload. For one-off button actions (modals with a single action, etc.) prefer plain `onClick`.
29. Public catalog: **NEVER** direct queries to `products`/`categories` from anon client — use `get_catalog_products`/`get_catalog_categories` RPCs.
30. `mercadería` expenses: use `create_mercaderia_expense` / `update_mercaderia_expense` RPCs — not `create_expense` / `update_expense`.
31. **Audit log: `operator_id = NULL` means owner ("Dueño") everywhere** — in `audit_log` rows, in `get_audit_log` filtering (sentinel UUID `'00000000-0000-0000-0000-000000000000'` maps to `IS NULL`), and in the UI ("Dueño" label). Never insert a synthetic owner row in `operators`.
32. Inventory mutations: use the RPCs (`create_product`, `update_product`, `delete_product`, `create_category_guarded`, `update_category`, `delete_category`, `create_brand_guarded`, `delete_brand`, `bulk_*`) — they verify `stock_write` and log to `audit_log`. Do **not** call `supabase.from('products' | 'categories' | 'brands').insert/update/delete` directly. (One known exception pending: `ImportProductsModal.handleCreate` — see `docs/todo/backlog.md`.)
33. **Pedidos Online (`/orders`)**: anon catalog checkouts POST through `/api/catalog/orders` (Node runtime, per-IP rate limit, IP forwarded to RPC for forensics) → `create_catalog_order` RPC re-precia items server-side. Status flow lives in `update_catalog_order_status`; **sale conversion (and stock decrement) happens only on the `completado` transition** — it reuses `create_sale_transaction` with the **payment method the operator selects at completion** (`cash/card/transfer/mercadopago`, passed as `p_payment_method`; `credit` excluido — el pedido online es anónimo). El método `'other'` NO existe en `payments_method_check`; no usarlo. La venta convertida se marca `sales.source = 'catalog'` (default `'pos'`) para distinguir POS vs pedido online. La transición a `completado` toma `SELECT … FOR UPDATE` sobre el pedido (evita doble conversión por doble-click/concurrencia). Permission key reused: `sales`. Audit `entity_type = 'catalog_order'`. UI: `/orders` page + `<NewOrderNotifier />` mounted in `(app)/layout.tsx` (sound+toast on `/pos` and `/dashboard`). Sidebar unread badge via `get_catalog_orders_unread_count` polled every 10s.
34. **Tenant guard + grants en RPC `SECURITY DEFINER` (regla de seguridad multi-tenant).** Como DEFINER saltea RLS, toda RPC nueva que reciba `p_business_id` o mute datos de negocio DEBE: **(a)** verificar la pertenencia del llamador como **primera sentencia** — `assert_tenant(p_business_id)` (lanza `'Contexto de negocio invalido'`), o el patrón equivalente `IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND business_id = p_business_id) THEN ... unauthorized`. **Nunca** confiar en que el dato pertenezca al `p_business_id` recibido (eso se satisface pasando un par ajeno válido). **(b)** En la misma migración, `REVOKE EXECUTE ... FROM PUBLIC, anon` y `GRANT EXECUTE ... TO authenticated` (Supabase otorga EXECUTE a PUBLIC por defecto → revocar solo `anon` no alcanza). Catálogo público anon: única excepción autorizada, por slug, re-preciando server-side (reglas 29/33). Helpers internos / cron (`log_audit_event`, `upsert_daily_snapshot`, `refresh_all_daily_snapshots`): revocar anon **y** authenticated; el cron corre como `service_role`. Antecedente y pruebas: `docs/tests/08-auditoria-seguridad.md` + migraciones `20260529_01..04`.
35. **Storage RLS scopeada por carpeta de negocio.** El path de todo objeto es `{businessId}/...` (regla 23). Toda policy de **escritura** (`insert`/`update`/`delete`) sobre `storage.objects` DEBE exigir `(storage.foldername(name))[1] = (get_business_id())::text` — nunca solo `bucket_id = '...'` (eso permite escribir/borrar objetos de otro negocio). Buckets **públicos** (`product-images`, `business-logos`): el render va por CDN (`getPublicUrl` → `/object/public/...`, no consulta RLS), así que el SELECT también se scopea a `authenticated` + carpeta propia (no anon) sin romper el catálogo; `.list()` no se usa. Buckets **privados** (`expense-receipts`, `feedback-attachments`): read/write/delete scopeados por carpeta; acceso vía `createSignedUrl` con la sesión del dueño. El `DELETE` directo por SQL sobre `storage.objects` está bloqueado (trigger `storage.protect_delete`) → usar la Storage API con `service_role`. Antecedente: `docs/tests/08-auditoria-seguridad.md` §6 + migraciones `20260529_10..11`.
36. **Promos: resolución y cálculo SOLO vía los espejos** `find_applicable_promotion`/`apply_unit_promo`/`compute_quantity_promo_discount` (SQL) ↔ `src/lib/promotions.ts` (TS) — nunca inline; mantener en sync (extiende la regla 11). Una línea matchea UNA promo (producto > categoría > marca; a igual especificidad, la más reciente). Líneas NETAS: `promotion_id`/`promo_discount` en `sale_items`/`catalog_order_items` son informativos; `sales.discount` sigue siendo solo el descuento de carrito. El catálogo aplica la promo **server-side** (RPCs de catálogo + `create_catalog_order` — nunca solo en UI: el precio mostrado es promesa y el checkout re-precia). El override manual (`priceIsManual`) excluye la línea de listas Y promos. Promos usadas en ventas se ARCHIVAN (`archive_promotion`), nunca se borran. Detalle: sección "Promociones" arriba + `docs/todo/promotions.md`.
37. **Copy de UI en español latino neutro — NUNCA voseo.** Toda cadena de texto visible (incluido el catálogo público `/catalogo/[slug]`) usa la forma **tú**, no **vos/vos-argentino**. Imperativos: `Agrega`/`Prueba`/`Carga`/`Elige`/`Selecciona`/`Crea`/`Configura`/`Guarda` — **nunca** `Agregá`/`Probá`/`Cargá`/`Elegí`/`Seleccioná`/`Creá`. Presente: `Compras`/`Vendes`/`Tienes`/`Puedes`/`Quieres` — **nunca** `Comprás`/`Vendés`/`Tenés`/`Podés`/`Querés`. El target es LATAM amplio, no solo Argentina. Aplica al escribir copy nuevo **y** al editar copy existente (no "argentinizar" textos neutros). Antes de cerrar un cambio que toque copy, barrer los diffs por imperativos terminados en `-á/-í/-é` y conjugaciones `-ás/-és`. (`acá`/`allá` son regionalismos tolerados y NO son voseo — no es necesario cambiarlos.)
