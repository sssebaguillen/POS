# Pulsar POS — Backlog & Known Issues

> Trabajo pendiente, bugs conocidos, errores de CONTEXT.md y deuda técnica post-beta.

---

## DB Audit — Pendiente

| ID | Issue |
|----|-------|
| ~~M-3~~ ✅ (2026-05-28) | `inventory_movements.created_by` era columna muerta (sin FK, nunca escrita ni leída, 0/68 filas). La atribución la maneja `created_by_operator` (FK → operators, NULL = dueño). Resuelto en `drop_inventory_movements_dead_created_by`: `DROP COLUMN created_by` + quitada de `schema.sql`. |

---

## Bugs conocidos

- **✅ (2026-05-31) Stock inmovilizado (ex "Stock muerto") — lente 1 rehecho.** La pantalla original mezclaba **3 ejes** (recencia / velocidad / cobertura) bajo un control, y nada cuadraba (la perilla de días solo movía `dead`; `slow` medía cobertura no velocidad; el titular "capital inmovilizado" inflaba con sobrestock que en realidad rota). **Decisión (supera el "fix de 3 buckets" que se había acordado): separar los ejes en lentes.** Lente 1 = **Stock inmovilizado** (eje recencia puro): un solo listado `never_sold` + `dead` (90d fijo, perilla no expuesta), titular de capital honesto (solo plata realmente trabada). Chips `Todos / Sin movimiento / Nunca vendido`. Se quitaron columnas Velocidad/Cobertura y el cálculo de cobertura de `get_dead_stock`. Renombrada la pantalla a "Stock inmovilizado" (coherente con el KPI). Cambios: `get_dead_stock` (mig `20260530_02`, recencia-only), `DeadStockBucket = never_sold|dead`, `DeadStockView`, `stats/dead-stock/page.tsx`, widget `StatsView`.

- **✅ (2026-05-31) Lente 2 "Sobrestock" + página unificada "Salud de inventario".** Se separó el eje cobertura como lente propia. Las dos lentes ahora viven en una sola página `/stats/inventory-health` (renombrada desde `/stats/dead-stock`) con pill-tabs *Stock inmovilizado* | *Sobrestock*; el server precarga ambas en `Promise.all` y el cambio de lente es swap in-memory instantáneo. **Sobrestock** = productos que rotan con cobertura ≥6 meses (vel. = `units_90d ÷ min(90,age)/30`, **bug de la v1 arreglado** — ya no divide por 3 fijo; exige ≥30 días de historia). KPI "capital comprado de más" = `frozen_capital × (cobertura−6)/cobertura` (excedente, variant-safe), no el stock entero. RPC nueva `get_overstock` (mig `20260531_01`). Componentes: `InventoryHealthView` (padre) + `DeadStockLens` + `OverstockLens` (reemplazan `DeadStockView`). Diseño de lentes en `~/.claude/plans/radiant-painting-hamming.md`.

- **✅ (resuelto vía ledger Batch 2a, 2026-06-01) Borrar una venta dejaba pagos huérfanos** (hallazgo 2026-05-28, reconciliación R8b) — el problema original (`payments.sale_id = NULL` al borrar venta + cobros de fiado que usaban `sale_id=NULL` como discriminador) se cerró con el ledger de cuenta corriente: los settlements migraron a `customer_account_movements`, `payments.sale_id` quedó `NOT NULL`, y `delete_sale` borra `payments` en cascada (`schema.sql` → `DELETE FROM payments WHERE sale_id = p_sale_id`). Ya no hay pagos sin venta. Detalle en `docs/todo/customer-account-ledger.md`.
- **✅ (resuelto, 2026-06-01) Cuenta corriente sin ledger / auditoría** (hallazgo 2026-05-28, reconciliación R10b) — implementado: tabla append-only `customer_account_movements` (`charge`/`payment`/`opening`) con `balance_after`, doble-escritura desde `create_sale_transaction` (fiar) y `settle_customer_credit` (cobro), reconciliación R10c (Σ ledger == `credit_balance`), y línea de cobros separada en stats (Batch 2b). Plan y estado completo en `docs/todo/customer-account-ledger.md`.
- **✅ (verificado resuelto 2026-06-02) Catálogo online: agregar al carrito un producto con variantes sin elegir variante** (hallazgo 2026-05-29) — ya no ocurre. El flujo se rehízo con `VariantQuickSelector` (panel en hover de `ProductCard`): el botón "Agregar" está `disabled` hasta seleccionar **todas** las opciones (`canAdd = allSelected && (allowOutOfStock || displayStock > 0)`) y `handleAdd` pasa `variantId` real, label compuesto, precio y stock de la variante. `addToCart` (`CatalogView.tsx`) guarda `{variantId, variantLabel, variantImageUrl}` con key por variante; `CartPanel` muestra el label + imagen de la variante y envía `variant_id` al pedido. La vista lista (`ProductGrid`) enruta los productos con variantes a "Ver variantes →" (detalle), sin add inline. Verificado de punta a punta el 2026-06-02.
- **✅ (2026-06-02) Catálogo online: fetch de variantes era N+1 y podía pegar statement_timeout** (hallazgo 2026-05-29) — la causa real era el fetch **eager en el mount**: cada `ProductCard` con variantes llamaba `get_catalog_product_with_variants` al montar (`useEffect`), solo para alimentar el badge "N variantes" y la imagen de la card → N llamadas concurrentes en la carga inicial, riesgo de `statement_timeout` en cold start del free-tier. **Fix (mig `20260602_04_catalog_products_default_variant_image`):** `get_catalog_products` ahora devuelve `variant_count` y la imagen de la **variante default** (mismo `CASE WHEN has_variants AND pv_def…` que ya usaban precio y stock; antes la imagen era el outlier que devolvía siempre `p.image_url`). El badge y la imagen salen del payload inicial sin fetch. Se eliminó el `useEffect` eager y la heurística `getVariantDisplayImageUrl` del cliente; el detalle de variantes para el selector se trae **lazy en hover** (`onMouseEnter`, cacheado en `variantCache`), o sea a-demanda y user-paced, no N-en-paralelo-al-cargar. Verificado en DB (paridad imagen == variante default) + tsc/lint limpios. Schema en sync.
- **Badge de pedidos online no persiste el "leído" ✅** (2026-05-28) — el estado "leído" vivía en localStorage (`orders-online-seen-at`), per-browser-per-device: no sincronizaba entre dispositivos y un browser nuevo/incógnito recontaba todos los `recibido`. Fix aplicado: columna `businesses.catalog_orders_read_at` (per-business), RPC `mark_catalog_orders_read()` llamada al abrir `/orders`, y `get_catalog_orders_unread_count()` (sin params) que cuenta `recibido AND created_at > catalog_orders_read_at`. Cliente (`UnreadBadge`/`OrdersView`) ya no usa localStorage. Migración `20260528_04_catalog_orders_read_at.sql`.
- **✅ (2026-06-02) Bulk handlers de inventario no chequeaban `data.success` de la RPC** (hallazgo 2026-06-01) — `handleBulkActivate/Deactivate/SetCatalog/ChangeCategory/ChangeBrand` (+`Delete`) en `InventoryPanel.tsx` solo verificaban el error de transporte (`if (error)`) y leían `data.updated`. Si la RPC devolvía `{success:false, error}` (permisos insuficientes, contexto inválido) NO venía por `error` sino dentro de `data` → falla silenciosa ("0 productos actualizados" en vez del 403). **Causa raíz:** las 5 RPC bulk tenían shape asimétrico (fallo `{success:false}`, éxito `{updated}`/`{deleted,discontinued}` **sin** `success`), violando la convención del resto del codebase (regla 5). **Fix (alcance B):** mig `20260602_03_bulk_rpc_success_flag` agrega `'success', true` al RETURN de éxito de las 5 RPC (contrato uniforme) + helper compartido `runBulkAction` en `InventoryPanel` que DRYa el toggle de loading, el chequeo `!result?.success` y el toast de error vía `translateDbError`. Schema.sql en sync; tsc + lint sin warnings nuevos (los `react-hooks/refs` restantes son la deuda del dropdown del header).

