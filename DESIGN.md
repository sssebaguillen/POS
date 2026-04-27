---
name: Pulsar POS
description: Browser-based point-of-sale for LATAM small businesses — warm, precise, fast.
colors:
  # Light mode
  primary: "#7a3e10"
  primary-foreground: "#ffffff"
  background: "#fbfaf2"
  card: "#ffffff"
  surface-tint: "#f5f0e8"
  secondary: "#ede6dc"
  accent: "#f0e8de"
  body: "#8a6848"
  hint: "#b09880"
  faint: "#d4c8b8"
  border: "#e0d4c0"
  foreground: "#1c1008"
  destructive: "#c0392b"
  destructive-foreground: "#ffffff"
  # Dark mode overrides (document as alternates)
  primary-dark: "#c8843a"
  background-dark: "#0e0e0d"
  card-dark: "#161614"
  foreground-dark: "#f1dbbf"
  body-dark: "#a89880"
  border-dark: "#2a2926"
  destructive-dark: "#e05a40"
typography:
  display:
    fontFamily: "Sora, ui-sans-serif, system-ui, sans-serif"
    fontSize: "18px"
    fontWeight: 700
    lineHeight: 1.3
    letterSpacing: "normal"
  headline:
    fontFamily: "Sora, ui-sans-serif, system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 600
    lineHeight: 1.4
  body:
    fontFamily: "DM Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "DM Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "10px"
    fontWeight: 500
    letterSpacing: "0.06em"
  caption:
    fontFamily: "DM Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "11px"
    fontWeight: 400
    lineHeight: 1.4
rounded:
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "20px"
  full: "9999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "16px"
  lg: "24px"
  xl: "40px"
components:
  button-primary:
    backgroundColor: "#7a3e10"
    textColor: "#ffffff"
    rounded: "8px"
    height: "32px"
    padding: "0 10px"
  button-primary-hover:
    backgroundColor: "#6a3408"
  button-outline:
    backgroundColor: "#ffffff"
    textColor: "#1c1008"
    rounded: "8px"
    height: "32px"
    padding: "0 10px"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "#1c1008"
    rounded: "8px"
    height: "32px"
    padding: "0 10px"
  button-destructive:
    backgroundColor: "#fdf0ee"
    textColor: "#c0392b"
    rounded: "8px"
    height: "32px"
    padding: "0 10px"
  button-cancel:
    backgroundColor: "#ffffff"
    textColor: "#1c1008"
    rounded: "8px"
    height: "32px"
    padding: "0 10px"
  input-default:
    backgroundColor: "#ffffff"
    textColor: "#1c1008"
    rounded: "8px"
    height: "32px"
    padding: "0 10px"
  badge-primary:
    backgroundColor: "#7a3e10"
    textColor: "#ffffff"
    rounded: "9999px"
    height: "20px"
    padding: "0 8px"
  badge-secondary:
    backgroundColor: "#ede6dc"
    textColor: "#1c1008"
    rounded: "9999px"
    height: "20px"
    padding: "0 8px"
  badge-outline:
    backgroundColor: "transparent"
    textColor: "#1c1008"
    rounded: "9999px"
    height: "20px"
    padding: "0 8px"
---

# Design System: Pulsar POS

## 1. Overview

**Creative North Star: "The Calibrated Counter"**

Pulsar POS is a tool used at a physical counter under ambient shop lighting, by hands that have already rung up a hundred transactions today. The interface should feel like a well-worn but perfectly-calibrated instrument — warm paper tones, ink-brown type, tactile states that respond without drama. The name carries this double meaning: the physical press of a key and the compressed precision of a neutron star. Every pixel either earns speed or earns trust; nothing else.

The palette is warm ivory in light mode (the color of a receipt, of a ruled notebook page) and near-black with amber accents in dark mode (the color of a dim storeroom, a screen at the back of a quiet shop). Surfaces have subtle noise texture and soft gradients that prevent the flatness of "generic SaaS," without calling attention to themselves. The design should feel like it was crafted, not generated.

This system explicitly rejects: generic SaaS dashboard look (blue/purple palette, hero metrics with glowing cards), dated desktop POS UI (grey Windows forms, cluttered toolbars), and anything that requires a manual to operate. Warmth is not decoration — it is trust infrastructure for a business owner handling real money.

