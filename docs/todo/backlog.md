# Pulsar POS — Backlog & Known Issues

> Trabajo pendiente, bugs conocidos, errores de CONTEXT.md y deuda técnica post-beta.

---

## DB Audit — Pendiente

| ID | Issue |
|----|-------|
| ~~M-3~~ ✅ (2026-05-28) | `inventory_movements.created_by` era columna muerta (sin FK, nunca escrita ni leída, 0/68 filas). La atribución la maneja `created_by_operator` (FK → operators, NULL = dueño). Resuelto en `drop_inventory_movements_dead_created_by`: `DROP COLUMN created_by` + quitada de `schema.sql`. |

---

## Bugs conocidos

- **Borrar una venta deja pagos huérfanos** (hallazgo 2026-05-28, reconciliación R8b) — al borrar una venta, sus filas en `payments` quedan con `sale_id = NULL` (no se borran en cascada). Un pago huérfano ($4000, card) detectado en prod sin venta asociada. Riesgo: reportes de métodos de pago que no joineen por `sales` pueden sumar pagos sin venta. Revisar el comportamiento de borrado de ventas (¿`ON DELETE SET NULL` en `payments.sale_id`?) y decidir si los pagos deben borrarse en cascada o si el borrado de ventas debe estar vedado. Revisar al terminar la prueba de estrés.
- **Cuenta corriente sin ledger / auditoría** (hallazgo 2026-05-28, reconciliación R10b) — `customers.credit_balance` se ajusta directo (sube al fiar, baja al cobrar) sin tabla append-only de movimientos. No hay forma de reconciliar ni auditar saldos de fiado: si un saldo queda mal, no hay rastro de por qué. Considerar una tabla `customer_account_movements` (o similar) que registre cargos y pagos de cuenta corriente. Revisar al terminar la prueba de estrés.
- **Catálogo online: se puede agregar al carrito un producto con variantes sin elegir variante** (hallazgo 2026-05-29) — cuando la variante default tiene stock, el catálogo permite "Agregar al carrito" desde la card sin seleccionar ninguna variante. El item se agrega (al parecer con el precio de la variante default), pero en el carrito se muestran los datos del producto **padre** (nombre/atributos) en vez de la variante elegida — no se ve qué variante se agregó. No ocurre en todos los productos (solo cuando la default tiene stock). Hay que forzar la selección de variante antes de permitir agregar, o mapear correctamente la variante (id, atributos, precio, stock) al item del carrito. Revisar `ProductCard.tsx` (flujo de add-to-cart con variantes) y el render del carrito del catálogo.
- **Catálogo online: fetch de variantes es N+1 y puede pegar statement_timeout** (hallazgo 2026-05-29) — cada `ProductCard` con variantes llama `get_catalog_product_with_variants` por separado (una RPC por card). La query individual es rápida (~34ms en caliente), pero bajo cold start de la DB free-tier o carga, las N llamadas concurrentes pueden agotar el `statement_timeout` (`canceling statement due to statement timeout` en `ProductCard.tsx:103`). Observado en dev entrando a dos catálogos. Considerar: incluir variantes/precios en el `get_catalog_products` inicial, o un batch RPC `get_catalog_products_with_variants(slug)`, + UX de loading/retry. No es bug de la query en sí.
- **Badge de pedidos online no persiste el "leído" ✅** (2026-05-28) — el estado "leído" vivía en localStorage (`orders-online-seen-at`), per-browser-per-device: no sincronizaba entre dispositivos y un browser nuevo/incógnito recontaba todos los `recibido`. Fix aplicado: columna `businesses.catalog_orders_read_at` (per-business), RPC `mark_catalog_orders_read()` llamada al abrir `/orders`, y `get_catalog_orders_unread_count()` (sin params) que cuenta `recibido AND created_at > catalog_orders_read_at`. Cliente (`UnreadBadge`/`OrdersView`) ya no usa localStorage. Migración `20260528_04_catalog_orders_read_at.sql`.

---

## P7h Audit Log — Pendiente

- **Fase 3:** revertir una mutación desde su entrada en `/activity` (undo desde cualquier evento).
- **Scope cut Fase 1:** ~~`ImportProductsModal` escribía `categories.icon_color` directo~~ ✅ — marcas y categorías ya pasan por `create_brand_guarded` / `create_category_guarded` (con `stock_write` + audit). **Lo que queda** es el path de **productos** del import masivo: `.upsert` (sku/barcode), `.insert` (plain) y `.delete` (undo) van directo a `products`, sin pasar por `create_product` ni audit log. Cerrarlo requiere un RPC de import masivo (upsert por sku/barcode + `stock_write` + audit) y el RPC de undo → es efectivamente **P8b** (`undo_import`). No es quick win.

