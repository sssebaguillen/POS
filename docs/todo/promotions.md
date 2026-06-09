# Promociones y Ofertas — Plan de implementación

> Acordado 2026-06-09. Feature grande: módulo de promos con lugar destacado en el catálogo online.
> Estado: **en implementación** (F1 en curso).

---

## Decisiones cerradas

### 1. Tracking por línea desde el día 1 (bases sólidas)

El precio que paga el cliente queda en `unit_price`/`total` como siempre (línea **neta**), pero cada línea con promo registra **dos columnas informativas**: `promotion_id` (qué promo aplicó) y `promo_discount` (cuánto se ahorró el cliente en esa línea, cantidad-aware). Esto:

- **No toca los invariantes R2/R3** (`subtotal = Σ ítems`, `total = subtotal − discount`) — las columnas son informativas, no participan del cálculo.
- Deja lista la data para el reporte de impacto futuro ("vendiste $X con la promo Y, resignaste $Z") y para detectores de P12 — solo falta la UI, no el dato.
- `sales.discount` sigue siendo exclusivamente el descuento de carrito (v1 existente). El matiz override-de-precio-no-es-descuento se mantiene.

### 2. Pipeline de precedencia (promo × lista × redondeo × override)

```
1. Precio efectivo de hoy      ← SIN CAMBIOS: resolveDisplayPrice (TS) ↔ compute_effective_price (SQL)
                                  (precio base/variante, o lista: costo×mult + redondeo por lista)
2. Promo unitaria              ← NUEVO: % off o precio de oferta sobre el resultado de (1)
3. Promo por cantidad          ← NUEVO: a nivel línea (2x1, 3x2, 2da al X%) sobre el precio de (2)*
4. Override manual (POS)       ← gana sobre TODO: priceIsManual excluye la línea de listas Y promos
5. Descuento de carrito (v1)   ← sobre el subtotal ya neto de promos
```

\* Una línea matchea **una sola promo** (sin stacking): la unitaria y la de cantidad no se combinan; ver regla de resolución.

- **Resolución cuando matchean varias promos:** la más específica gana (producto > categoría > marca). A igual especificidad, **la más reciente** (`created_at DESC`). Nota: se evaluó "la mejor para el cliente" pero es indefinida cuando compite una promo unitaria contra una de cantidad (dependen de la cantidad); "la más reciente" es determinística y trivial de espejar SQL↔TS. La UI compensa con el **aviso de solapamiento** al crear (alert ámbar con productos ya cubiertos por otra promo, patrón `NewPriceListModal`). Informa, no bloquea.
- **Redondeo:** precio de oferta fijo es "lindo" por construcción. El % redondea a 2 decimales en v1; si molesta, se agrega redondeo a la promo después (campo análogo a `rounding_step`).
- `compute_effective_price` / `calculateProductPrice` **no se tocan** — la promo es una capa separada que se compone después (menos riesgo de regresión; el espejo nuevo es chico y aislado).

### 3. Promos por cantidad — modelo único

2x1, 3x2 y "2da unidad al X%" son la misma fórmula: *"por cada grupo de N unidades, las últimas K pagan el P% del precio"*.

| Promo | group_size (N) | affected_units (K) | pay_percent (P) |
|---|---|---|---|
| 2x1 | 2 | 1 | 0 |
| 3x2 | 3 | 1 | 0 |
| 2da unidad al 50% | 2 | 1 | 50 |

`descuento de línea = floor(qty / N) × K × unit_price × (1 − P/100)`

- Acumulan **dentro de la misma línea** (mismo producto/variante). 2x1 *cruzado* ("2 remeras cualesquiera") = v2 (lógica combinatoria: cuál va gratis).
- En la UI el usuario nunca ve N/K/P — ve tipos en lenguaje natural con preview en vivo ("Lleva 3, paga 2 — cada 3 unidades, 1 va gratis").

### 4. Tipos de promo (v1)

```
( ) Porcentaje de descuento   → kind='percent', percent           (cualquier scope)
( ) Precio de oferta          → kind='offer_price', offer_price   (solo producto SIN variantes)
( ) Lleva X, paga Y           → kind='quantity', N/K/P=0          (scope producto)
( ) 2da unidad al X%          → kind='quantity', N=2/K=1/P        (scope producto)
```

Precio de oferta sobre variantes: restringido en v1 (un precio fijo sobre N variantes con precios distintos es ambiguo; usar %). Si hace falta, el modelo acomoda `variant_id` en el scope sin migración conceptual.

### 5. Ruta y permisos

- Ruta `/promotions` (rutas en inglés). Gate en `proxy.ts`: `inventory_read` (misma familia que `/price-lists`).
- RPCs de escritura: guard `inventory_write` vía `normalize_permissions` + `assert_tenant` + `log_audit_event` + REVOKE PUBLIC/anon + GRANT authenticated (reglas 32/34).

### 6. Audit log + snapshot diario (para /activity y P12)

- **Audit:** `entity_type = 'promotion'`, acciones `create_promotion` / `update_promotion` / `archive_promotion` con old/new data. `/activity`: sumar el entity type al filtro (`ActivityEntityFilter`) + detalle en `ActivityDetail`.
- **Snapshot:** columnas nuevas en `daily_snapshots`: `promo_discounts_total` (Σ `sale_items.promo_discount` del día) y `promo_sales_count` (ventas con ≥1 línea con `promotion_id`). Se agregan a `upsert_daily_snapshot`; histórico queda en 0 (correcto: no había promos). Así los detectores de P12 leen impacto de promos sin query nueva.