---

## P7h Audit Log — Pendiente

- **Fase 3:** revertir una mutación desde su entrada en `/activity` (undo desde cualquier evento).
- **Inmutabilidad de nombres en el detalle del audit log (priority low):** la capa de detalle resuelve IDs→nombres contra los lookups (`productMap`/`categoryMap`/`brandMap`/`customerMap`) **en read-time**, así que un rename/borrado posterior hace derivar el nombre mostrado (debería reflejar el estado al momento del evento). ✅ **Resuelto para acciones masivas** (`bulk_set_product_status`/`bulk_update_product_category`/`bulk_update_product_brand`) — snapshotean `{id, name}` vía `UPDATE … RETURNING` en `old_data.products`; el frontend prefiere el snapshot y cae a `productMap` para entradas viejas (mig. `20260529_13`). **Pendiente (mismo patrón, no urgente):** producto individual creado/borrado/editado (nombre de categoría/marca vía lookups, `product.tsx:47-48,260-268`), ventas (cliente + nombres de ítems, `sale.tsx:25,62,289`), entity labels (`EntityGlyph.tsx:39`, `ActivityRow.tsx:76`). Atacar de a uno — tocar el RPC de ventas + los de producto individual es un refactor más grande. Decidido fasearlo (2026-05-29).
- **Scope cut Fase 1:** ~~`ImportProductsModal` escribía `categories.icon_color` directo~~ ✅ — marcas y categorías ya pasan por `create_brand_guarded` / `create_category_guarded` (con `stock_write` + audit). **Lo que queda** es el path de **productos** del import masivo: `.upsert` (sku/barcode), `.insert` (plain) y `.delete` (undo) van directo a `products`, sin pasar por `create_product` ni audit log. Cerrarlo requiere un RPC de import masivo (upsert por sku/barcode + `stock_write` + audit) y el RPC de undo → es efectivamente **P8b** (`undo_import`). No es quick win.

---

## P7i — Redondeo de precios configurable (post-beta, nice-to-have prioritario)

> El nombre quedó dentro de la familia P7 por historia, pero conceptualmente no pertenece a P7. Es una feature de pricing independiente.

> **ESTADO (2026-06-06): ✅ CERRADO.** Re-diseñado e implementado como redondeo POR LISTA (no global). El diseño de abajo (config global en `businesses.settings`) quedó **OBSOLETO** tras el rediseño de precio base autoritativo. Lo implementado: columnas `price_lists.rounding_step` (NULL = sin redondeo; M ∈ 0.1/1/5/10/50/100) + `rounding_up` (toggle hacia arriba); fórmula única `round(x/M)*M` (`applyRounding` en `lib/price-lists.ts`) aplicada como último paso sobre el precio de lista, en cliente y POS (`calculateProductPrice` ← `resolveDisplayPrice`); UI = selector + checkbox + preview en `RoundingField.tsx` dentro de New/EditPriceListModal. Migs `20260603_03_price_list_rounding.sql` (aplicada al remoto) + `20260606_01_compute_effective_price_rounding.sql`. Probado end-to-end en UI. **Paridad SQL cerrada:** el mirror `compute_effective_price` ahora también aplica el redondeo en su rama de lista (busca `rounding_step`/`rounding_up` por `p_list_id`). Hoy es inerte (el catálogo llama con `list_id=NULL` = precio base, sin redondeo), pero el día que se implemente el **feature futuro "elegir qué lista mostrar en el catálogo público"** el catálogo redondeará igual que el POS desde el arranque, sin reabrir esto. Lo de abajo se conserva solo como registro histórico del diseño viejo.

