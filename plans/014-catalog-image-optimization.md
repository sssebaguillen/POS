# Plan 014: Decidir y unificar la optimización de imágenes (`unoptimized` en 11 componentes)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat aa3b439..HEAD -- next.config.ts src/components/catalog src/components/pos/ProductPanel.tsx src/components/orders/OrderDetailPanel.tsx src/components/inventory/ProductCard.tsx src/components/inventory/ProductListRow.tsx`
> If any in-scope file changed since this plan was written, re-run the grep
> in "Current state" and reconcile the file list before proceeding.

## Status

- **Priority**: P3
- **Effort**: S
- **Risk**: LOW (variante B) / MED (variante A — depende de cuota de Vercel)
- **Depends on**: none
- **Category**: perf
- **Planned at**: commit `aa3b439`, 2026-06-12

## Why this matters

11 componentes pasan `unoptimized` a `next/image`, así que **el catálogo público — anónimo, mobile-first, la cara de conversión del negocio — sirve las imágenes originales de Supabase Storage** sin srcset, sin AVIF/WebP, sin resize: una foto de producto de 2 MB baja entera a un teléfono 3G. A la vez, `next.config.ts` tiene `images.remotePatterns` configurado para el host de Supabase (la optimización se preparó en algún momento) y **no existe ningún comentario que documente la decisión** de apagarla. La razón plausible es costo: la Image Optimization de Vercel tiene cuota (limitada en plan Hobby) y el catálogo es tráfico anónimo. Este plan fuerza la decisión explícita y deja UNA sola fuente de verdad, en cualquiera de las dos direcciones.

## Current state

Archivos con `unoptimized` (verificado con `grep -rln "unoptimized" src --include="*.tsx"`):

```
src/components/catalog/CatalogNavbar.tsx
src/components/catalog/ProductDetailView.tsx
src/components/catalog/CatalogSearch.tsx
src/components/catalog/CatalogFooter.tsx
src/components/catalog/CartPanel.tsx
src/components/catalog/OffersCarousel.tsx
src/components/catalog/ProductCard.tsx
src/components/pos/ProductPanel.tsx
src/components/orders/OrderDetailPanel.tsx
src/components/inventory/ProductCard.tsx
src/components/inventory/ProductListRow.tsx
```

Uso típico (`src/components/catalog/ProductCard.tsx`, sin comentario explicativo):

```tsx
<Image
  src={imageUrl}
  alt={name}
  fill
  unoptimized
  className={...}
/>
```

`next.config.ts:30-34` — la optimización remota YA está permitida para Supabase:

```ts
images: {
  remotePatterns: supabaseHostname
    ? [{ protocol: 'https', hostname: supabaseHostname }]
    : [],
},
```

Contexto de negocio: Supabase está en plan FREE (decisión registrada en CLAUDE.md); el plan de Vercel **no consta en el repo** — por eso el gate del Step 0. Los buckets de imágenes de producto son públicos y se sirven por CDN de Supabase.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Inventario | `grep -rln "unoptimized" src --include="*.tsx"` | la lista de arriba (antes) / vacío (después) |
| Build | `npm run build` | exit 0 |
| Lint | `npm run lint` | exit 0 |
| Dev server (smoke) | `npm run dev` | catálogo renderiza imágenes |

## Scope

**In scope**:
- Los 11 archivos listados (solo el prop `unoptimized` y, en variante A, props `sizes` si fueran imprescindibles)
- `next.config.ts` (solo en variante B, o para confirmar `remotePatterns` en A)

**Out of scope** (NO tocar):
- Cualquier otra prop o markup de los componentes — esto NO es un rediseño; el catálogo pasó rondas de critique recientes.
- El pipeline de subida de imágenes / Storage / buckets.
- `@vercel/analytics`, CSP del proxy (la directiva `img-src` ya permite `https:`).

## Git workflow

- Commit sugerido (A): `perf(images): habilitar Next Image optimization (fuera unoptimized de 11 componentes)`.
- Commit sugerido (B): `chore(images): unoptimized global documentado en next.config (decisión de cuota Vercel)`.
- Do NOT push unless instructed.

