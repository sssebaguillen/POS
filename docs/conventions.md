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

All app routes are in English (`/customers`, `/orders`, `/cash-sessions`, `/stats/payment-methods`, etc.). **Sole exception:** `/catalogo/[slug]` — the public storefront for LATAM customers stays in Spanish. Sidebar labels and all user-facing UI copy remain in Spanish; only the URL path is English.

When renaming a route, update: the folder under `src/app/(app)/`, the matching component folder under `src/components/`, the component name itself, sidebar `NAV_LINKS` + `NAV_SECTIONS` `hrefs`, any route checks in `src/proxy.ts`, and any `localStorage` keys that referenced the old slug.

---

## Design System

- **Background:** CSS var `--background` | **Surface:** `--surface` | **Primary:** `#7a3e10` (warm brown, overridable via `businesses.settings.primary_color`)
- **Typography:** DM Sans — 7 semantic classes in `globals.css`: `.text-display`, `.text-heading`, `.text-subheading`, `.text-body`, `.text-caption`, `.text-label`, `.text-metric`
- Custom properties: `--body-secondary`, `--support`
- **Semantic tokens:** `--warning`/`--warning-foreground` (precaución) y `--promo`/`--promo-foreground` (verde unificado del catálogo: badges de oferta, precio rebajado, estados "agregado"). Usar `text-promo`/`bg-promo/...` — nunca `emerald-*` hardcodeado.
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

### List Patterns

Two — and only two — canonical patterns for any list/table view. Pick by *intent*, not by data shape.

**A. Tabular Browse** — scan many rows by attribute, sort/paginate, low per-row action density.
**B. Card Stack** — act on individual items, click → detail/expand, few attributes visible per row.

If a view needs *both* (scan + expand), use A and put the detail in an expanded row (see `/activity`).

#### A. Tabular Browse — reference: `ActivityResults.tsx`

```tsx
<div className="surface-card overflow-x-auto">
  <table className="w-full text-sm min-w-[640px]">
    <thead className="border-b border-edge/60 text-left text-hint">
      <tr>
        <th className="px-4 py-3">Columna</th>
        ...
      </tr>
    </thead>
    <tbody>
      {rows.map(row => <tr key={row.id} className="border-b border-edge/40 last:border-0">...</tr>)}
    </tbody>
  </table>
</div>
```

Rules:
- Container: **`surface-card overflow-x-auto`** (never raw `border border-border`).
- Header: **`border-b border-edge/60 text-left text-hint`**, cell padding **`px-4 py-3`** (header and body identical).
- Row separator: **`border-b border-edge/40 last:border-0`**.
- Min-width for horizontal scroll on mobile: **`min-w-[640px]`** (adjust per column count).
- Sortable headers: button inside `<th>` with `ChevronUp/ChevronDown` icon.
- Pagination: footer below the card, right-aligned `Anterior` / `Siguiente` buttons as in `ActivityResults.tsx:104-128`.
- Empty state: render *inside* the card (replaces `<table>`), centered with icon + title + body + optional CTA — see `EmptyFilteredState` / `EmptyActivityState`.

Used by: `/activity`, `/inventory` (list mode), `/customers`, `/stats/*`, `/price-lists`, `/cash-sessions`.

#### B. Card Stack — reference: `OrdersView.tsx`

```tsx
<div className="surface-card overflow-hidden">
  <div className="p-4 border-b border-edge-soft space-y-3">{/* filters/header */}</div>
  <ul className="p-3 space-y-1.5">
    {items.map(item => (
      <li key={item.id}>
        <button
          type="button"
          className="w-full text-left rounded-xl border border-edge/60 px-4 py-3 transition-colors hover:border-primary/30 hover:bg-surface-alt/40"
          onClick={() => onSelect(item)}
        >
          {/* row content */}
        </button>
      </li>
    ))}
  </ul>
</div>
```

Rules:
- Container: **`surface-card overflow-hidden`**, filter header **`p-4 border-b border-edge-soft`**.
- List: **`<ul className="p-3 space-y-1.5">`** with **`<li>`** wrappers (semantic, not bare divs).
- Row: **`rounded-xl border px-4 py-3`** (never `rounded-[20px]`, never `py-2.5`).
- Hover: **`hover:border-primary/30 hover:bg-surface-alt/40`**.
- Click target: `<button>` inside `<li>` — keeps the row keyboard-accessible without nesting interactive elements.
- Expandable variant (e.g. `SalesHistoryTable`): same row container, expanded state adds `border-primary/40 bg-surface-alt/30` and renders detail in a sibling div below the button inside the same `<li>`.