Feature crítica para el contexto LATAM con alta inflación y precios cambiantes. Los precios calculados por listas de precios generan valores como $847,50 o $1.233,33 que en la práctica nadie cobra — el mercado redondea a $850 o $1.250. Sin esta feature, el dueño tiene que crear overrides manuales para cada producto.

### Motivación real

El negocio familiar de referencia tiene productos con márgenes calculados sobre costos que cambian frecuentemente. Cada actualización de costos genera nuevos precios "feos" que requieren ajuste manual. Con esta feature, el sistema redondea automáticamente al valor comercialmente práctico sin intervención del usuario.

### Diseño acordado (2026-04-18)

**Dónde vive la config:** `businesses.settings` (JSONB ya existente, extensible sin migración):

```json
{
  "rounding": {
    "enabled": true,
    "mode": "multiple",
    "value": 10,
    "direction": "round"
  }
}
```

**Modos disponibles:**

- `none` — sin redondeo (default para todos los negocios existentes)
- `decimals` — redondear a N decimales (0, 1, 2)
- `multiple` — redondear al múltiplo más cercano de N (5, 10, 50, 100)

**Dirección:** `round` (matemático estándar) o `ceil` (siempre hacia arriba). `floor` descartado — cobrar de menos no tiene sentido comercial.

**Dónde se aplica:** en `calculateProductPrice` como último paso antes de retornar. Todo el downstream (POS display, `sale_items.unit_price`, totales de venta) recibe el precio ya redondeado automáticamente, sin cambios en otros componentes. **Recordar mantener en sync el mirror SQL `compute_effective_price`** (catálogo público) — debería leer `businesses.settings.rounding` y aplicar el mismo redondeo, o el POS y el catálogo divergirían.

**UI:** sección "Redondeo de precios" en `/settings`. Toggle enable/disable + selectores de modo y valor que aparecen cuando está activo.

**Sin override por lista en v1** — configuración global del negocio. Si hay demanda de override por lista se agrega en una iteración posterior sumando un campo en `price_lists`.

### Impacto en código

| Archivo | Cambio |
|---------|--------|
| `lib/price-lists.ts` | `calculateProductPrice` recibe `roundingConfig` opcional, aplica redondeo como último paso |
| `compute_effective_price` (Postgres) | Mirror SQL — aplicar el mismo redondeo leyendo `businesses.settings.rounding` |
| `components/settings/SettingsForm.tsx` | Sección de redondeo — el `handleSubmit` ya mergea `business.settings` con spread, no rompe nada |
| Server Components que llaman `calculateProductPrice` | Leer `businesses.settings.rounding` y pasarlo como parámetro |

### Retrocompatibilidad

- Todos los negocios existentes quedan con `rounding.enabled = false` o campo ausente → comportamiento idéntico al actual.
- `calculateProductPrice` con `roundingConfig = undefined` retorna el precio sin redondeo — sin regresión.

### Prioridad

No es bloqueante para beta. Es un nice-to-have que se vuelve must-have en cuanto el primer usuario activo tenga más de 50 productos con precios dinámicos. Implementar antes de lanzar pricing público.

> **Nota (2026-06-02):** este diseño es PREVIO al rediseño de "precio base autoritativo" (ver sección siguiente). En el modelo viejo `calculateProductPrice` producía el precio de venta de todos los días, así que redondear ahí redondeaba todo. En el modelo nuevo el precio base es el campo `price` (que el usuario ya escribe redondo) y `calculateProductPrice` solo produce precios de **listas alternativas** (cost×mult). Por eso el redondeo hay que **re-analizarlo**: probablemente aplica al **generador de precios** y a las **listas alternativas**, no al precio base. Re-analizar junto con la Fase 3 de abajo.

---

## Listas de precios — Fase 3: generador "precios base desde costo" (post-beta, diferido)

> Contexto: el rediseño de listas de precios (precio base autoritativo) se cerró en Fases 1 y 2 (desplegadas 2026-06-02). Esto es la Fase 3, **deliberadamente diferida**.

### Qué es

Una acción de **generar / recalcular en masa el precio base** de los productos a partir del costo: "generar precios base = costo × N (+ redondeo)", con un **preview/diff** de qué precios cambian antes de aplicar. Reemplaza la conveniencia masiva que se perdió al desacoplar el precio base de las listas.

Implementación esperada cuando se retome: RPC guardada `generate_base_prices(p_business_id, p_multiplier, scope)` que setea `products.price = round(cost × mult)` para el scope elegido, con permiso `stock_write` + `log_audit_event` (regla 32), y UI con preview/diff (probablemente en Inventario).

### Por qué se definió así

En el modelo nuevo el **precio base** (`products.price` / `product_variants.price`) es la única fuente de verdad y es **manual** (el dueño lo fija). Eso resuelve el bug original (un cambio de costo ya no re-precia solo) pero quita la comodidad de "no escribir miles de precios uno por uno". La solución acordada fue mantener esa comodidad como una **acción explícita y puntual** (generar/recalcular), no como una fórmula viva — así el usuario controla cuándo recalcular y nada se mueve solo. Decisión de modelo tomada con el usuario el 2026-06-02 (manual + generador opcional).

### Por qué se difirió

