# Pulsar POS — Design System

> **The Calibrated Counter.** Pulsar POS is a browser-based point-of-sale for small businesses in Argentina and LATAM — the almacén, the kiosko, the clothing or hardware shop. The interface should feel like a well-worn but perfectly-calibrated instrument: warm paper tones, ink-brown type, tactile states that respond without drama. Every pixel either earns speed or earns trust; nothing else.

This repository is the brand's design system — tokens, fonts, reusable components, foundation specimens, and a full UI-kit recreation of the core product surface. Use it to build well-branded Pulsar POS interfaces and assets, for production or for throwaway mocks.

---

## Product context

Pulsar POS is a multi-tenant SaaS POS that replaces expensive hardware tills with a free, browser-based tool. The target user is the **business owner as primary cashier** — busy counter, customers waiting, cash and card. The product wins when someone can ring up a sale, check the day's totals, and manage inventory **without any training**.

**Brand personality:** precise, warm, reliable — like a well-calibrated scale. Not corporate, not startup-flashy. The name carries a double meaning: the physical *press* of a key, and a *pulsar* (a fast, dense, powerful neutron star).

**Anti-references (explicitly rejected):**
- Generic SaaS dashboard look — blue/purple palette, glowing hero-metric cards.
- Dated desktop POS — grey Windows forms, cluttered toolbars, raised buttons.
- Anything that looks like it needs a manual.

> **A note on naming.** A rebrand away from "Pulsar" is under exploration (leading candidates have included *Praddo* and *Pulcra*) but **has not been executed**. Everything here uses **Pulsar POS**. Don't treat any new name as final. The visual identity — warm terra palette, matte, crafted — is settled and is what this system encodes.

### Sources

