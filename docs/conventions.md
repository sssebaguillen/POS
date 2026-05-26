# Pulsar POS — Conventions

> UI patterns, design system, permissions model, route map, naming rules, payment methods, and the flash toast system. Read this before adding a new screen, filter, role, or settings field.

---

## Naming and Language

- **Codebase language:** English — all files, variables, functions, types, comments, DB columns.
- **UI language:** Spanish only — all labels, button text, error messages, placeholders visible to users.
- DB values that appear in the UI (e.g. category names, expense categories) are stored in English/neutral form and translated in the frontend.
- No emojis in code. No hardcoded values. No `any` types.
- Named interfaces for all props.
- File and directory naming: kebab-case for files, PascalCase for React components.

### Routes

All routes are in English: `/stats/payment-methods`, `/stats/operators`, `/stats/breakdown`, `/stats/top-products`.

---

## Design System

- **Background:** CSS var `--background` | **Surface:** `--surface` | **Primary:** `#7a3e10` (warm brown, overridable via `businesses.settings.primary_color`)
- **Typography:** DM Sans — 7 semantic classes in `globals.css`: `.text-display`, `.text-heading`, `.text-subheading`, `.text-body`, `.text-caption`, `.text-label`, `.text-metric`
- Custom properties: `--body-secondary`, `--support`
- Cards: `rounded-xl` / `rounded-2xl`, subtle border, class `surface-card`
- Dropdowns/popovers: class `surface-elevated`
- Sidebar: class `surface-sidebar`
- Filter chips: `pill-tabs` (container) / `pill-tab` (inactive) / `pill-tab-active` (active) — use everywhere **except** POS ProductPanel (intentional own style with `rounded-full`, `bg-primary` active)
- Icons: lucide-react | Charts: recharts
- `backdrop-blur-sm` reserved for modal overlays (applied via `ui/dialog.tsx`, matched on bespoke modals). Never on cards/panels/sidebars/page backgrounds.
- `<form>` is fine for login/PIN/settings/multi-field input flows where Enter-to-submit and password-manager integration are useful — always call `e.preventDefault()` in `onSubmit`. For single-action modals prefer plain `onClick`.

### Pill Tabs vs Chips

Two distinct filter patterns — never mix:

- **Pill tabs** (`pill-tabs` / `pill-tab` / `pill-tab-active`, with the `usePillIndicator` sliding indicator): reserved for `DateRangeFilter` and section/view navigation (Settings tabs, Dashboard tabs, /expenses/providers tab switch). Imply a single selection from a small ordered set.
- **Chips** (flat `pill-tab` buttons with the active class `bg-primary/10 text-primary border border-primary/20 dark:bg-primary/15 dark:border-primary/30`): used for data filters (entity type in `/activity`, category in `/expenses`, status filters in `SalesHistoryTable`). No sliding indicator. Imply data-shape filtering, often with a "Limpiar" button when a non-default value is selected.

The reference implementation for the chip pattern is `SalesHistoryTable.tsx`.

### Loading Button Text

Canonical Spanish verbs for in-flight async buttons. Pick the one that matches the action — don't use "Procesando..." as a catch-all.

| Action | Loading label |
|--------|---------------|
| Create a new entity | `Creando...` |
| Save edits to an existing entity | `Guardando...` |
| Delete an entity | `Eliminando...` |
| Upload a file | `Subiendo...` |
| Download / export to CSV | `Exportando...` |
| Import from CSV | `Importando...` |
| Register a sale | `Registrando...` |
| Validate (server-side check before commit) | `Validando...` |
| Send email / message | `Enviando...` |
| Confirm a payment / action | `Confirmando...` |
| Print directly via ESC/POS | `Imprimiendo directo...` |
| Open browser print dialog | `Abriendo impresión...` |
| Open native share sheet | `Abriendo compartir...` |
| Close a cash session | `Cerrando sesión...` |
| Generic catch-all (avoid unless nothing else fits) | `Procesando...` |

`Actualizando...` is also valid in two narrower cases: (1) background React Query refetch indicators (small text label, not a button), (2) buttons whose idle label is "Actualizar X" — verb match wins (e.g. "Actualizar contraseña" → "Actualizando...").

### Breadcrumbs

`PageHeader` accepts `breadcrumbs?: { label: string; href: string }[]`. Required on sub-routes, not on top-level routes.

| Route | breadcrumbs |
|-------|------------|
| `/stats/top-products` | `[{ label: 'Estadísticas', href: '/stats' }]` |
| `/stats/breakdown` | `[{ label: 'Estadísticas', href: '/stats' }]` |
| `/stats/payment-methods` | `[{ label: 'Estadísticas', href: '/stats' }]` |
| `/stats/operators` | `[{ label: 'Estadísticas', href: '/stats' }]` |

---

## Permissions Model

### `Permissions` interface — 11 fields

Defined in `lib/operator.ts`. All 11 must be present when constructing the object manually.