1. **No es necesaria para la consistencia.** Fases 1+2 ya cerraron el bug y dejaron el sistema consistente. La Fase 3 es conveniencia net-new, no un arreglo.
2. **Depende del redondeo (P7i), que hay que re-analizar** bajo el modelo nuevo (ver nota arriba): el generador sin redondeo produce precios "feos" (costo × 1.35 = 24,83), justo lo que P7i busca evitar. Conviene diseñarlos juntos.
3. **Falta definir el default-markup.** El "precio sugerido desde costo ×N" en el form de producto quedó diferido por la misma razón: ya no hay "lista default" de donde sacar el N; hace falta una config de markup por defecto del negocio (encaja naturalmente con este generador).
4. **No hay urgencia de datos hoy.** El único negocio real en beta (Cecilia) tiene pocos productos con precio cargado a mano; el dolor de "miles de precios" todavía no es real.

### Prioridad

Post-beta. Tratar como iniciativa propia (generador + redondeo P7i + default-markup, diseñados en conjunto), no como un add-on apurado. Planificar en serio antes de implementar.

---

## Ideas de producto — Nice-to-have / a evaluar (post-beta)

### Ventas simultáneas en paralelo (multi-carrito)

Poder tener varias ventas abiertas sin cerrar a la vez — varios `CartPanel` conviviendo, alternables (¿tabs?). Caso de uso: atender a un cliente, dejar su venta en espera para cobrarle rápido a otro, retomar la primera. UX por definir (tabs vs. lista de ventas en espera "parked sales"). Implica que el cart store (`lib/store/cart.store.ts`, hoy un único carrito en Zustand) pase a un modelo de N carritos con un carrito activo. A diseñar.

### Selección de columnas en export de tablas

Al exportar listas de precio desde `/price-lists` (`ExportPriceListModal`), permitir elegir qué columnas descargar (ej. excluir costo, variantes, categoría). Idealmente estandarizar el patrón como una capacidad reutilizable de `ExportCSVButton` para todas las tablas exportables (dashboard, stats, activity, etc.), con la selección persistida/recordada. A evaluar alcance.

### Productos por peso / medida (no por unidad)

Comprobar si vale la pena (y qué tan sencillo es) soportar productos vendidos por peso o medida — Kg, gramos, litros, metros — en lugar de unidades enteras. Impacta: `products` (unidad de medida), input de cantidad en POS (decimales), stock (decimal), cálculo de precio (precio por Kg × cantidad). Spike de viabilidad antes de comprometer.

### Descuentos y promociones

Modelo de descuentos y promociones e integración en la app. Por definir: alcance (descuento por línea, por venta total, por producto, por categoría, 2x1, % temporal), dónde se configura, cómo se persiste en `sale_items`/`sales`, y cómo se refleja en el catálogo público. Feature grande — requiere diseño dedicado.

### Densidad de UI configurable (scale)

Observación al comparar con Cobrando.app (2026-05-28): en un mismo viewport ellos muestran mucha más información que Pulsar — nuestros elementos (sidebar, botones, filas de tabla, tipografía) son comparativamente grandes. El diseño se ve bien pero no es óptimo en densidad. No urgente. Idea: en `/settings` un control de escala de UI (ej. `0.75` / compacto / cómodo) que reduzca el tamaño global de elementos. A evaluar implementación — posiblemente vía variable CSS de escala o `font-size` raíz + tokens de spacing. Ojo con tocar densidad del POS donde los targets táctiles importan.

**Spike previo (probado en Mac Air M5, un solo dispositivo):** aplicar la escala global funcionó razonablemente bien en casi toda la app. El único quiebre detectado fue en los **navbars/headers de cada pantalla (el bar donde vive el título)**: con el sidebar más chico, el header no ocupaba todo el ancho disponible y quedaba un **gap entre el sidebar y el header**. Es decir, el ancho del header parece anclado al ancho del sidebar sin escalar — revisar cómo se calcula el ancho del `PageHeader`/contenedor del shell. Falta probar en otros tamaños de viewport y dispositivos.

### Escaneo de factura → autocompletar gasto (OCR/IA)

> **MVP ✅ CERRADO (2026-06-06).** Solo-texto, solo-encabezado: el owner sube un PDF (capa de texto) o Excel/CSV y la IA pre-llena proveedor (match difuso contra `suppliers`), fecha, monto, categoría y descripción del gasto **no-mercadería**; el owner valida y guarda con el flujo actual (`create_expense`, sin cambios). Edge Function `extract-expense` (JWT del dueño + `assert_tenant`, Groq vía `makeProvider`), frontend `ExpenseScanCard` en `NewExpensePanel`. PDF→`unpdf` server-side; Excel/CSV→SheetJS client-side. Probado en UI. Plan completo en [`expense-document-scan.md`](expense-document-scan.md).
>
> **Fase 2 (diferida, no es deuda — recorte de scope):**
> - **Visión / foto de ticket térmico** — requiere método de visión (`completeJsonWithImage`, Groq Llama-4).
> - **Mercadería con line-items** — extraer items + match de cada uno al catálogo (`products`) con aliases por proveedor + update de stock/costo vía `create_mercaderia_expense`. La parte cara; se retoma con productos reales en la DB y un documento de ejemplo. Hoy si la IA clasifica `mercaderia` se remapea a `proveedores` (header-only no itemiza).
> - **Replicar el scan en `EditExpensePanel`** — hoy solo al crear; sumarlo si se valida demanda.
> - A definir cuando se retome: límites de escaneos por plan, throttle por negocio (comparte TPM free-tier de Groq con P12).

El owner sube un PDF o foto de la factura de una compra recién hecha y el sistema extrae los datos (proveedor, items, costos, cantidades) y prerellena el gasto de mercadería automáticamente; el owner sólo verifica y guarda. Encaja con el flujo de `/expenses` mercadería (`create_mercaderia_expense`, line-items por producto, update de stock/costo). Cobrando.app ya tiene algo así ("Escanear factura" con límite de escaneos/mes — 12/400).