This system was reverse-engineered from the product's own codebase and design docs. If you have access, explore them to go deeper:
- **Local codebase:** `PulsarPos/` (Next.js + Supabase). Key references: `DESIGN.md`, `DESIGN.json`, `PRODUCT.md`, `docs/branding.md`, `src/app/globals.css`, `src/components/ui/*`, `src/components/pos/*`, `src/components/sidebar.tsx`.
- **GitHub:** [`sssebaguillen/POS`](https://github.com/sssebaguillen/POS) — explore this repository to build richer, more accurate Pulsar POS designs.

---

## Content fundamentals

**Language: Spanish (Argentina / Río de la Plata), `es-AR`.** All product copy is Spanish. UI examples: *Vender, Clientes, Pedidos online, Resumen, Estadísticas, Gastos, Caja, Inventario, Listas de precios, Promociones, Configuración.* Use Argentine money formatting: `$248.300` (dot as thousands separator, `$` prefix, currency ARS).

**Voice — second person, warm and direct.** Copy addresses the user as **vos/tú** informally: *"Ingresá a tu negocio"*, *"Actualizá los datos visibles en el sistema"*, *"Escaneá un producto o seleccionalo del panel para comenzar"*. Imperatives are friendly, never barked. (Source copy mixes `tú` and `vos` imperative forms — match whichever the surrounding screen uses; lean Rioplatense `vos` for new copy.)

**Tone principles (from the product):**
- *Speed over completeness* — one tap or one Enter. Copy is short; labels are nouns.
- *Context over documentation* — the UI explains itself through state, not tooltips. Avoid help text.
- *Trust the operator* — don't ask cashiers to confirm low-risk actions. Reserve confirmation for genuinely destructive paths (and there, use the progressive `cancel` button).
- *Errors are real* — stock is finite, money matters. Be honest and direct: *"Sin stock"*, *"Código no encontrado"*, *"Hay ítems con stock insuficiente"*. Never surface a raw server/Supabase error — wrap it in plain language.

**Casing:** Sentence case for headings and buttons (*"Nueva venta"*, not "Nueva Venta"). `UPPERCASE` + 0.06em tracking **only** for the 10px `.text-label` role (field labels, table column headers).

**Emoji:** none. The system uses Lucide line icons instead (see Iconography). No emoji in UI, copy, or data.

**Numbers & metadata:** tabular numerals everywhere money or counts appear. Relative time in lowercase (*"hace 5 minutos"*). Status as short badges (*Activo, Pagado, Sin stock, Stock bajo*).

---

## Visual foundations

**Palette — "The Warm Ledger".** A monochromatic warm-brown family from near-black to ivory, with exactly **one accent per theme**. Chroma stays low across neutrals; all warmth comes from hue angle (45–80° in OKLCH), never saturation.
- **Light mode:** Warm Ivory background (`#fbfaf2`), Clean Card surfaces (`#ffffff`), Dark Roast ink (`#1c1008`), **Burnt Espresso** accent (`#7a3e10`).
- **Dark mode:** Charred Graphite background (`#0e0e0d`), Ink Black cards (`#161614`), Warm Cream text (`#f1dbbf`), **Amber Ember/amber** accent (`#e08535`).
- **The One Accent Rule:** the accent appears on ≤10% of a screen — the single primary CTA, active nav, focus rings, toggle-on. Nowhere decorative. Need a second emphasis? Use weight, size, or a body/hint step — never a second colour.
- **The Warmth Floor Rule:** no surface or text is pure `#fff`, pure `#000`, or RGB-neutral grey. Every token carries a minimum warm hue.
- **Semantics:** one each — Ember Red destructive, Golden Ochre warning, and **a single Harvest Olive green** shared by all positive meanings (profit, success, catalog offers via the `--promo` alias). Semantic fills are tints at 10–12% with full-opacity text, never solid alarming blocks.

**Type — two fonts, strict split.** **Sora** (display) carries structure: page titles, section headings, KPI values, all `h1`–`h6`. **DM Sans** (body) handles the entire operational layer: labels, tables, forms, buttons, helper copy. *The Font Split Rule:* never Sora on a button, label, table cell, or form field; never DM Sans on a heading. Scale: Display 18 / Headline 16 / Emphasis 15 / Body 14 / Body-sm 13 / Caption 11 / Label 10 (uppercase, tracked).

**Spacing & radii.** 8px-based spacing (xs 4 · sm 8 · md 16 · lg 24 · xl 40). Soft warm radii: controls 8px, Card 12px, modals 16px, page panels **20px**, pills/badges full. Small controls cap their radius so they never over-round.

**Surfaces, backgrounds & texture.** No photographic or full-bleed imagery in the app chrome; product/category tiles use flat warm swatch fills (`--cat-0…5`) when there's no product photo. The system's **signature material** is a subtle monochrome **noise grain** + a **warm 145° diagonal gradient** (`card → surface-tint`) applied via `soft-light` blend to every major surface — it prevents "generic SaaS flatness" without calling attention to itself. No bluish-purple gradients, ever. No gradient *text*.

**Elevation.** Tonal layering is the primary depth cue; shadows are **structural only** (three named levels: `surface-card`, `surface-elevated`, `surface-sidebar`), never decorative or added on hover. Light mode uses soft diffused ambient shadows; dark mode needs a 6-step drop cascade plus inset highlight rings because tonal separation alone reads flat on near-black. *The Flat-at-Rest Rule.* *The No-Nest Rule:* never nest `surface-card` in `surface-card`; `surface-elevated` is always a float.

**Cards.** `surface-card` = 20px radius, noise + gradient, soft ambient shadow, 50%-opacity Tan Border. Nested `Card` (shadcn-style) = 12px, 1px hairline ring at `foreground/10`, no shadow — used only for a distinct data entity inside a `surface-card`.

**Borders.** 1px Tan Border (`#e0d4c0`) on all strokes; dividers use Sand Dune/`edge-soft`. **Never** a coloured `border-left`/`border-right` stripe >1px on cards or list items — use a background tint, leading icon, or number instead.

**Corners, transparency & blur.** Rounded, warm, matte. **No glassmorphism** (`backdrop-filter: blur`) anywhere in standard UI — the noise grain already supplies materiality. Subtle fills use opacity modifiers (`/10`, `/30`, `/50`) of existing tokens rather than new hexes.

**Motion.** Restrained. 200ms standard, `ease-standard` (`cubic-bezier(.4,0,.2,1)`) for state changes; 150ms for hover/focus/active; 250ms `animate-fade-in` for initial content reveal only. Presses scale to ~0.97. The **only choreographed transition** is the pill-tab indicator tracking selection. No staggered entrances, no hover-lift, no scroll-driven sequences, no decorative loops.

**Hover / press states.** Hover = a **background colour change** (`--accent`/`--muted` fill), never an added shadow. Primary button hover darkens ~10%; outline/ghost fill with the muted/linen surface. Press = `scale(0.97)`. Focus = 3px `--ring` at 50% opacity. Inputs shift their border to Burnt Espresso on focus with the same ring.

**Imagery vibe.** Warm, matte, terra. When real product imagery exists it sits in 8px-radius tiles; otherwise the warm category swatch stands in. Nothing cold, glossy, or neon.

---

## Iconography

**Phosphor** (the `@phosphor-icons` set, **regular** weight) is the system's official icon vocabulary — a warm, slightly rounded line style whose hand-tuned geometry sits naturally next to Sora and the terra palette. Sizes: **18px** in nav and most controls, **16px** inline in fields/buttons, **13–14px** for dense metadata. Icons inherit `currentColor` so they pick up body/hint/primary as appropriate. Phosphor ships six weights — use **regular** as the default and **fill** (in `--primary`) for active/selected states; reach for thin/light/bold only with intent.

> **History:** the production codebase still uses **Lucide** (`lucide-react`); Phosphor is the design system's chosen direction going forward. The two are close cousins (both even-stroke outline sets), so a screen built in either reads as the same family during the transition. **Tabler** is the sanctioned precise/technical alternative if a surface needs crisper geometry.

- **No emoji.** Anywhere — UI, copy, or seed data.
- **No second outline family mixed in, no hand-rolled illustrative SVG.** If you need a glyph that isn't in the kit, pull the matching Phosphor icon (`ph:<name>`, regular weight). Fill weight is reserved for active states.
- Common icons in use: `ph:shopping-cart` (Vender), `ph:users` (Clientes), `ph:tray` (Pedidos), `ph:chart-bar`/`ph:chart-line` (Resumen/Estadísticas), `ph:package` (Inventario), `ph:receipt` (Gastos), `ph:vault` (Caja), `ph:seal-percent` (Promociones), `ph:gear`, `ph:magnifying-glass`, `ph:barcode`, `ph:trash`, `ph:plus`/`ph:minus`, `ph:check`.
- **Logo:** there is **no finalized logo mark** (a redesign is pending the naming decision). The current identity is the **business name set in Sora bold** in the sidebar header; the product wordmark is "Pulsar POS" in Sora bold with the accent on "POS". See `guidelines/brand-wordmark.card.html`.

The UI kit renders Phosphor via the Iconify web component (`<iconify-icon icon="ph:…">` — real, themeable inline SVG); see `ui_kits/pos/icons.js` for the name map. The Iconography card (`guidelines/brand-iconography.card.html`) shows Phosphor against Lucide and Tabler.

---

## What's in here

```
styles.css                  ← consumers link THIS (imports only)
tokens/
  fonts.css                 DM Sans + Sora (Google Fonts CDN)
  colors.css                named scale + light/dark semantic aliases
  typography.css            families, scale, weights
  spacing.css               spacing, radii, control heights, breakpoints
  elevation.css             shadows + surface-card / -elevated / -sidebar + noise
  motion.css                easing, durations, fade-in, skeleton
  utilities.css             type roles + pill-tabs classes
components/
  buttons/      Button      seven variants, five sizes
  feedback/     Badge       status / category / count pills
  forms/        Input, Toggle
  surfaces/     SurfaceCard, Card
  navigation/   PillTabs    animated segment control
  data/         KPICard     dashboard metric tile
guidelines/                 foundation specimen cards (Colors · Type · Spacing · Brand)
ui_kits/
  pos/                      interactive recreation of the core "Vender" screen
  dashboard/                interactive recreation of the "Resumen" dashboard
SKILL.md                    Agent-Skill entry point
```

**Components** are React (`.jsx`) with a sibling `.d.ts` contract and `.prompt.md` usage note; each directory has an `@dsCard` HTML thumbnail. They're self-contained (React only) and drive all colour/theme from the CSS custom properties, so they theme automatically in light/dark.

**Using the tokens:** link `styles.css` and write against the semantic variables (`var(--primary)`, `var(--surface)`, `var(--body-color)`, …). Add `class="dark"` to a root element for dark mode.

**Fonts:** loaded from the Google Fonts CDN in `tokens/fonts.css` — these are the genuine brand fonts (DM Sans + Sora), not substitutes. For fully offline/self-hosted use, replace that `@import` with local `@font-face` rules pointing at bundled `.woff2` files. *(See Caveats.)*

---

## Do / Don't (the short list)

**Do** — use the accent once per view · apply `surface-card`/`surface-elevated` for their full elevation vocabulary · Sora for headings & values, DM Sans for everything else · tinted opacity fills over new hexes · inline error copy next to its field · the `cancel` button in destructive dialogs · ≥32px touch targets (44px for tablet primaries).

**Don't** — blue/purple or glowing-card SaaS aesthetics · dated grey POS chrome · coloured side-stripes on cards · gradient text · glassmorphism/blur · pure `#fff`/`#000`/neutral grey · Sora on buttons/labels/cells · decorative motion · raw server errors shown to users.