Used by: `/orders`, `/dashboard` (SalesHistoryTable, RecentActivityWidget).

#### Convergence status

All known outliers converged as of 2026-05-27:
- `CashSessionsView.tsx` — migrated to `surface-card` with canonical thead.
- `ProductCard.tsx` — `rounded-xl border` (was `rounded-[20px] border-2`).
- `SalesHistoryTable.tsx` — row card padding aligned to `px-4 py-3`.
- `OperatorList.tsx` — `<ul>` semantic wrapper with Card Stack row styling.
- `SuppliersPanel.tsx` — edit migrated from inline-edit-replaces-row to `EditSupplierModal` (matches OperatorList / NewProductModal / etc.).

CRUD edit pattern is now uniform: always a modal, never inline-replace-row.

#### Row Actions ("Acciones" column) — reference: `ProductListRow.tsx`

Acciones de fila en tablas se resuelven con **texto, no con iconos por acción**:

```tsx
<div className="flex items-center justify-end gap-1.5">
  <button className="text-xs px-3 py-2 rounded-lg border border-edge text-body hover:bg-hover-bg ... touch-manipulation">
    Editar
  </button>
  <Popover>
    <PopoverTrigger asChild>
      <button aria-label="Más acciones" className="px-2 py-2 rounded-lg border border-edge text-subtle ...">
        <MoreVertical size={16} />
      </button>
    </PopoverTrigger>
    <PopoverContent align="end" className="w-44 p-1 gap-0.5">
      <button className="w-full text-left text-sm px-2.5 py-2 rounded-md text-body hover:bg-hover-bg ...">Acción secundaria</button>
      <button className="w-full text-left text-sm px-2.5 py-2 rounded-md text-destructive hover:bg-destructive/10 ...">Acción destructiva</button>
    </PopoverContent>
  </Popover>
</div>
```

Rules:
- **La acción primaria es un botón de texto outline** (`text-xs px-3 py-2 rounded-lg border border-edge`), normalmente "Editar".
- **Las acciones secundarias y destructivas van en un menú kebab** (`MoreVertical` 16px dentro de Popover `w-44 p-1`). La destructiva al final, con `text-destructive hover:bg-destructive/10`.
- **El único icono permitido en la celda es el `MoreVertical` del kebab.** Nunca una fila de icon-buttons (lápiz/pausa/tacho): los iconos por acción no son auto-explicativos para el usuario objetivo ("context over documentation") y comprimen targets táctiles.
- Las acciones destructivas o irreversibles del menú abren `ConfirmModal` antes de ejecutar.

Used by: `/inventory` (`ProductListRow`), `/promotions` (`PromotionsView`).

#### Button Icons — único-en-contexto sí, repetido-por-fila no

- **Con icono:** botones únicos en su contexto — CTAs de header (`Plus` en "Nuevo producto"/"Nueva promoción", `Building2` en "Proveedores"), CTA del empty state, trigger del kebab (`MoreVertical`).
- **Sin icono (texto puro):** cualquier botón que se repite por fila en tablas/listas ("Editar", "Ajustar", "Cobrar"). Un icono en el CTA es punto focal; el mismo icono repetido en 30 filas es una columna de ruido que compite con los datos.
- Si un botón de fila "se siente plano", el fix es jerarquía (peso, borde, hover), no un icono de 13px.
- Antecedente: los "Ajustar" de `/price-lists` llevaban `Pencil` y se percibían raros; al quitar el icono convergieron con `ProductListRow`. De paso, botones repetidos que operan sobre niveles distintos se desambiguan con el **label**, no con iconos ("Ajustar marca" en la fila de grupo vs "Ajustar" en la de producto).

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

### Form Validation Timing

Standard policy across the codebase:

- **Validate on submit only.** The submit handler calls `validate()` (or `validateBaseFields()` from `useProductForm`) and shows errors. Don't validate on every keystroke.
- **Clear field error on change.** When the user starts editing a field with an error, clear that field's error immediately. `useProductForm.setField()` does this automatically; ad-hoc setters should follow the same pattern: `setErrors(prev => ({ ...prev, [field]: '' }))`.
- **`onBlur` is reserved for narrow domain-specific validation** where blur-time feedback is meaningfully better than submit-time. Examples in use: slug regex in `SettingsForm`, PIN match in `OperatorMeView`, price-edit commit in `CartPanel`. Not for general field validation.

Server-side validation errors (RPC failures, RLS denials) surface via `translateDbError` into `errors._global`, displayed as a banner at the top of the form.

### Modal Headers

Most modals build a bespoke top bar (title + close button) instead of using shadcn's `<DialogHeader>`. The canonical structure:

```tsx
<DialogContent className="...">
  <div className="flex items-center justify-between px-5 py-4 border-b border-edge shrink-0">
    <DialogTitle className="text-base font-semibold text-heading">Título del modal</DialogTitle>
    <button
      type="button"
      onClick={handleClose}
      className="p-1.5 rounded-lg hover:bg-hover-bg transition-colors text-hint"
      aria-label="Cerrar modal"
    >
      <X className="w-4 h-4" />
    </button>
  </div>
  {/* ...content... */}
</DialogContent>
```

shadcn's `<DialogHeader>` lacks a close-button slot and applies text-center alignment on mobile — neither is what we want. Reserve `<DialogHeader>` for content modals that don't need a custom close affordance (currently: `FeedbackModal`, `ChangelogModal`).

La "X" de cierre SIEMPRE lleva el fondo en hover (`p-1.5 rounded-lg hover:bg-hover-bg ... text-hint` + `<X className="w-4 h-4" />`) — la variante sin fondo (`text-hint hover:text-body p-0.5`) es una desviación, no una opción. Outliers pendientes de converger: `NewPriceListModal`, `ExportPriceListModal`, `PriceListsPanel` (drawer).

### Breadcrumbs

`PageHeader` accepts `breadcrumbs?: { label: string; href: string }[]`. Required on sub-routes, not on top-level routes.

| Route | breadcrumbs |
|-------|------------|
| `/stats/top-products` | `[{ label: 'Estadísticas', href: '/stats' }]` |
| `/stats/breakdown` | `[{ label: 'Estadísticas', href: '/stats' }]` |
| `/stats/payment-methods` | `[{ label: 'Estadísticas', href: '/stats' }]` |
| `/stats/operators` | `[{ label: 'Estadísticas', href: '/stats' }]` |
| `/stats/trends` | `[{ label: 'Estadísticas', href: '/stats' }]` |

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
| `/catalogo/[slug]/promotions` | Public catalog — offers page | public (anon, uses RPCs) |
| `/catalogo/[slug]/[productId]` | Public catalog — product detail | public (anon, uses RPCs) |
| `/operator-select` | Operator selection | requires Supabase session |
| `/pos` | POS terminal | any active operator |
| `/inventory` | Inventory (read) | `permissions.stock` |
| `/products` | Inventory (write) | `permissions.stock` + `permissions.stock_write` |
| `/price-lists` | Price lists | `permissions.price_lists` |
| `/promotions` | Promos y ofertas (CRUD, chips de estado) | `permissions.inventory_read` (escrituras: `inventory_write` en RPCs) |
| `/dashboard` | KPI dashboard | `permissions.analysis` |
| `/stats` | Statistics | `permissions.analysis` |
| `/stats/top-products` | Top products detail | `permissions.analysis` |
| `/stats/breakdown` | Category/brand breakdown | `permissions.analysis` |
| `/stats/payment-methods` | Payment methods detail | `permissions.analysis` |
| `/stats/operators` | Operator sales detail | `permissions.analysis` |
| `/stats/trends` | Daily trends + period comparison | `permissions.analysis` |
| `/activity` | Audit log | `permissions.analysis` |
| `/expenses` | Expenses module | `permissions.expenses` |
| `/expenses/providers` | Supplier management | `permissions.expenses` |
| `/orders` | Pedidos Online (catalog orders) | `permissions.sales` |
| `/customers` | Customers | always (read), `permissions.sales` to mutate |
| `/cash-sessions` | Cash sessions history | `permissions.analysis` |
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