**Key Characteristics:**
- Warm ivory / near-black surfaces tinted toward the brand hue, never pure white or pure black
- Single brand accent (Burnt Espresso in light, Amber Ember in dark) used only on primary actions, active states, and critical indicators
- Two-font system: Sora for semantic headings and prominent values; DM Sans for all UI text, labels, tables, forms
- Noise grain + warm diagonal gradient on all major surfaces — the system's signature texture
- Flat-by-default with three named elevation levels: card, elevated, sidebar
- Restrained motion — 200ms standard, ease-standard only, no choreography

## 2. Colors: The Warm Ledger Palette

A monochromatic warm-brown family from near-black to ivory, with one accent per theme. Chroma is intentionally low across neutrals; all warmth comes from hue angle (45–75° in OKLCH), not saturation.

### Primary
- **Burnt Espresso** (`#7a3e10` / oklch(38% 0.12 48)): The sole accent in light mode. Used on primary buttons, focus rings (`--ring`), active nav states, badge default, and toggle-on states. Never used decoratively — its rarity is the point.
- **Amber Ember** (`#c8843a` / oklch(62% 0.14 55)): The dark-mode shift of Burnt Espresso. Same role, brighter luminance to maintain contrast against near-black surfaces. Defined as `--primary-dark`.

### Neutral
- **Warm Ivory** (`#fbfaf2` / oklch(98% 0.008 80)): App background (`--background`, `--app-bg`) in light mode. The lightest surface; carries the faintest warm tint to avoid cold white.
- **Dark Roast** (`#1c1008` / oklch(12% 0.025 50)): Primary text (`--foreground`) in light mode. Deep warm black — not neutral grey, not pure `#000`.
- **Clean Card** (`#ffffff`): Card and popover background in light mode. Slightly cooler than the app background to create the first surface separation without color.
- **Sand Dune** (`#ede6dc` / oklch(92% 0.015 75)): `--secondary` and `--muted`. Used for muted surface backgrounds, secondary buttons, and the pill-tab container.
- **Pale Linen** (`#f0e8de` / oklch(94% 0.012 70)): `--accent`. Hover backgrounds, muted UI state fills.
- **Muted Sienna** (`#8a6848` / oklch(52% 0.06 55)): `--body-color`. Secondary text, descriptions, list metadata.
- **Faded Khaki** (`#b09880` / oklch(68% 0.04 65)): `--hint`. Timestamps, placeholder-level metadata; readable but receding.
- **Dusty Limestone** (`#d4c8b8` / oklch(83% 0.02 70)): `--faint`. Dividers, scrollbar thumbs, skeleton loading backgrounds.
- **Tan Border** (`#e0d4c0` / oklch(86% 0.02 70)): `--border` / `--input`. All stroke elements.
- **Charred Graphite** (`#0e0e0d` / oklch(8% 0.003 50)): Dark-mode app background. Nearly black with a trace of warmth to prevent the blue cast of `#000`.
- **Ink Black** (`#161614` / oklch(11% 0.005 50)): Dark-mode card surface. One level above the app background.
- **Warm Cream** (`#f1dbbf` / oklch(90% 0.04 75)): Dark-mode foreground text. Warm off-white that avoids the cold cast of pure `#fff`.

### Semantic
- **Ember Red** (`#c0392b` / oklch(48% 0.18 25)): Destructive actions in light mode. Used at 10% opacity for destructive button backgrounds, full opacity for text and borders.
- **Coral Warning** (`#e05a40` / oklch(58% 0.16 28)): Destructive in dark mode — lighter for contrast.

### Named Rules
**The One Accent Rule.** Burnt Espresso (or Amber Ember in dark) is used on ≤10% of any given screen. It appears on: the single primary CTA, active navigation items, focus rings, toggle-on state. Nowhere else. If a second element needs emphasis, use weight, size, or the body/hint color step — never a second accent color.

**The Warmth Floor Rule.** No surface in this system is pure white (`#ffffff` in body, `#000` as text) or RGB-neutral grey. Every color token carries a minimum hue of 45–80° (warm amber range), even if chroma is near-zero. Run this check: if `oklch(L% 0 H)` would look identical to `oklch(L% C H)`, the chroma is fine. If it looks cold, raise it.

## 3. Typography