| field | description | owner | manager | cashier |
|-------|-------------|-------|---------|---------|
| `sales` | POS terminal | ✓ | ✓ | ✓ |
| `stock` | View inventory | ✓ | ✓ | ✓ |
| `stock_write` | Modify inventory | ✓ | ✓ | ✗ |
| `analysis` | Dashboard, statistics & activity log | ✓ | ✓ | ✗ |
| `price_lists` | View price lists | ✓ | ✓ | ✗ |
| `price_lists_write` | Modify price lists | ✓ | ✓ | ✗ |
| `expenses` | View and create expenses | ✓ | ✓ | ✗ |
| `settings` | Business settings | ✓ | ✗ | ✗ |
| `operators_write` | Create/edit operators (sub-toggle of settings) | ✓ | ✗ | ✗ |
| `price_override` | Edit per-item price in POS | ✓ | ✓ | ✗ |
| `free_line` | Add a free-text/unlinked line item in POS | ✓ | ✓ | ✗ |

> `operators_write` requires `settings: true` as prerequisite — it's a sub-toggle in `NewOperatorModal`.
>
> **Note on CONTEXT.md:** it says "9 campos" but there are 11. `price_override` is the 10th; `free_line` is the 11th.

### `OWNER_PERMISSIONS`

Defined in `lib/operator.ts`. All 11 fields set to `true`. Imported everywhere — never duplicate.

### `operator_session` cookie

```json
{
  "profile_id": "uuid",
  "name": "string",
  "role": "owner|manager|cashier|custom",
  "permissions": { ...all 11 fields... }
}
```

httpOnly, sameSite: lax, secure in production.

### `op_perms` cookie

Non-httpOnly copy of `permissions` object. Read by sidebar client-side. Written by `proxy.ts` on every request and by `/api/operator/switch`.

### `parsePermissions` soft defaults

`price_override`, `operators_write`, and `free_line` soft-default to `false` if absent from the cookie (backward compat with old cookies that predated these fields).

### When adding a new permission field

Update ALL of these in the same commit:
1. `lib/operator.ts` — `Permissions` interface + `OWNER_PERMISSIONS` + `DEFAULT_PERMISSIONS` + `OPERATOR_MANAGEMENT_PERMISSION_KEYS`
2. `lib/operator.ts` — `parsePermissions` + `normalizePermissions` + `toOperatorManagementPermissions`
3. `src/app/api/operator/switch/route.ts` — `parseVerifyResult`
4. `src/components/sidebar.tsx`
5. `src/components/settings/NewOperatorModal.tsx` + `EditOperatorModal.tsx`
6. DB: `operators.permissions` default JSONB + `create_operator` RPC role-default JSONBs

### Permission rename — `stats` → `analysis` (2026-05-16)

The `stats` permission was renamed to `analysis` to cover dashboard, estadísticas, and the new `/activity` route. The change touched: TypeScript `Permissions` interface and all derived constants/normalizers; `proxy.ts` route guard; `sidebar.tsx` link gates; operator modal toggle label ("Estadísticas" → "Análisis"); `create_operator` RPC role-default JSONBs; existing `operators.permissions` rows migrated via `permissions - 'stats' || jsonb_build_object('analysis', permissions->'stats')`; column default updated. Migration: `20260516_01_rename_stats_to_analysis.sql`.

---

## Payment Methods

`normalizePayment`, `PAYMENT_LABELS`, `PAYMENT_COLORS`, `PAYMENT_OPTIONS` from `lib/payments.ts` — never duplicated.

DB enum (`payments.method`): `'cash' | 'card' | 'transfer' | 'mercadopago'` — exactly these four.

---

## Route Map

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
| `/dashboard` | KPI dashboard | `permissions.analysis` |
| `/stats` | Statistics | `permissions.analysis` |
| `/stats/top-products` | Top products detail | `permissions.analysis` |
| `/stats/breakdown` | Category/brand breakdown | `permissions.analysis` |
| `/stats/payment-methods` | Payment methods detail | `permissions.analysis` |
| `/stats/operators` | Operator sales detail | `permissions.analysis` |
| `/activity` | Audit log | `permissions.analysis` |
| `/expenses` | Expenses module | `permissions.expenses` |
| `/expenses/providers` | Supplier management | `permissions.expenses` |
| `/profile` | Owner profile | owner only (non-owners get flash → /pos) |
| `/operator/me` | Active operator profile | any operator (owner included) |
| `/settings` | Business settings + operators | `permissions.settings` |

**Edge Runtime** (`export const runtime = 'edge'`): `/pos`, `/dashboard`, `/stats`, `/operator-select`, `/activity`

---

## Flash Toast System

`proxy.ts` sets cookie `flash_toast=no-access` (maxAge 5s, non-httpOnly) on permission redirect. `(app)/layout.tsx` reads it server-side and passes to `FlashToast` component.

The imperative in-page `Toast` (separate file `components/shared/Toast.tsx`) is unrelated and used for client-side success/error notifications.

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