---

## Otras P-Phases

- **P8b** — `undo_import` RPC (planeada, nunca creada).
- **P10.a ✅** (2026-05-27) — fundación comercial/fiscal mínima aplicada: tabla `subscriptions` (RLS read-only para owners, escritura sólo por backend), `businesses.country_code` (CHECK AR/MX/CO/UY), `businesses.tax_id`, `get_plan_limits(uuid)`. `bootstrap_new_user` actualizado para crear la subscription free al alta. Backfilled para los 5 negocios existentes.
- **P10.b** — facturación electrónica (tabla `invoices`, integración Facturama/proveedor por país). Diferida hasta señal real de demanda.
- **P10.c** — contabilidad completa (chart_of_accounts, journal_entries, journal_lines). Diferida.
- **P10 docs mismatch** — `docs/db.md` documenta `invoices`, pero no aparece en `supabase/schema.sql`; validar contra la DB en vivo antes de construir sobre eso.
- **P11.1 ✅** (2026-05-27) — tabla `daily_snapshots` + RPCs `upsert_daily_snapshot`, `refresh_daily_snapshot`, `refresh_all_daily_snapshots`, `get_daily_snapshots`. Backfill histórico de todos los días con ventas/gastos. Edge Function `refresh-daily-snapshots` desplegada con guard `CRON_SECRET`. Cron pg_cron `refresh-daily-snapshots-nightly` (`10 6 * * *` UTC = 03:10 ART) leyendo el secret desde Supabase Vault (no en plaintext en `cron.job`). Widget en `/stats` con totales + chart de ingresos vs gastos.
- **P11.2 ✅** (2026-05-27) — RPC `get_period_comparison(business_id, from, to)` (alinea período actual vs anterior por offset, sobre `daily_snapshots`). Página `/stats/trends` (edge runtime) con 4 KPI cards delta% + pill-tabs para alternar métrica (`net_revenue | expenses | sales_count | avg_ticket`) + LineChart current/previous. UX optimista: React Query + `keepPreviousData`, URL sync con `window.history.replaceState` (no `router.push`), `isFetching` indicador discreto. Link "Ver detalle →" desde el widget de `/stats`.
- **P11.3 parte 1 ✅** (2026-05-28) — heatmap de ventas por día/hora.
  - `businesses.timezone` (IANA, default `America/Argentina/Buenos_Aires`, backfilled desde `country_code` AR/UY→BA, CO→Bogota, MX→Mexico_City).
  - RPC `get_sales_heatmap(business_id, from?, to?)` que agrupa sales `completed` por `(weekday, hour)` en la TZ del negocio. Devuelve sólo celdas con datos; la UI rellena con ceros.
  - Página `/stats/heatmap` (edge runtime) con DateRangeFilter, pill-tabs `Ventas | Ingresos`, KPIs (día más activo, hora pico, mejor día+hora), export CSV (168 filas), URL sync optimista.
  - Widget compacto en `/stats` con link `Ver detalle →`.
  - Componente reusable `SalesHeatmap` con prop `compact`.
- **P11.3 parte 2** — pendiente: reporte mensual exportable en PDF (consolidado mes con KPIs, top productos, gastos, comparativa vs mes anterior).
- **P12** — IA proactiva. Plan refinado en [`docs/todo/p12-ia-proactiva.md`](p12-ia-proactiva.md) (estado detallado + decisiones cerradas ahí). **Pasos 1–3 hechos y verificados en vivo** (2026-06-02):
  - `ai_insights` (tabla + RLS + opt-in `businesses.settings.ai_insights_enabled`) — mig. `20260602_06`.
  - Capa de datos: `get_margin_analysis` (mig. `05`); detectores **Nivel 1** `get_product_demand_shifts` / `get_payment_mix_shift` / `get_channel_signals` (mig. `07`); historial **Nivel 2** de producto `get_product_history` (mig. `08`). Todas con guard dual-use (`if auth.uid() not null → assert_tenant`, si no service_role/cron) + REVOKE anon. schema.sql en sync.
  - **Pasos 4–6 ✅ (2026-06-03, verificado en vivo):** Edge Function `generate-insights` (assembler dos niveles + Groq abstraído + anti-repetición) + cron `generate-insights-nightly` (`30 6 * * *` UTC). UI anclada (glyph ambiente en dashboard/stats/inventory, popover on-brand pasado por critique+Emil, acción "Ver producto", toggle `ai_insights_enabled` en settings con gating de display). Pulso condicional new/seen + sonido opt-in. Copy iterado (sin voseo/imperativo, rationale natural, few-shot). Modelo **Groq Llama 3.3 70b** ambos niveles. Prep DB: mig. `20260603_01` (guard dual-use en margin/dead_stock/overstock). Detalle en [`p12-ia-proactiva.md`](p12-ia-proactiva.md).
  - **Idea pendiente — Vista propia del Asistente:** pantalla central (`/insights` o "Asistente" en sidebar, owner/`analysis`-gated) con resumen + historial de sugerencias (activas/descartadas/accionadas), complementando los glyphs anclados (no reemplazándolos). Crece en valor al sumar dominios diferidos (cliente, proveedor, y **stats de operarios con detección de patrones de IA**). NO en `/operator/me` (ahí van las stats propias del dueño). A diseñar como iniciativa aparte.
  - **Monetización (dirección acordada 2026-06-03, metering NO implementado):** la IA es feature de plan pago. **La tab del Asistente + dominios avanzados = Pro**; los glyphs ambientes (lo ya hecho) quedan en el free como "gancho" que demuestra valor mientras el dueño trabaja. Paywall por **cobertura + profundidad**, NO por raciones magras ("1 sugerencia/mes" es demasiado fino para enganchar) y **NO degradando la calidad del copy** (un free tonto rompe la confianza en toda la feature). Free = detección + pocos deep-dives + dominios core (precio/stock/pago/canal), genuinamente útil pero acotado. Pro = **modelo más fuerte** (la abstracción provider + `INSIGHTS_MODEL_N1/N2` por env hace el tiering por modelo un cambio de config, incluso por plan del negocio) + más deep-dives/noche + dominios avanzados (operarios/clientes/proveedores) + historial + la tab. **Hoy el modelo es Groq free ($0), así que no urge:** el metering (contar por negocio/plan, gatear en assembler o UI) se calibra con señal de uso real, no a ciegas (sin usuarios reales todavía).
  - **Diferidos a backlog** (incorporar cuando el loop ruede bien): detector N1 + historia N2 de **cliente** (RFM — regulares que se apagaron vs su cadencia + deuda/`credit_balance`) y de **proveedor** (cost creep: último `unit_cost` vs anterior por producto desde `expense_items`). Mismo patrón comparativo + guard dual-use.