**Display / Heading Font:** Sora (with `ui-sans-serif, system-ui, sans-serif` fallback)
**Body / UI Font:** DM Sans (with `ui-sans-serif, system-ui, sans-serif` fallback)

**Character:** Sora carries the structural weight — page titles, section headings, modal headers, prominent numeric values. It has slightly rounded geometry that contributes to the warm, approachable quality without being playful. DM Sans handles everything in the operational layer: form labels, table cells, button text, helper copy. Together they create a clear two-tier hierarchy without requiring size extremes.

### Hierarchy

- **Display** (Sora, 700, 18px, lh 1.3): Page titles in `<PageHeader>` (`h1.font-display.text-lg.font-bold`). The largest text on any screen. Used once per view.
- **Headline** (Sora, 600, 16px, lh 1.4): Section card headings (`h2` inside cards). Distinguishes named sections within a view.
- **Title** (DM Sans, 600, 15px, lh 1.4): `.text-emphasis` — Sora variant for KPI values and prominent data points. Also Sora-rendered via semantic `h3`/`h4`.
- **Body** (DM Sans, 400, 14px, lh 1.5): `md:text-sm` standard body. Table cells, form descriptions, operator names, product titles. Max 65–75ch for prose blocks.
- **Body Small** (DM Sans, 400, 13px, lh 1.4): `.text-body-sm`. Dense UI content, list items, helper text.
- **Label** (DM Sans, 500, 10px, ls 0.06em, uppercase): `.text-label`. Field labels above inputs, column headers, category chips. The system's smallest text; uppercase and tracked so it reads clearly at this scale.
- **Caption** (DM Sans, 400, 11px, lh 1.4): `.text-caption`. Timestamps, secondary metadata, muted descriptions.

### Named Rules
**The Font Split Rule.** Sora is reserved for headings (`h1`–`h6` semantically, or `.font-display` explicitly) and `.text-emphasis` values. DM Sans handles everything else. Never use Sora on labels, buttons, table cells, or form fields — its display weight reads as decorative at those sizes. Never use a font stack not derived from `--font-sans` or `--font-display`.

## 4. Elevation

This system uses **tonal layering as the primary depth mechanism** in both light and dark mode, supplemented by soft diffused shadows on the two main surface levels. There are no hard drop-shadows used decoratively — shadows are strictly structural, communicating which layer a surface occupies.

In light mode, depth is read through: app background (Warm Ivory) → card surface (Clean Card) → elevated surface (Clean Card + noise texture). In dark mode: Charred Graphite → Ink Black → slightly lighter popover surface. The `--noise` SVG filter and warm diagonal gradient (`145deg, card 0%, surface-tint 100%`) applied to `.surface-card` and `.surface-elevated` create tactile materiality without introducing color complexity.

### Shadow Vocabulary

- **surface-card** (`inset 0 1px 0 rgba(255,255,255,0.85), 0 1px 3px rgba(0,0,0,0.03), 0 8px 24px rgba(0,0,0,0.05)`): Main page content panels — KPI cards, chart containers, settings panels. 20px radius. The inset top highlight simulates paper edge lift. Light, diffused ambient shadow only.
- **surface-elevated** (`inset 0 1px 0 rgba(255,255,255,0.85), 0 4px 6px rgba(0,0,0,0.04), 0 20px 40px rgba(0,0,0,0.10)`): Modals, dialogs, dropdowns, popovers. 16px radius. Larger spread than card to visually detach from the page.
- **surface-sidebar** (`4px 0 32px rgba(0,0,0,0.06)`): The persistent left navigation panel. Directional — casts rightward to separate the nav from the content area.
- **Dark mode multi-layer**: In dark mode both card and elevated surfaces use a 6-step drop shadow cascade (`0 1px` → `0 3px` → `0 6px` → `0 12px` → `0 24px` → `0 48px`) with `rgba(0,0,0,0.18)` drops plus inset highlight rings. This creates the deep depth that tonal separation alone can't achieve on near-black surfaces.

### Named Rules
**The Flat-at-Rest Rule.** Surfaces are flat at rest. Shadows appear only as structural elevation indicators (card, elevated, sidebar), never as hover effects or decorative accents. Interactive elements communicate hover state through background color changes — `--accent` fill on hover — not shadow additions.

## 5. Components

### Buttons

