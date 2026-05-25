# Pricing de variantes — paridad POS/catálogo (Plan B' ejecutado 2026-05-26)

> **Estado:** ✅ shipped 2026-05-26 — scope ajustado al mínimo. El plan original (Opción B con `variant_id` en `price_list_overrides`) se descartó por sobreingeniería para closed beta.
>
> **Próximo:** refactor de `update_product_variants` con audit log (regla 32 de CLAUDE.md). Ver `docs/todo/backlog.md` → "P7h Audit Log — Remaining Phases".

---

## Decisión final

Se eligió la alternativa B' sobre la Opción B documentada originalmente más abajo (ver § Anexo).

**Regla unificada** (cliente: `calculateProductPrice` en `src/lib/price-lists.ts`; server: `compute_effective_price(...)` en Postgres):

1. `variantPrice > 0` → `variantPrice` (precio explícito de variante manda; **la lista NO lo modifica**)
2. `cost > 0 && lista activa` → `cost × (override producto > override marca > multiplicador de lista)`
3. `cost = 0` → `price` (precio crudo)
4. Todo en 0 → `0` (intencional del usuario)

**Por qué B' y no B:**
- Los usuarios de closed beta usan variantes O listas de precios, no ambos con overrides per-variante.
- B' = ~80% menos código, sin migración de datos, sin columna nueva, sin RPCs nuevas.
- La regla "precio explícito gana" es lo que el código ya hacía por accidente (CartPanel:139 era cinta de embalar). Sólo se formalizó.
- B sigue siendo compatible a futuro: si algún día un usuario pide multiplicadores distintos por variante por lista, se agrega `variant_id` a `price_list_overrides` sin romper la regla actual.

---

## Cambios shipped

### Cliente

- `src/lib/price-lists.ts` — `calculateProductPrice` extendido con parámetro opcional `variantPrice`.
- `src/components/price-lists/VariantPriceModal.tsx` — usa la regla central; muestra "Manual" + margen real cuando la variante tiene precio explícito que no coincide con la lista.
- `src/components/price-lists/PriceListsPanel.tsx` — pasa `overrides` al modal.
- `src/components/pos/CartPanel.tsx` — borra el if-especial de variantes; centraliza por `calculateProductPrice`.
- `src/components/pos/ProductPanel.tsx` — `VariantSelectorContent` recibe `activePriceList` + `priceListOverrides`; `matchedVariant` y `minVariantPrice` pasan por la función central.

### Server

- Migration `20260526_01_variant_pricing_helper.sql`:
  - Función `compute_effective_price(p_cost, p_price, p_variant_price, p_list_id, p_list_multiplier, p_product_id, p_brand_id)` — `SECURITY INVOKER`, `STABLE`. Espejo SQL de `calculateProductPrice`.
  - Refactor de `get_catalog_products` — antes ignoraba listas/overrides para productos con variantes (devolvía `pv_def.price` crudo). Ahora aplica la regla.
  - Refactor de `get_catalog_product_with_variants` — `variants[].price` ahora devuelve el **precio efectivo** por variante (era el price crudo). Shape del JSON preservado, sin cambios en `ProductDetailView`.

### Docs

- `CLAUDE.md` § "Price Calculation" — regla actualizada (4 ramas en vez de 3); referencia a `compute_effective_price` como espejo SQL.
- `CLAUDE.md` regla crítica #11 — incluye que para variantes `variant.price > 0` siempre gana.

### Verificación post-deploy

Caso real (negocio `seba`, producto Iphone 16, lista multiplicador 1.35):

| Variante | cost | price | Antes (`/price-lists`) | Después | POS | Catálogo grid | Catálogo detalle |
|----------|------|-------|------------------------|---------|-----|---------------|------------------|
| Pro      | 700  | 1200  | $945 ❌                | $1.200 ✓| $1.200 | $1.200 (default) | $1.200 |
| Pro Max  | 850  | 1500  | $1.147,50 ❌           | $1.500 ✓| $1.500 | —                | $1.500 |

Paridad establecida en todas las superficies.

---

## Fuera de scope (no se hizo, no se va a hacer salvo pedido explícito)

- Columna `variant_id` en `price_list_overrides`.
- Migración one-shot de datos.
- `VariantOverrideModal` nuevo.
- Detección de conflictos con variantes en `NewPriceListModal` / `EditPriceListModal` (innecesario bajo B': nunca hay conflicto, el precio de la variante siempre gana).
- Warning amber por variante en `EditProductModal` (idem).
- RPC nueva `upsert_variant_price_override`.

---

## Anexo — Plan original descartado (Opción B con `variant_id`)

Se mantiene como referencia por si en el futuro algún usuario solicita la flexibilidad de multiplicadores distintos por variante por lista. El plan completo original (§ 0 a § 12) se encuentra en el git history de este archivo: `git show HEAD~1 -- docs/todo/variant-price-list-overrides.md`.

Los puntos clave del plan B descartado:
- Agregar columna `variant_id` a `price_list_overrides` (con CHECK exclusivo + ON DELETE CASCADE).
- Migración one-shot para cristalizar overrides implícitos.
- Modal dedicado para editar overrides por variante.
- Detección de conflictos con variantes en modales de listas.

Si se reactiva: la regla actual de B' es **compatible** (sólo cambia el orden de precedencia para que override-por-variante gane sobre precio explícito; o se mantiene la prioridad actual y los overrides per-variante sólo afectan a variantes con `price = 0`).