---

## P7i — Redondeo de precios configurable (post-beta, nice-to-have prioritario)

> El nombre quedó dentro de la familia P7 por historia, pero conceptualmente no pertenece a P7. Es una feature de pricing independiente.

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

El owner sube un PDF o foto de la factura de una compra recién hecha y el sistema extrae los datos (proveedor, items, costos, cantidades) y prerellena el gasto de mercadería automáticamente; el owner sólo verifica y guarda. Encaja con el flujo de `/expenses` mercadería (`create_mercaderia_expense`, line-items por producto, update de stock/costo). Cobrando.app ya tiene algo así ("Escanear factura" con límite de escaneos/mes — 12/400). A definir: proveedor de OCR/extracción (modelo multimodal vía Edge Function), matching de items extraídos contra `products` existentes, manejo de productos no encontrados, límites por plan, y formatos/validaciones de input (JPG/PNG/WEBP/PDF, tamaño máx). Feature grande, alto valor percibido.

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
- **P12** — IA proactiva. Después de P11.3, usando el historial acumulado en `daily_snapshots` como contexto barato para el LLM.
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
| Permissions count | "9 campos" | 11 campos — `price_override` (10º) y `free_line` (11º) |
| `stats` permission | Listada como `stats` | Renombrada a `analysis` el 2026-05-16 (cubre dashboard, stats, /activity) |
| `audit_log` table | No documentada | Existe — append-only, P7h Fase 1+2 |
| Inventory mutation RPCs | Documentadas con escritura directa a tabla | Todas pasan por RPCs `SECURITY DEFINER` con audit log |

---

## Deuda técnica — Post-beta

| Item | Notas |
|------|-------|
| `InventoryPanel.tsx` (~1291L) | Extraer 5 sub-componentes embebidos |
| ~~`CartPanel.tsx` (~920L)~~ ✅ | `EditSalePanel` ya extraído a `src/components/pos/EditSalePanel.tsx`; `CartPanel` bajó a ~761L. |
| ~~Radix `DialogTitle` warnings~~ ✅ (2026-05-28) | Todos los `DialogContent` tienen `DialogTitle`. Faltaban 5 (`NewOperatorModal`, `EditOperatorModal`, `ExportPriceListModal`, `EditSupplierModal`, `ExpensesTable`); resueltos con `<VisuallyHidden><DialogTitle>` siguiendo la convención de `price-lists`. |
| `useEffect` para sales history en `CartPanel` | Patrón pre-React Query, no migrado |
| ~~`theme.tsx` FOUC~~ ✅ (2026-05-28) | Resuelto con script inline bloqueante en `<head>` (`ThemeScript.tsx`) que aplica la clase `dark` antes del primer paint, leyendo `localStorage` + `prefers-color-scheme`. Constante única `THEME_STORAGE_KEY` en `lib/theme.ts`. El efecto de círculo del toggle (View Transition) se extrajo a `runThemeToggleTransition` en `lib/theme.ts` y ahora lo usan tanto el sidebar como el toggle del catálogo público. |
| `!` assertions en env vars | En `client.ts` y `server.ts` |
| `CartItem` en `lib/types/index.ts` | Tipo client-only mezclado con tipos del server |
| `categories.public_read_categories` policy | Permite SELECT anon — OK para catálogo pero amplio |
| `DateRangeFilter.tsx` | `QUARTER_RANGES` recalcula en cada render. No-issue en práctica. |
| ~~`daily_snapshots` agrupa en UTC~~ ✅ (2026-05-28) | Resuelto en `20260528_05_daily_snapshots_tz_fix.sql`: las agregaciones de ventas ahora castean `(s.created_at AT TIME ZONE b.timezone)::date` (mirror de `get_sales_heatmap`). `refresh_daily_snapshot` / `refresh_all_daily_snapshots` resuelven "ayer" en la TZ local de cada negocio (default param → NULL). Re-backfill completo (DELETE + rebuild, tabla derivada) para evitar filas huérfanas del bucket UTC viejo. Verificado: 2 ventas nocturnas ART reasignadas al día local correcto; snapshots == agregado local-day exacto. |