Seven variants, two functional sizes. The shape vocabulary is consistent across all: `rounded-lg` (8px) by default, with smaller variants capping at `rounded-[min(var(--radius-md),12px)]` to prevent over-rounding at small scales.

- **Primary** (`bg-primary text-primary-foreground`): Burnt Espresso fill, white text. `h-8 px-2.5` default, `h-9 px-2.5` for lg sizing. Hover: `opacity-90` via `[a]:hover`. The only solid-filled button.
- **Outline** (`border-border bg-background hover:bg-muted hover:text-foreground`): Tan Border stroke, Warm Ivory fill, Dark Roast text. Hover fills with Sand Dune. Used for secondary actions alongside a primary.
- **Ghost** (`hover:bg-muted hover:text-foreground`): No stroke, transparent fill. Hover fills with Pale Linen. Used for icon actions and low-emphasis controls inside surfaces.
- **Secondary** (`bg-secondary text-secondary-foreground`): Sand Dune fill. Used for neutral grouped actions (pill selectors, filter chips in button form).
- **Destructive** (`bg-destructive/10 text-destructive hover:bg-destructive/20`): Ember Red at 10% opacity fill, full-opacity text. Never solid red fill — the 10% approach keeps destructive actions visible without alarming.
- **Cancel** (`border-border bg-background hover:border-red-300 hover:bg-red-50/60 hover:text-red-700`): Outline at rest, progressively reddens on hover. Used exclusively as the secondary action in destructive confirmation dialogs.
- **Link** (`text-primary underline-offset-4 hover:underline`): Burnt Espresso text, underline on hover only.

**Focus ring:** `ring-3 ring-ring/50` (Burnt Espresso at 50% opacity, 3px). Consistent across buttons, inputs, badges. The ring color is always `--ring`, which tracks `--primary`.

### Badges

Pill-shaped (`rounded-4xl`, effectively `border-radius: 9999px`). Fixed height 20px, `px-2` (8px) horizontal padding. Text 12px, weight 500.

- **Default** (Burnt Espresso fill, white text): category labels, status indicators, count badges
- **Secondary** (Sand Dune fill, Dark Roast text): inactive or neutral tags
- **Destructive** (Ember Red at 10% fill, full-opacity red text): error states, overdue indicators
- **Outline** (Tan Border stroke, Dark Roast text, transparent fill): secondary categories, reference tags

### Surface Cards / Containers

Two named surface classes beyond the standard `<Card>` shadcn component:

- **`.surface-card`** (20px radius, noise + diagonal gradient, soft ambient shadow, 50%-opacity Tan Border stroke): The workhorse surface. Every major page section — KPI panels, tables, forms, operator lists — lives in a `.surface-card`. Internal padding: `p-6` (24px) standard.
- **`.surface-elevated`** (16px radius, same noise + gradient, larger shadow, no border): Modals, dialogs, and popovers. The shadow spread (20–40px) creates the floating separation. Never used for inline page content.
- **`<Card>`** (shadcn primitive, 12px radius, `ring-1 ring-foreground/10`, no shadow): Lighter-weight containers within surface-cards. Used when nesting is semantically appropriate — not for decoration. Nested inside `.surface-card` only when the content genuinely requires a second layer of grouping.

**The No-Nest Rule.** `.surface-card` inside `.surface-card` is never correct. `.surface-elevated` is always a float; it never appears in document flow. `<Card>` inside `.surface-card` is the only permitted nested pairing, and only when the inner content is a distinct data entity (e.g., a product detail pane inside a list panel).

### Inputs / Fields

- **Default** (`rounded-lg border-input bg-card h-8 px-2.5 text-sm`): Clean Card fill, Tan Border stroke, 8px radius, 32px height. Border transitions to Burnt Espresso on focus (`focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50`).
- **Disabled** (`bg-input/50 opacity-50 cursor-not-allowed`): Halved opacity and cursor change. No pointer events. Used for read-only fields like the public catalog URL.
- **Error** (`aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20`): Driven by the `aria-invalid` attribute. Ember Red border + red focus ring. Error message text appears below the field as `text-xs text-destructive`.
- **Textarea** (no `<Textarea>` component; implemented inline with matching classes): `rounded-lg border-input bg-transparent` + manual focus ring classes matching Input. Rows are explicit.

### Navigation / Sidebar

