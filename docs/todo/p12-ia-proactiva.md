# P12 — IA proactiva opt-in (plan refinado)

> Estado: **diseño cerrado, no implementado.** Documento de alineación previo a codear.
> Última revisión conceptual con el usuario: 2026-06-02.

## Context

P12 agrega una capa de **IA proactiva** que analiza el negocio y emite **sugerencias** (no órdenes) accionables: pricing, stock, clientes, proveedores, gastos, pedidos online. El objetivo es que se sienta **compañera, no jefe**, y que sea **realmente útil** — no un addon que el dueño nunca abre.

No hay blocker técnico: la fundación analítica ya existe (`daily_snapshots`, RPCs de stats, Edge Function + cron + Vault del patrón `refresh-daily-snapshots`). El "blocker" real es de **valor**: sin negocios con historial real, los insights salen vacíos. El esqueleto puede construirse ya; el primer insight valioso coincide con tener 2-3 negocios con ~30 días de actividad.

## Principios rectores (cerrados con el usuario)

1. **Sugerencia, nunca orden.** Estructura condicional + evidencia: *"Si ajustás el margen de X, podrías… porque A, B, C"*, nunca *"Debés cambiar X"*. Español latino neutro (tú/podrías), **sin voseo**.
2. **`rationale` obligatorio.** Ningún insight existe sin su "porque X, Y, Z". Si el modelo no puede justificar con números reales, no emite. Garantía estructural del tono, no cosmética.
3. **UI anclada y contextual, no una tab.** El insight se planta donde la entidad ya vive (fila de producto, cierre de caja, dashboard), no encerrado en una sección "IA" que el dueño nunca visita. Sutil, sin interrumpir el flujo.
4. **Dos niveles, ambos buenos.** Detección barata + profundización dirigida. Si cualquiera de los dos es flojo, la feature es un estorbo.
5. **Modelo abstraído, key managed.** El proveedor LLM vive detrás de una interfaz fina; el modelo es config, no arquitectura. **La key la manejamos nosotros** (sin BYOK — protege calidad y monetización). La IA es feature de plan pago (Pro).

## Hallazgo clave: a la IA no le falta data, le falta retrieval

Casi todo el historial necesario **ya existe** en las tablas transaccionales. No hay que agregar captura para los insights temporales (ej. elasticidad precio↔demanda).

| Señal | Origen (ya existe) |
|---|---|
| Precio de venta histórico por producto | `sale_items.unit_price` + `sales.created_at` |
| Demanda histórica (unidades) | `sale_items.quantity` + `sales.created_at` |
| Costo histórico | `expense_items.unit_cost` + `created_at` (costo real de cada compra) |
| Stock en el tiempo | `inventory_movements` (sale/purchase/adjustment/return + fecha) |
| Clientes (RFM, deuda) | `sales.customer_id` + fecha; `customers.credit_balance` |
| Proveedores | expenses → supplier + `expense_items` (frecuencia/monto/costo) |
| Canal POS vs online | `sales.source` + `catalog_orders` (`accepted_at/completed_at/rejected_at` → conversión y rechazo) |

**Matiz de costo:** `sale_items` **no** guarda el costo al instante de cada venta — solo existe `products.cost` actual + `expense_items.unit_cost` histórico de compras. Para tendencia alcanza; el margen calculado es *aproximado* y el copy debe decirlo cuando corresponda. (Si más adelante se quiere margen exacto, snapshotear `cost` dentro de `sale_items` desde ese momento, forward-only.)

## Arquitectura: assembler de dos niveles

No se puede meter 18 meses de historial de todos los productos en un prompt nocturno (explota en tokens, el modelo se ahoga). Por eso:

### Nivel 1 — Detección (nocturno, barato, sobre agregados)
- Corre para cada negocio con IA activada, después del cron de snapshots.
- Input: `daily_snapshots` (serie 30d) + `get_period_comparison` + resúmenes livianos por dominio (mix de pago, top productos/categorías, dead stock, heatmap, margen agregado).
- Tarea: detectar **candidatos** — anomalías, outliers, derivas (ej. *"producto X: unidades cayendo vs trimestre anterior"*).
- Modelo: el más barato con buen **recall** (Gemini Flash free-tier o Haiku). Prompt chico.

### Nivel 2 — Profundización (dirigido, solo sobre lo que saltó)
- Solo para las entidades marcadas en Nivel 1.
- Input: historial **profundo** de esa entidad vía RPCs on-demand (timeline precio + costo + unidades del producto X; RFM del cliente; serie del proveedor; etc.).
- Tarea: narrar la correlación con números reales y emitir el insight con `rationale`.
- Modelo: prioriza **calidad de razonamiento**; baja frecuencia, se puede gastar más sin que duela.