- **Segmentación POS vs Pedido online en stats/dashboard** (2026-05-29) — la columna `sales.source` (`'pos' | 'catalog'`) ya existe y se setea en la conversión de pedidos del catálogo, pero **no está expuesta** en la UI. Pendiente: filtros/segmentación por canal en `/stats`, `/dashboard` e historial de ventas, y en los export. El dato ya se captura desde ahora; solo falta mostrarlo. (Ventas históricas pre-columna quedan como `'pos'`; las que vinieron de pedidos siguen identificables vía `catalog_orders.sale_id`.)

---

## Límites del flujo de creación (a tener en cuenta)

- **`NewProductModal` con variantes** exige que cada variante activa tenga `price > 0`. La regla de pricing (`compute_effective_price` / `calculateProductPrice`) soporta `price = 0 && cost > 0` → `cost × multiplicador`, pero ese estado **no es alcanzable por UI normal**. Sólo llegaría por importación masiva (P8b) o inserción manual en DB.

---

## CONTEXT.md — Discrepancias con la DB en vivo

| Área | CONTEXT.md dice | Realidad |
|------|-----------------|----------|
| Project ID | `zrnthycznbrplzpmxmkwk` | `zrnthcznbrplzpmxmkwk` |
| `businesses.accounting_enabled` | Listado como existente | No existe |
| `businesses.settings` keys | Sólo `primary_color` | También `currency` y `logo_upload_path` |
| `profiles.onboarding_state` | No documentado | Existe, lo usa el wizard de onboarding |
| `sales.status` CHECK | `('pending','completed','cancelled')` | `('completed','cancelled','refunded')` — sin `pending`, con `refunded` |
| `cash_sessions` columnas | Listadas `status`, `difference` | Ninguna existe; sí existe `notes` |
| `payments.method` CHECK | Lista `credit`, `otro` | No están — sólo `cash,card,transfer,mercadopago` |
| `payments.status` CHECK | `('pending','completed','failed')` | `('completed','pending','refunded','cancelled')` — sin `failed` |
| `expense_items` table | No documentada | Existe — sistema completo de line-items para mercadería |
| `inventory_movements` | Sin `reason`, `reference_id` | Ambos existen |
| `undo_import` RPC | Documentada como existente | No existe |
| `update_expense` RPC | No documentada | Existe — edita gastos no-mercadería |
| `create_mercaderia_expense` RPC | No documentada | Existe |
| `update_mercaderia_expense` RPC | No documentada | Existe |
| `update_product_variants` RPC | No documentada | Existe — firma: `(p_operator_id, p_business_id, p_product_id, p_options, p_variants)` |
| `create_product_with_variants` RPC | No documentada | Existe — firma: `(p_operator_id, p_business_id, p_product, p_options, p_variants)` |
| `compute_effective_price` SQL function | No documentada | Existe — espejo SQL de `calculateProductPrice` para las RPCs del catálogo |
| Permissions count | "9 campos" | **8 capacidades en 4 áreas** (rediseño 2026-06-09: `online_orders`, `pos_pricing`, `inventory_read`, `inventory_write`, `reports`, `expenses`, `settings`, `manage_operators`). Normalizador canónico `normalize_permissions` SQL ↔ TS, bi-shape. Ver `docs/todo/permisos-operario-redesign.md` |
| `stats` permission | Listada como `stats` | Renombrada a `analysis` el 2026-05-16 (cubre dashboard, stats, /activity) |
| `audit_log` table | No documentada | Existe — append-only, P7h Fase 1+2 |
| Inventory mutation RPCs | Documentadas con escritura directa a tabla | Todas pasan por RPCs `SECURITY DEFINER` con audit log |

---

## Deuda técnica — Post-beta