## Steps

### Step 0: GATE — decisión del operador

Preguntarle al operador (no adivinar):

> El proyecto está en Vercel. ¿El plan es Hobby o Pro, y prefieren (A) activar la optimización de imágenes de Vercel para el catálogo público — mejor LCP móvil, consume cuota de Image Optimization — o (B) dejar las imágenes sin optimizar pero declararlo global y documentado en `next.config.ts`?

- Respuesta A → Step 1A.
- Respuesta B → Step 1B.
- Sin respuesta → STOP, status BLOCKED ("esperando decisión de cuota Vercel").

### Step 1A (variante A): habilitar optimización

1. Quitar el prop `unoptimized` de los 11 archivos (cada uno puede tener más de una instancia — buscar TODAS dentro de cada archivo).
2. Confirmar que `next.config.ts` conserva el bloque `remotePatterns` (sin cambios).
3. NO agregar `sizes` en esta pasada salvo que el build lo exija — minimizar el diff.

**Verify**: `grep -rn "unoptimized" src/` → 0 matches; `npm run build` → exit 0.

### Step 1B (variante B): apagado global y documentado

1. En `next.config.ts`, dentro de `images`, agregar:
   ```ts
   images: {
     // Decisión deliberada (2026-06-12): sin Image Optimization de Vercel —
     // el catálogo es tráfico anónimo y la cuota del plan actual no lo banca.
     // Si se sube de plan, borrar esta línea y los srcset vuelven solos.
     unoptimized: true,
     remotePatterns: ...,  // se conserva por si se revierte
   },
   ```
2. Quitar el prop `unoptimized` de los 11 archivos (el flag global lo reemplaza — una sola fuente de verdad).

**Verify**: `grep -rn "unoptimized" src/` → 0 matches; `grep -c "unoptimized: true" next.config.ts` → 1; `npm run build` → exit 0.

### Step 2: Smoke visual

Con `npm run dev`, abrir `/catalogo/<slug del negocio dev 'tienda de seba'>` en el browser: la grilla, el detalle de producto, el carrusel de ofertas y el typeahead del navbar muestran imágenes correctamente (sin 400 del optimizador ni imágenes rotas). En variante A, verificar en DevTools → Network que las imágenes salen de `/_next/image?url=...`.

**Verify**: cero imágenes rotas en las 3 páginas del catálogo + POS (`/pos`, panel de productos).

## Test plan

No hay test unitario útil — la verificación es el smoke del Step 2 más el build. En variante A, recomendar al operador vigilar el uso de Image Optimization en el dashboard de Vercel la primera semana (las transformaciones se generan on-demand y cachean).

## Done criteria

- [ ] Decisión del operador registrada (en el commit message y en la fila del README)
- [ ] `grep -rn "unoptimized" src/` → 0 matches (en ambas variantes)
- [ ] Variante B: `next.config.ts` con `unoptimized: true` + comentario de decisión
- [ ] `npm run build` y `npm run lint` exit 0
- [ ] Smoke del catálogo dev sin imágenes rotas
- [ ] Fila actualizada en `plans/README.md`

## STOP conditions

- El operador no decide (Step 0) — BLOCKED, no elegir por él: la variante A tiene impacto de facturación.
- En variante A el smoke muestra 400/402 del endpoint `/_next/image` (cuota o restricción del plan) — revertir a variante B y reportar.
- Aparecen MÁS archivos con `unoptimized` que los 11 listados (deriva) — actualizar el inventario en este plan y seguir, salvo que el nuevo uso tenga un comentario que documente otra razón.

## Maintenance notes

- Tras este plan, `unoptimized` por-componente queda prohibido de facto: la decisión vive en `next.config.ts` (B) o no existe (A). Reviewers deben rechazar reintroducciones sueltas.
- Si se elige B hoy, reevaluar al pasar a Vercel Pro o cuando el catálogo tenga tráfico real — el costo de revertir es borrar una línea.
- Si se elige A, el siguiente refinamiento natural (fuera de scope hoy) es darle `sizes` correctos a la grilla del catálogo para que el srcset elija variantes chicas en mobile.