Ejemplo de punta a punta: N1 detecta *"X, unidades −13%"* barato → N2 trae el timeline de X → emite *"Cuando X valía \$A en jun-2025 vendías 13% más; lo subiste a \$B en enero sin que el costo se moviera. Si revisás el precio, podrías recuperar volumen."*

## Capa de datos — qué construir

Lo único genuinamente faltante son **RPCs de retrieval**, no datos:

- **`get_margin_analysis(business_id, from, to, limit, offset)`** ✅ (2026-06-02, mig. `20260602_05`) — devuelve `{ data[], total, totals }`. Por producto: `units_sold`, `units_without_cost`, `revenue`, `cost_total`, `gross_profit`, `margin_pct`, categoría/marca; ordenado por **margen ascendente** (peor margen primero = más accionable). `totals` agrega el negocio entero + `products_without_cost`. Costo = `COALESCE(variant.cost, product.cost)` (aprox, costo actual). **Nota:** el margen absoluto por producto ya se computaba en `get_top_products_detail` (`gross_profit`); esto agrega `margin_pct`, ordenamiento por margen y el manejo de `cost=0` (`units_without_cost` → la IA distingue "súper rentable" de "costo sin cargar", y ese vacío es en sí un insight). Verificado contra cálculo manual en `tienda de seba` (revenue/cost/gross/products/sin-costo cierran exacto).
- **RPCs de detección (Nivel 1)** — comparación período-contra-período al grano de entidad (ventana actual vs ventana previa de igual largo, estilo `get_period_comparison`). Todo exacto en SQL; pre-flag por umbral parametrizable. ✅ **3 hechas** (2026-06-02, mig. `20260602_07`, schema.sql en sync):
  - **`get_product_demand_shifts`** — el gancho de elasticidad: por producto, unidades/ingresos/**precio promedio** actual vs previo + deltas + `price_shift`. Pre-flag: `base_units ≥ p_min_units_base` (def 5) y `|Δ unidades| ≥ p_min_delta_pct` (def 20) **o** mismo umbral en precio. `direction ∈ up|down|new|stopped|steady`. Verificado contra control manual (units 79/21, revenue 39500/10300 exactos).
  - **`get_payment_mix_shift`** — share de cada método actual vs previo (`share_delta_pp`), misma fuente que `get_sales_by_payment_detail` (`payments`+`sales` completed). Pre-flag `|Δ pp| ≥ p_min_delta_pp` (def 5). Verificado: detecta efectivo 88.9%→76.3% (−12.6pp) con suba de digitales.
  - **`get_channel_signals`** — funnel de pedidos online (conversión/rechazo, GMV) + share canal catálogo vs POS (`sales.source`), actual vs previo + `flags`. Verificado contra control (5 pedidos, conv 20%).
  - Reusan tal cual (NO se rehacen): `get_margin_analysis`, `get_dead_stock`, `get_overstock` cubren margen/stock muerto/sobrestock.
  - **Diferidos a backlog** (incorporar cuando estos rueden bien): señales de cliente (RFM/deuda) y cost creep por proveedor.
  - **Seguridad:** guard dual-use — `if auth.uid() is not null then assert_tenant()`; el único caller con `auth.uid()` nulo capaz de ejecutar es el cron `service_role` (anon revocado), mismo modelo que `refresh_all_daily_snapshots`. Probado: caller authenticated de otro negocio → rechazado; dueño sobre su negocio → OK; service_role → OK.
- **RPCs de historial profundo (Nivel 2)** — slices temporales por entidad:
  - **producto: `get_product_history(business_id, product_id, months=12)`** ✅ (2026-06-02, mig. `20260602_08`, schema.sql en sync) — serie **mensual** continua (incluye meses en cero): `units_sold`, `revenue`, `avg_price` (venta, desde `sale_items`), `purchase_qty` + `avg_unit_cost` (compra, desde `expense_items`+`expenses.date`), `est_margin_pct` (sólo cuando hay precio y costo de compra ese mes). Agrega variantes al nivel del producto. Header con producto + costo/precio/stock actuales; `summary` con totales, meses con venta/compra, primer/último mes con venta y último costo de compra. Verificado contra control (mayo: 87 uds/$43.500/avg 500, compra 16@206.81, margen 58.64% — exacto). Mismo guard dual-use. **Matiz de costo:** el costo histórico exacto es el de las compras; en meses sin compra `avg_unit_cost` es null (no se inventa) → el copy debe tratar el margen como aproximado.
  - cliente: RFM desde `sales` + `credit_balance` — **diferido a backlog** (junto al detector N1 de cliente).
  - proveedor: serie de compras desde `expenses`/`expense_items` — **diferido a backlog** (junto al detector N1 de proveedor).
  - canal: el funnel ya lo entrega `get_channel_signals` (N1); de necesitarse profundización por pedido, se evalúa en el assembler.

Todas las RPCs nuevas: `SECURITY DEFINER` + `set search_path = public, extensions` + `assert_tenant(p_business_id)` como primera sentencia + `REVOKE ... FROM PUBLIC, anon` / `GRANT ... TO authenticated` (regla 34). El cron corre como `service_role`.

## Tabla `ai_insights`

✅ **Creada** (2026-06-02, mig. `20260602_06`, schema.sql en sync).

```
id, business_id, created_at, updated_at,
status              -- new | seen | dismissed | acted     (default 'new', CHECK)
severity            -- info | opportunity | anomaly        (CHECK)
target_entity_type  -- product | payment | customer | supplier | stock | channel | global  (CHECK)
target_entity_id    -- TEXT nullable — ancla polimórfica (uuid de producto/cliente, código 'cash', o NULL para global). Sin FK.
surface             -- inventory_row | inventory | stats | dashboard | cash_close | pos | customers | suppliers | expenses | orders | global  (CHECK; dónde se planta)
title, body         -- copy condicional, tú neutro
rationale jsonb      -- "porque X, Y, Z" con números — NOT NULL (sin esto no se inserta)
source_model        -- proveedor/modelo que lo generó
```

- **RLS** `business isolation` vía `get_business_id()` (mismo patrón que `audit_log`). **Sin grants a anon** (revocados explícito por default-privileges del esquema; defensa en profundidad sobre RLS — regla 34). El cron escribe como `service_role` (saltea RLS); el dueño lee y actualiza `status` como `authenticated`.
- Índices: `(business_id, status, created_at desc)` feed, `(business_id, surface, status)` render inline, `(business_id, target_entity_type, target_entity_id)` anclaje + anti-repetición por entidad.
- Trigger `set_updated_at` en UPDATE (reusa la función existente).
- **Opt-in flag** `ai_insights_enabled` (boolean) en `businesses.settings` — documentado en el COMMENT de la columna; ausente/false = apagado. Se escribe spread-merge (regla 22) desde la UI de settings (paso 5). No requirió cambio de esquema.
- **Anti-repetición:** el assembler recibe los últimos N insights + su `status` para no repetir lo descartado cada noche (clave para no ser molesto = compañera).
- Verificado en vivo: insert como cron (service_role), read+update de `status` por el dueño (RLS ok), y aislamiento cross-tenant (`Q tal lokis` no ve ni puede actualizar insights de `tienda de seba`); todo bajo rollback, 0 filas persistidas.

## UI — anclada, contextual, sutil

- Render inline según `surface`/`target`: margen → fila/detalle de producto en inventario; dead stock → inventario; mix de pago → `/stats` o cierre de caja; anomalía → nudge ambiente en dashboard/POS.
- Indicador ambiente discreto para los `global` (no una tab).
- **No interrumpe** el flujo: aparece con animación suave + sonido menor que una notificación. **Sonido y animación = última etapa del desarrollo.**

## Costo y modelo (closed beta)

- A escala beta (puñado de negocios × 1 corrida/noche × prompt chico), el costo es **centavos/mes** en cualquier modelo. Optimizar modelo ahora es prematuro; lo que mantiene barato es la **arquitectura de dos niveles**, no el proveedor.
- Interfaz `generateInsight(...)` con proveedor configurable. Nivel 1: el más barato con buen recall. Nivel 2: el de mejor razonamiento. **Sin BYOK.**

## Secuencia sugerida

1. ~~**Confirmar margen** — verificar el matiz de costo y crear `get_margin_analysis`.~~ ✅ **Hecho** (2026-06-02, mig. `20260602_05`, schema.sql en sync).
2. ~~**Tabla `ai_insights`** + opt-in en settings.~~ ✅ **Hecho** (2026-06-02, mig. `20260602_06`, schema.sql en sync). Falta cablear el toggle `ai_insights_enabled` en la UI de settings (parte del paso 5).
3. **RPCs de retrieval** — detección (N1) ✅ **3 hechas** (`get_product_demand_shifts`, `get_payment_mix_shift`, `get_channel_signals`; mig. `20260602_07`) · historial profundo (N2) ✅ producto hecho (`get_product_history`; mig. `20260602_08`); cliente/proveedor diferidos a backlog.
4. **Assembler + Edge Function + cron** — dos niveles, proveedor abstraído, anti-repetición.
5. **Superficie anclada** — render inline por `surface`/`target` + nudge ambiente.
6. **Polish** — sonido + animación suave.

## Pendiente de decidir al implementar

- Modelo concreto por nivel para beta (Gemini Flash free-tier vs Haiku) — validar límites/calidad reales.
- Umbrales de detección del Nivel 1 (qué cuenta como anomalía/deriva).
- Frecuencia: nocturno fijo vs disparado por eventos (ej. cambio de precio).
- ¿Margen exacto forward-only (snapshot de `cost` en `sale_items`) o seguir con aproximado?