| Item | Notas |
|------|-------|
| `InventoryPanel.tsx` (~1400L) | Aún grande pese a extracciones. Pendiente: extraer el **dropdown responsive del header** (Import/Export + Categorías/Marcas, ~140L casi idénticas, L683-826) a un `<HeaderActionDropdown>`; memoizar las stats del footer (L229-240). Diferido 2026-05-29 porque la extracción del dropdown (portales + getBoundingClientRect + outside-click) necesita smoke-test en viewport mobile. Ver `docs/tests/09-auditoria-calidad.md` §2.3. |
| ~~`CartPanel.tsx` (~920L)~~ ✅ | `EditSalePanel` ya extraído a `src/components/pos/EditSalePanel.tsx`; `CartPanel` bajó a ~761L. |
| ~~Radix `DialogTitle` warnings~~ ✅ (2026-05-28) | Todos los `DialogContent` tienen `DialogTitle`. Faltaban 5 (`NewOperatorModal`, `EditOperatorModal`, `ExportPriceListModal`, `EditSupplierModal`, `ExpensesTable`); resueltos con `<VisuallyHidden><DialogTitle>` siguiendo la convención de `price-lists`. |
| `useEffect` para sales history en `CartPanel` | Patrón pre-React Query, no migrado |
| ~~`theme.tsx` FOUC~~ ✅ (2026-05-28) | Resuelto con script inline bloqueante en `<head>` (`ThemeScript.tsx`) que aplica la clase `dark` antes del primer paint, leyendo `localStorage` + `prefers-color-scheme`. Constante única `THEME_STORAGE_KEY` en `lib/theme.ts`. El efecto de círculo del toggle (View Transition) se extrajo a `runThemeToggleTransition` en `lib/theme.ts` y ahora lo usan tanto el sidebar como el toggle del catálogo público. |
| `!` assertions en env vars | En `client.ts` y `server.ts` |
| `protobufjs <=7.5.7` (npm audit, HIGH) | Transitiva vía `@sentry/nextjs` → `@opentelemetry/otlp-transformer`. **Riesgo real bajo**: es el transporte OTel de Sentry (serializa telemetría propia, no input de atacante), así que los CVE de DoS/inyección por protobuf malicioso no aplican. `npm audit fix` NO es quirúrgico (cambia 12 paquetes + warning de downgrade breaking de next). Si se ataca: `overrides` forzando solo protobufjs a 7.5.8+ y verificar con build. Decidido 2026-05-29: dejar, no urgente. |
| `react-hooks/refs` en InventoryPanel/POSView (lint, 19 errores) | Refs leídos/mutados en render (dropdowns del header de InventoryPanel L729-804; refs de POSView). No es bug hoy; único hotspot real de lint. Limpieza post-beta. Ver `docs/tests/09-auditoria-calidad.md` §1.7. |
| `CartItem` en `lib/types/index.ts` | Tipo client-only mezclado con tipos del server |
| `categories.public_read_categories` policy | Permite SELECT anon — OK para catálogo pero amplio |
| `DateRangeFilter.tsx` | `QUARTER_RANGES` recalcula en cada render. No-issue en práctica. |
| ~~`daily_snapshots` agrupa en UTC~~ ✅ (2026-05-28) | Resuelto en `20260528_05_daily_snapshots_tz_fix.sql`: las agregaciones de ventas ahora castean `(s.created_at AT TIME ZONE b.timezone)::date` (mirror de `get_sales_heatmap`). `refresh_daily_snapshot` / `refresh_all_daily_snapshots` resuelven "ayer" en la TZ local de cada negocio (default param → NULL). Re-backfill completo (DELETE + rebuild, tabla derivada) para evitar filas huérfanas del bucket UTC viejo. Verificado: 2 ventas nocturnas ART reasignadas al día local correcto; snapshots == agregado local-day exacto. |

---

## `inventory_movements` — tabla parcial huérfana (deuda técnica, planteado 2026-05-30)

> Hallazgo al evaluar la feature de **stock muerto / dead-stock**. Se rastreó a fondo el uso real de la tabla antes de apoyar analytics sobre ella.

**Qué es hoy, en concreto:**
- **Escrita por solo 2 flujos:** el trigger `update_stock_on_sale` (en `sale_items` insert → movimientos `'sale'`, cantidad negativa) y `create_mercaderia_expense` / `update_mercaderia_expense` (→ movimientos `'purchase'`).
- **Leída por NADIE:** 0 referencias en `src/` (ni frontend ni API), 0 `SELECT` en cualquier RPC. **Todas** las apariciones tipo "FROM" en las migraciones son `DELETE` de limpieza (al borrar una venta o un producto se purgan sus movimientos por `reference_id` / `product_id`).
- **Tipos muertos:** el CHECK permite `('sale','purchase','adjustment','return')`, pero `'adjustment'` y `'return'` **nunca se insertan** en ningún lado.
- **No reconcilia:** `create_product` y `update_product` **no loguean** (el stock inicial y los ajustes manuales de stock son invisibles) → `stock_inicial + Σmovimientos ≠ stock_actual`. `create_product` snapshotea el alta en `audit_log.new_data`, no acá.

**Por qué la limitación NO parece deliberada** (kardex a medio construir, huérfano tras la llegada del audit log P7h):
1. Nadie lo lee — una limitación con propósito tendría al menos un lector.
2. Borra en vez de revertir (`DELETE FROM inventory_movements` al borrar venta/producto) → anti-ledger; un libro mayor real nunca borra, agrega asiento compensatorio.
3. Tipos `'adjustment'`/`'return'` sin cablear.
4. Columna `created_by` ya eliminada por ser muerta (ver M-3, `20260528_06`).

**Opciones para resolver (decidir post-beta; no patchear a medias — sumar un 3er escritor parcial no la vuelve confiable):**

- **(A) Eliminar la tabla y su poco aporte.** El trigger de venta y el flujo de mercadería dejan de insertar; se quitan los `DELETE` de limpieza. `audit_log` + `sale_items` ya cubren auditoría y analytics. Lo más simple; reduce superficie y código muerto. Riesgo: perder la base si después se quiere un kardex.
- **(B) Rediseñarla como libro mayor real (kardex inmutable).** Encaja con el **módulo contable del roadmap (P10.c, diferido)**. Implica: loguear **todos** los deltas (create/update/bulk/venta/compra/ajuste/devolución), **nunca borrar** (revertir con asiento compensatorio), centralizar las mutaciones de stock en un solo punto, y construir UI de lectura ("historial de stock del producto"). Feature de **confianza** ("¿por qué tengo 5 si compré 20?"). Mayor scope + disciplina permanente (todo camino que toque stock debe loguear o el invariante se rompe en silencio). No es retroactivo: el replay histórico solo sirve desde que el libro queda completo.
- **(C) Dejarla como está** (inofensiva) y marcarla como deuda. Status quo.