---

## Modelo de datos

```sql
promotions (
  id uuid PK, business_id uuid NOT NULL,
  name text NOT NULL,
  kind text CHECK (kind IN ('percent','offer_price','quantity')),
  percent numeric,            -- kind=percent
  offer_price numeric,        -- kind=offer_price
  group_size int, affected_units int, pay_percent numeric,  -- kind=quantity
  product_id uuid NULL, category_id uuid NULL, brand_id uuid NULL,  -- exactamente uno (CHECK)
  starts_at timestamptz NULL, ends_at timestamptz NULL,  -- NULL = sin límite
  is_active boolean DEFAULT true,
  show_in_catalog boolean DEFAULT true,   -- aparece en la sección Ofertas del catálogo
  archived_at timestamptz NULL,
  created_at, updated_at
)
-- "vigente" = is_active AND archived_at IS NULL AND now() ∈ [starts_at, ends_at]
-- Sin CASCADE (decisión del proyecto): promo usada en ventas se ARCHIVA, no se borra.
```

Columnas informativas (default 0/NULL, cero impacto en lo existente):
- `sale_items.promotion_id uuid NULL` + `sale_items.promo_discount numeric NOT NULL DEFAULT 0`
- `catalog_order_items.promotion_id uuid NULL` + `catalog_order_items.promo_discount numeric NOT NULL DEFAULT 0`
- `daily_snapshots.promo_discounts_total numeric NOT NULL DEFAULT 0` + `daily_snapshots.promo_sales_count int NOT NULL DEFAULT 0`

"Ofertas de la semana" con 10 productos = 10 filas (una promo = un target), agrupadas visualmente en la UI.

## Compatibilidad verificada con el código actual

- `create_catalog_order` re-precia server-side y guarda `unit_price`/`line_total` en `catalog_order_items` → aplicando la promo ahí, la conversión a venta (`update_catalog_order_status` → `create_sale_transaction`) arrastra los valores; solo hay que sumar el passthrough de las 2 columnas.
- El cart store ya tiene el patrón: `priceIsManual` excluye del recálculo; `resolveCartItemPrice` recalcula al cambiar lista — la promo es una capa más del mismo flujo.
- Invariantes R2/R3 de `docs/tests/06-reconciliacion.sql` intactos (líneas netas).

---

## Fases

| Fase | Contenido | Estado |
|---|---|---|
| **F1 — DB** | Tabla `promotions` + RLS, columnas en `sale_items`/`catalog_order_items`/`daily_snapshots`, RPCs CRUD con guard+audit+REVOKE, `find_applicable_promotion` + fórmula de cantidad SQL, passthrough en `create_sale_transaction`, `upsert_daily_snapshot` con agregados promo. schema.sql en sync. | ✅ 2026-06-10 (mig `20260609_05_promotions_foundation`, aplicada al remoto; helpers y resolución verificados en vivo: especificidad, cross-tenant, vigencia; advisors limpios) |
| **F2 — Motor TS + POS** | `lib/promotions.ts` (espejo TS), cart store + `CartPanel` (tachado, badge, descuento de línea), payload de checkout, etiqueta en `ReceiptTemplate`. | ✅ 2026-06-10 (código completo, tsc/lint limpios; smoke UI pendiente en F5). Nota: el cart store NO se tocó — la promo se resuelve en `adjustedItems` de `CartPanel` (mismo patrón que las listas), cards de `ProductPanel` muestran precio promo + badge, ticket (`ReceiptTemplate` + escpos) imprime "Promo {label} (-$X)". |
| **F3 — UI `/promotions`** | Página con chips Activas/Programadas/Vencidas, New/Edit modal (selector de tipo + preview + aviso de solapamiento), sidebar, entity type en `/activity`. | pendiente |
| **F4 — Catálogo** | RPCs devuelven `original_price` + label de promo (+ `ends_at` para countdown "termina en 2 días"), badge + tachado en `ProductCard`, sección "Ofertas" + chip, `create_catalog_order` aplica promo, passthrough en conversión. | pendiente |
| **F5 — Cierre** | Invariante nuevo en reconciliación (`total línea = qty×unit − promo_discount` cuando hay promo... ver nota*), smoke E2E, docs (CLAUDE.md, db.md, conventions.md, backlog). | pendiente |
| **Después** | Quick win: segmentación POS vs catálogo en stats (`sales.source` ya existe). Tarjeta de impacto de promos en `/stats`. Engagement del catálogo (vistas/clics — requiere storage propio para el dueño, PostHog es analytics nuestro; diferido hasta tener tráfico). Detector P12 "la promo X no mueve ventas / duplicó rotación". | pendiente |

\* Nota invariante: para promos unitarias, `promo_discount = qty × (precio_sin_promo − unit_price)` y el total de línea sigue siendo `qty × unit_price`. Para promos de cantidad, `unit_price` queda íntegro y `total = qty × unit_price − promo_discount`. El invariante exacto se formaliza en F5.

## Espejos SQL ↔ TS a mantener en sync (se suma a la regla 11)

| SQL | TS |
|---|---|
| `find_applicable_promotion(...)` | `findApplicablePromo(...)` en `lib/promotions.ts` |
| fórmula de cantidad (en SQL helper) | `computeQuantityDiscount(...)` |
| aplicación unitaria (percent/offer_price) | `applyUnitPromo(...)` |
