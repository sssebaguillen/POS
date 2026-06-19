# Handoff: Migrate icons from Lucide → Phosphor (Pulsar POS)

## Overview
The Pulsar POS design system has adopted **Phosphor Icons (regular weight)** as its official icon vocabulary, replacing **Lucide** (`lucide-react`), which the production codebase currently uses. Phosphor's warmer, slightly-rounded line style sits better next to the Sora display type and the terra palette; its six weights also give us `fill` for active/selected states without introducing a second family.

This package is the spec for performing that migration in the **PulsarPos** codebase (Next.js + React + TypeScript). It is a mechanical, low-risk swap: same outline style, same `currentColor` inheritance, same nominal sizing — only the import source and a handful of glyph names change.

## About the design files
The files in this bundle are **design references** — the design system's chosen icon set, a name-mapping module, and a live comparison card created in HTML. They are **not** production code to paste in. The task is to apply the Phosphor icon system to the **existing PulsarPos React/TypeScript codebase**, using its established component patterns (`lucide-react` is imported directly in `.tsx` components today; replace those imports in place).

## Fidelity
**High-fidelity.** Icon names, weights, sizes, and usage rules below are final. Recreate them exactly against the codebase's existing icon call sites.

---

## The change, in one paragraph
Replace `import { X } from 'lucide-react'` with the Phosphor equivalent from `@phosphor-icons/react`. Use **regular** weight as the default (Phosphor's default — no `weight` prop needed). Use `weight="fill"` **only** for active/selected/emphasis states (e.g. the active sidebar item, a toggled-on state), tinted with `--primary`. Phosphor accepts `size` (number, px) and inherits `color` via `currentColor`, exactly like Lucide — but it does **not** take Lucide's `strokeWidth` prop, so remove those.

## Step-by-step

1. **Install**
   ```bash
   npm install @phosphor-icons/react
   ```

2. **Find every call site**
   ```bash
   grep -rn "lucide-react" src/
   ```

3. **Replace imports** using the name map below. Phosphor exports are PascalCase, imported from the package root:
   ```tsx
   // before
   import { ShoppingCart, BarChart2, Settings } from 'lucide-react'
   // after
   import { ShoppingCart, ChartBar, Gear } from '@phosphor-icons/react'
   ```

4. **Fix props**
   - `size={18}` → keep as-is (Phosphor supports `size`).
   - `strokeWidth={...}` → **remove** (Phosphor has no stroke-width prop; use `weight` instead if a heavier look is needed).
   - `className` for color → keep (color still flows via `currentColor` / Tailwind text-color classes).
   - Active/selected states → add `weight="fill"` and ensure the color token is `--primary` (e.g. `text-primary`).

5. **Verify** no file still imports `lucide-react`:
   ```bash
   grep -rn "lucide-react" src/   # should return nothing
   ```
   Then build/typecheck: `npm run build` (or `tsc --noEmit`).

---

## Icon name map (Lucide → Phosphor)

Every Lucide icon currently used in the app, with its Phosphor replacement (regular weight). `@phosphor-icons/react` import name on the right; the `ph:<slug>` form is the Iconify slug used in the HTML references.

| Lucide (`lucide-react`) | Phosphor (`@phosphor-icons/react`) | Iconify slug | Used for |
|---|---|---|---|
| `ShoppingCart` | `ShoppingCart` | `ph:shopping-cart` | Vender |
| `Users` | `Users` | `ph:users` | Clientes |
| `User` | `User` | `ph:user` | Operator / cliente |
| `Inbox` | `Tray` | `ph:tray` | Pedidos online |
| `BarChart2` | `ChartBar` | `ph:chart-bar` | Resumen |
| `LineChart` | `ChartLine` | `ph:chart-line` | Estadísticas |
| `History` | `ClockCounterClockwise` | `ph:clock-counter-clockwise` | Actividad |
| `Package` | `Package` | `ph:package` | Inventario |
| `ClipboardList` | `ClipboardText` | `ph:clipboard-text` | Listas de precios |
| `BadgePercent` | `SealPercent` | `ph:seal-percent` | Promociones |
| `Receipt` | `Receipt` | `ph:receipt` | Gastos |
| `Vault` | `Vault` | `ph:vault` | Caja |
| `Settings` | `Gear` | `ph:gear` | Configuración |
| `Globe` | `Globe` | `ph:globe` | Catálogo online |
| `Search` | `MagnifyingGlass` | `ph:magnifying-glass` | Buscar |
| `ScanBarcode` | `Barcode` | `ph:barcode` | Escanear código |
| `ChevronDown` | `CaretDown` | `ph:caret-down` | Dropdowns / selects |
| `Check` | `Check` | `ph:check` | Confirmar / selección |
| `Plus` | `Plus` | `ph:plus` | Sumar cantidad / nuevo |
| `Minus` | `Minus` | `ph:minus` | Restar cantidad |
| `Trash2` | `Trash` | `ph:trash` | Eliminar |
| `Percent` | `Percent` | `ph:percent` | Descuento |
| `PenLine` | `PencilSimple` | `ph:pencil-simple` | Editar / monto libre |
| `Moon` | `Moon` | `ph:moon` | Modo oscuro |
| `PanelLeftClose` | `SidebarSimple` | `ph:sidebar-simple` | Colapsar sidebar |
| `X` | `X` | `ph:x` | Cerrar |
| `TrendingUp` | `TrendUp` | `ph:trend-up` | KPI trend ↑ |
| `TrendingDown` | `TrendDown` | `ph:trend-down` | KPI trend ↓ |

> If `grep` turns up a Lucide icon not in this table, pick the closest Phosphor match at https://phosphoricons.com (regular weight) and add it to the table. Do not introduce a second icon family.

## Usage rules (from the design system)
- **Default weight: `regular`.** No `weight` prop needed.
- **`fill` only for active/selected/emphasis** states, colored with `--primary` (e.g. active nav item, toggled state, success checkmark badge).
- **Sizes:** `18` in nav and most controls, `16` inline in fields/buttons, `13–14` for dense metadata. (Matches the current Lucide sizing — keep existing `size` values.)
- **Color** always via `currentColor` / Tailwind text classes (`text-body`, `text-hint`, `text-primary`). Never hard-code icon hex.
- **No emoji, no second outline family, no hand-rolled illustrative SVG.**

## Reference files in this bundle
- `icons.js` — the canonical Lucide-name → Phosphor-slug map as used in the design system's UI kit (`window.POSIcons`), rendered via the Iconify web component. Mirrors the table above; use it to cross-check names.
- `brand-iconography.card.html` — a live, side-by-side comparison of Lucide vs Phosphor vs Tabler (open in a browser) showing why Phosphor was chosen and the regular→fill weight ramp.
- `README_designsystem.md` — the full Pulsar POS design-system guide (colors, type, spacing, iconography, do/don't) for broader context.

## Assets
No binary assets. Phosphor ships as a React package (`@phosphor-icons/react`); the HTML references load it via the Iconify CDN. No SVG files need to be copied into the codebase.

## Acceptance criteria
- `grep -rn "lucide-react" src/` returns nothing.
- `lucide-react` removed from `package.json` dependencies.
- App builds and typechecks clean.
- Active sidebar item and other selected/emphasis states use `weight="fill"` in `--primary`; all other icons are regular.
- Visual spot-check: nav, POS (Vender), and Resumen screens render the new icons at the same sizes as before.