**Recomendación:** decidir A vs B **en conjunto con P10.c**. Si el módulo contable avanza → **B** (el kardex es insumo natural de la contabilidad). Si no se va a construir contabilidad pronto → **A** (limpiar código muerto). **Dead-stock v1 NO depende de esto** — usa `sale_items` (última venta/velocidad) + `products.created_at` (antigüedad), no `inventory_movements`.

---

## Borrado completo de un negocio + huérfanos (post-beta, mantenibilidad)

> Planteado 2026-05-29. Hoy sin usuarios reales el impacto es nulo (la DB se limpió a mano hace semanas; los huérfanos de Storage encontrados en la auditoría se eliminaron). Con varios negocios en producción pasa a ser un problema real.

**Contexto:** la DB **no usa `ON DELETE CASCADE`** (decisión de seguridad/integridad). Al eliminar un negocio quedan huérfanos dispersos: storage (`{businessId}/` en cada bucket), `products`, `categories`, `brands`, atributos/colores (`product_options`, `attribute_types` es global), `audit_log` (**crece rápido**), `daily_snapshots`, `sales`+`sale_items`+`payments`, `expenses`+`expense_items`, `customers`, `operators`, `cash_sessions`, `catalog_orders`+items, `feedback`, `subscriptions`.

**Diseño propuesto (no implementado) — dos capas:**

**Capa 1 — hard delete orquestado (la *ejecución*):**
1. RPC único `delete_business(p_business_id)` — `SECURITY DEFINER`, owner-only (`assert_tenant`), transaccional, borra en orden de dependencias FK. Audita la operación antes de borrar `audit_log`. Borra también el `auth.users` del dueño.
2. Paso server-side (edge fn o admin con `service_role`) que liste y borre `{businessId}/` en cada bucket — **el SQL no puede borrar storage** (trigger `storage.protect_delete`); requiere la Storage API.
3. Opcional: job de reconciliación periódico que detecte huérfanos (filas con `business_id` inexistente; objetos cuyo primer folder no es un negocio) y los reporte — defensa contra borrados parciales.

**Capa 2 — soft delete + período de gracia (la *programación*, encima de la capa 1):**
- Máquina de estados en `businesses.status`: `active → pending_deletion → deleted`, con `deletion_scheduled_at`. "Eliminar la cuenta" desde la UI (aún no existe) **solo marca** el negocio — nada se borra hasta el día 30. Un solo flag congela todo; no se tocan las ~15 tablas.
- **Acceso durante la gracia:** si `status = pending_deletion`, el proxy / `get_business_id()` bloquea la operación normal y muestra "tu cuenta se eliminará el DD/MM — reactivar". El dueño **reactiva con solo volver a entrar** (→ `active`, se limpia `deletion_scheduled_at`).
- **Hard delete diferido:** el cron existente (`pg_cron`, el de snapshots) corre un job diario que busca `deletion_scheduled_at < now()` y dispara la Capa 1.
- **Salvaguardas (datos críticos de un negocio real):** (a) **export de todos los datos antes de confirmar** (ver ítem "Portabilidad" abajo) — es lo que da la seguridad real, más que la ventana; (b) confirmación con fricción (reingresar contraseña o tipear el nombre del negocio); (c) registrar el pedido de eliminación en `audit_log` (quién/cuándo) **antes** de vaciarlo.
- **Orden de implementación:** primero la Capa 1 (sin un `delete_business` confiable el cron no tiene qué ejecutar), después la Capa 2 encima.

**Legal:** en Argentina (Ley 25.326) y marcos similares, el derecho de supresión convive bien con una ventana corta anti-arrepentimiento; 30 días es defendible.

**Decisión abierta:** ¿`audit_log` se borra con el negocio (sí, es business-scoped) o se retiene anonimizado para forense/legal? Hoy retención indefinida sin TTL (regla CLAUDE.md), pero eso aplica a negocios vivos.

---

## Portabilidad de datos — export + import completo (futuro, importante, no urgente)

> Planteado 2026-05-29. Hoy solo se exportan productos (`ExportCSVButton` en tablas puntuales). La visión es exportar **e importar** **todos** los datos de un negocio.

**Objetivo:** poder exportar el negocio entero —no solo productos: historial de ventas, pagos, gastos, clientes, métricas/snapshots, listas de precios, categorías/marcas, operadores, sesiones de caja, etc.— en un formato estructurado (JSON/CSV por entidad o un bundle). Y, más adelante, **importarlo** — para permitir:
1. **Migración hacia Pulsar** desde otro software (onboarding de negocios que ya operan).
2. **Migración desde Pulsar** hacia otro software (no retener al usuario por lock-in; genera confianza).
3. **Export-before-delete:** es la salvaguarda que habilita el borrado de cuenta con tranquilidad (ver sección de borrado de negocio arriba).

**Notas de diseño (preliminar):**
- Export read-only es lo primero y más simple; el import es bastante más complejo (resolución de IDs, FKs, deduplicación, validación, conflictos con datos existentes).
- Pensar un esquema/versión del formato desde el inicio para que export e import sean compatibles a futuro.
- Scope por `business_id` (reutiliza el aislamiento ya auditado).
- Datos sensibles: el export contiene info crítica del negocio → entregar vía descarga autenticada (no link público), idealmente con la sesión del dueño.

**Prioridad:** importante para confianza/adopción y como pieza del borrado de cuenta, pero **no urgente** (sin usuarios reales). Empezar por el export completo; el import queda como fase 2.