- **Structure:** Persistent left sidebar (256px expanded, 72px collapsed) with `.surface-sidebar` class. Contains logo, nav items, and operator switcher at the bottom.
- **Nav items:** Sora-adjacent style via `font-display` at `text-sm font-medium`. Default: body color (`--body-color`). Hover: heading color + Pale Linen background fill. Active: Burnt Espresso text + Pale Linen background.
- **PageHeader:** Fixed 56px `h-14` top bar. `.surface-card`-equivalent background (`bg-surface`), Tan Border bottom edge. Contains `h1.font-display.text-lg.font-bold` — the only `<h1>` per view.

### Pill Tabs

`.pill-tabs` / `.pill-tab` / `.pill-tab-active` — a custom filter/toggle pattern used for view-level segmentation (e.g., daily/weekly range selectors, POS mode toggles). Container is Sand Dune fill with `rounded-full` border, 4px internal padding. Active indicator animates via CSS transform (not width animation) at `200ms cubic-bezier(0.4, 0, 0.2, 1)`.

### Custom Toggles (Permission Switches)

Used in operator permission management. Custom `<button role="switch">` — 36px wide, 20px tall, `rounded-full`. Off state: `--muted-foreground` fill. On state: `--primary` fill. Thumb: 16×16px white circle, `translate-x-4` transform on active. No external toggle library. Fully ARIA-attributed.

## 6. Do's and Don'ts

### Do:
- **Do** use `--primary` exclusively on the single primary action per view, focus rings, and active states. One accent per screen surface.
- **Do** apply `.surface-card` to all major page content sections and `.surface-elevated` to all floating layers (modals, dropdowns). These classes carry the full elevation vocabulary — shadow, texture, gradient — don't replicate them manually.
- **Do** use Sora (`font-display`) for all `h1`–`h6` elements and `.text-emphasis` data values. DM Sans for everything else.
- **Do** use `rgba(0,0,0,0)` or opacity modifiers (`/10`, `/30`, `/50`) for subtle fills. Never a new hex value when an existing token at reduced opacity serves the same role.
- **Do** place error messages inline, adjacent to the field that caused them, in `text-xs text-destructive`. Not in a global toast for form validation.
- **Do** use the `cancel` button variant as the secondary action in destructive dialogs — it signals the pairing of "I might delete this / I don't want to" through progressive hover coloring.
- **Do** size touch targets at ≥32px height (the system's base button height). 44px (h-11 / h-10) for primary actions on views that may be used on tablet POS setups.
- **Do** use `.text-label` (10px, uppercase, tracked) for all form field labels and table column headers. It is the system's standard for the label role.

### Don't:
- **Don't** use a blue/purple palette, hero metrics with glowing or gradient cards, or any "generic SaaS dashboard" aesthetic. This system is a POS tool for an Argentine corner shop — it should look like a calibrated instrument, not a startup analytics dashboard.
- **Don't** use dated desktop POS aesthetics: grey forms, cluttered toolbars, Windows-era raised buttons, dense grid layouts with no whitespace.
- **Don't** use `border-left` or `border-right` greater than 1px as a colored stripe on cards, list items, or callouts. If a list item needs visual weight, use a background tint, a leading icon, or a number — not a side stripe.
- **Don't** use gradient text (`background-clip: text` with a gradient background). All text is a single, solid token color.
- **Don't** add glassmorphism (`backdrop-filter: blur`) to any surface in the standard UI. The noise-grain texture already provides materiality; blur adds visual noise without contributing depth.
- **Don't** use `#000000` or `#ffffff` as actual color values in any component. Every surface and every text color in this system is tinted. Check with the warmth floor rule.
- **Don't** nest `.surface-card` inside `.surface-card`, or `.surface-elevated` inside any in-flow surface. Two nested cards are always wrong — consolidate or separate structurally.
- **Don't** use Sora for button labels, form field text, table content, or helper copy. The display/body split is strict: Sora for headings and emphasis, DM Sans for everything operational.
- **Don't** add decorative motion. The `animate-fade-in` utility (`0.25s ease-out`) is for initial content reveal only. The pill-tab indicator is the only choreographed transition in the system, and it's structural (it tracks user selection). No staggered entrances, no hover-lift animations, no scroll-driven sequences.
- **Don't** show a raw Supabase or server error message to the user without a human-readable wrapper. Error strings from `error.message` that leak technical detail should be caught and replaced with plain-language copy before display.
