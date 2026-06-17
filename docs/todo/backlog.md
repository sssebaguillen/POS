# Pulsar POS — Backlog & Known Issues

> Trabajo pendiente, bugs conocidos, errores de CONTEXT.md y deuda técnica post-beta.

---

## 🤖 Gestión automática — reglas de juego

> Este backlog lo trabaja también un **agente programado** (schedule remoto). Para que sea seguro sin supervisión, cada item abierto lleva un tag de elegibilidad y el agente respeta un protocolo estricto.

**Tags de elegibilidad** (solo en items abiertos; los ✅ resueltos no se tagean):

- **🤖 SCHEDULE-OK** — decisión ya tomada, scope claro, bajo riesgo, cubierto por la suite de tests. El agente puede tomarlo solo.
- **🔒 NEEDS-OWNER** — requiere dirección/decisión del dueño en vivo. **Fuera del schedule.**

**Default-deny:** un item **sin tag `🤖 SCHEDULE-OK` explícito NO es elegible** para el agente automático — aunque no lleve `🔒 NEEDS-OWNER`. El `🔒` se usa solo para resaltar los casos donde la tentación de automatizar es alta pero NO se debe. En la duda sobre si algo es elegible: no lo es.

**Protocolo del agente automático (innegociable):**

1. **Solo trabaja items `🤖 SCHEDULE-OK`.** Nunca toca un `🔒 NEEDS-OWNER`.
2. **Ante cualquier ambigüedad o decisión de producto/arquitectura: NO asume.** La anota en la sección "⚠️ Preguntas del agente automático" de abajo (fecha · item · la duda · opciones) y **deja ese item sin avanzar** hasta que el dueño decida.
3. **Nunca mergea a master.** Todo queda en rama + PR para revisión.
4. **No aplica migraciones a la DB** (eso lo decide el dueño; nunca `supabase db push`). Si un item necesita SQL, el agente crea el archivo de migración y lo deja en el PR + mantiene `supabase/schema.sql` en sync, sin aplicarlo.
5. **Camino del dinero / auth / onboarding / schema de ventas:** verificar con la suite E2E antes de cerrar el PR.
6. **Batching de PRs — un PR por cluster cohesivo, no un PR gigante:**
   - Cada PR cubre **un cluster cohesivo** (un item, o varios que comparten archivos/tema). Nunca juntar todo el backlog en un PR (irrevisable, no se puede bisectar, un item estacionado bloquea al resto).
   - **Si dos clusters tocan los mismos archivos, se hacen SECUENCIALES** (el segundo se rebasa sobre el primero), **nunca en paralelo** — así no hay conflictos de merge. Ej.: el cluster POS/Cart (`CartPanel`/`POSView`) y `/stats` (segmentación → tarjeta promos) van encadenados.
   - Clusters de archivos disjuntos pueden ir en PRs independientes (paralelos sin conflicto).
   - PR título claro + descripción con: qué item(s) del backlog cubre, qué verificó (tsc/lint/tests/E2E), y si dejó algo flagueado en "⚠️ Preguntas".
   - Mapa de clusters sugerido: ver "Auditoría del camino del dinero" y los items 🤖 — agrupar por file-locality.
7. **Retomar sin duplicar:** antes de empezar, listar PRs/ramas abiertas (`gh pr list`) y lo ya mergeado para no rehacer trabajo ni pisar un PR en revisión. Continuar donde quedó.
8. **Orden de prioridad:** primero quick wins (docs/lint/env) + items con plan escrito (004/005); después el resto de deuda técnica; las features (segmentación, tarjeta promos, lista catálogo) al final, porque son las que más probablemente se estacionen esperando decisión.

---

## ⚠️ Preguntas del agente automático (pendientes de decisión del dueño)

> El agente automático anota acá lo que necesita que decida Sebastián. Cada entrada: `[fecha] item — la duda — opciones`. Vaciar a medida que se resuelven en sesión en vivo.

- **[2026-06-17] `useEffect` para sales history en `CartPanel` — el target literal no existe.** El item pide "migrar a React Query el `useEffect` de sales history en `CartPanel`", pero hoy `CartPanel` tiene **un solo `useEffect`** y es el **typeahead de búsqueda de clientes** (debounced ilike sobre `customers`), no un fetch de historial de ventas. No hay `get_sales_history` ni `from('sales')` en `CartPanel`/`EditSalePanel`/`POSView` (el historial de ventas vive en `dashboard/SalesHistoryTable`, ya en React Query). **Opciones:** (a) el target real era el typeahead de clientes → migrarlo a `useQuery` es mecánico y limpio, pero `CartPanel` es camino del dinero → exige E2E verde (la suite necesita stack Supabase local/Docker, no disponible en el runner del schedule); (b) el fetch de sales history ya se migró/removió en la extracción de `EditSalePanel` y el item quedó **resuelto** → confirmar y cerrarlo. **No avanzo sin decisión** (mismatch de premisa + camino del dinero sin E2E ejecutable acá).
- **[2026-06-17] Lista de precios del catálogo — comportamiento al borrar/archivar la lista configurada.** La implementación actual hace fallback silencioso a precio base (la query `SELECT INTO` de `price_lists` no matchea → `v_list_id = NULL` → precio base). **Opciones:** (a) dejar el fallback silencioso (simple, sin riesgo, el dueño re-elige cuando quiera); (b) bloquear el borrado de una lista que esté configurada como lista de catálogo (más defensivo, requiere check en `delete_price_list`); (c) mostrar un aviso en `/settings` si la lista configurada ya no existe (UX intermedia). **No es bloqueante para el PR** — el fallback es seguro.
- **[2026-06-17] Lista de precios del catálogo — qué mostrar en el selector.** Hoy el selector muestra solo `name` de cada `price_list`. **Opciones:** (a) quedarse así (simple, suficiente); (b) mostrar también el multiplicador base (`×1.30`); (c) mostrar overrides count (requiere fetch adicional). **No es bloqueante.**
- **[2026-06-17] Segmentación POS vs Pedido online en stats/dashboard — la premisa del item está desactualizada.** El item asume que `SalesHistoryTable` "filtra 100% en memoria → sumar `source` al filtro existente, sin RPC nueva". **Ya no es así:** `SalesHistoryTable` migró a paginación server-side por cursor con `useInfiniteQuery` sobre la RPC `get_sales_history` (filtra `p_method`/`p_operator_id`/`p_search` en el servidor; los totales/`summary` también vienen del server). Un filtro `source` puramente in-memory sería **incorrecto** (solo filtraría las páginas ya cargadas y rompería el conteo/total del summary). Para hacerlo bien hace falta agregar `p_source` a `get_sales_history` (= **migración** + sync de `schema.sql`), lo que **contradice el "sin RPC nueva / sin migración"** del item. Idem `/stats`: `StatsView` consume agregados por RPC, no ventas crudas → el split POS/catálogo casi seguro necesita agrupar por `source` en una RPC server-side. **Opciones:** (a) autorizar una migración que sume `p_source` a `get_sales_history` (+ la RPC de stats que corresponda) y rehacer el item con ese scope; (b) dejar el item en pausa hasta que haya volumen real que lo justifique. **No avanzo sin decisión** (toca el render del historial de ventas / camino del dinero → además exige E2E).

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
- **🤖 SCHEDULE-OK (de a uno) — Inmutabilidad de nombres en el detalle del audit log (priority low):** la capa de detalle resuelve IDs→nombres contra los lookups (`productMap`/`categoryMap`/`brandMap`/`customerMap`) **en read-time**, así que un rename/borrado posterior hace derivar el nombre mostrado (debería reflejar el estado al momento del evento). ✅ **Resuelto para acciones masivas** (`bulk_set_product_status`/`bulk_update_product_category`/`bulk_update_product_brand`) — snapshotean `{id, name}` vía `UPDATE … RETURNING` en `old_data.products`; el frontend prefiere el snapshot y cae a `productMap` para entradas viejas (mig. `20260529_13`). ✅ **Resuelto para producto individual create/delete** (PR auto/audit-product-name-snapshot, 2026-06-17): `create_product`/`delete_product` snapshotean `category_name`/`brand_name` (mig. `20260617_01`, sin aplicar — la aplica el dueño); `ProductSummary` prefiere el snapshot y cae a los lookups. ✅ **Resuelto para producto individual editado** (PR #11 auto/audit-update-product-snapshot, 2026-06-17): `update_product` snapshotea `category_name`/`brand_name` en `old_data` (siempre) y `new_data` (solo si cambió); `formatProductField` prefiere el snapshot con fallback al lookup. Mig `20260617_02`, sin aplicar. **Pendiente (mismo patrón, no urgente):** ventas (cliente + nombres de ítems, `sale.tsx:25,62,289`), entity labels (`EntityGlyph.tsx:39`, `ActivityRow.tsx:76`). Atacar de a uno. Decidido fasearlo (2026-05-29). **Alcance para el agente automático:** el patrón snapshot ya está probado en bulk + producto individual create/delete; aplicarlo a `update_product` es SCHEDULE-OK (un PR, ojo con el renderer de diff). El **RPC de ventas** toca el camino del dinero → **NO automatizar; marcar en "⚠️ Preguntas" si se quiere encarar** (refactor mayor, mejor en vivo).
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

### Ofertas y descuentos en el catálogo — ✅ MÓDULO SHIPPED (2026-06-10)

**Implementado completo (F1–F5)** — plan, semántica y estado en [`promotions.md`](promotions.md); reglas en CLAUDE.md §Promociones + regla 36. Tipos: % / precio de oferta / 2x1-3x2 / 2da unidad al X% (modelo N/K/P). `/promotions` + POS + catálogo (sección Ofertas, badges, countdown, checkout re-precia server-side) + audit + snapshots para P12. Invariantes R1/R12 en `06-reconciliacion.sql`, verificados al centavo en vivo.

**Pendientes derivados (post-módulo):**
- **Quick win acordado:** segmentación POS vs catálogo en stats (`sales.source` ya existe — ver ítem en P-Phases).
- **~~🤖 Tarjeta de impacto de promos en `/stats`~~ ✅ (verificado 2026-06-17)** — ya implementada: `StatsView.tsx` llama la RPC `get_promo_impact` (mig. `20260612_02`) en su `Promise.all`, deriva `promoTotals` y renderiza la tarjeta en el rango del `DateRangeFilter`. No requirió RPC nueva (la de agregación ya existía). Queda solo el smoke UI en browser (sub-bullet de abajo). Detalle histórico del item:
  - **Criterios de aceptación:**
    1. Tarjeta/KPI en `/stats` (en el rango de fechas activo del `DateRangeFilter` de la página) con: total descontado en promos (`Σ promo_discount`), cantidad de ventas con promo (`promo_sales_count`), y % de ventas que usaron promo.
    2. Preferir leer de `daily_snapshots` (ya agregado por día) sobre escanear `sale_items` en vivo, para mantener el patrón de las otras tarjetas de `/stats`.
    3. Si los snapshots NO traen el detalle por promo y se necesita una RPC nueva de agregación: **es decisión de scope → marcar en "⚠️ Preguntas", no asumir** (rango de RPC nueva guardada con regla 34 vs. leer snapshots existentes).
    4. Money: la tarjeta es **informativa**; no tocar `sales.discount` ni la semántica de líneas netas (regla 36).
  - Empezar por verificar exactamente qué columnas de `daily_snapshots` están pobladas antes de diseñar la lectura.
- **Engagement del catálogo (vistas/clics para el dueño):** diferido hasta tener tráfico real; requiere storage propio agregado (PostHog es analytics nuestro, el dueño no lo ve).
- **Detector P12:** "la promo X no mueve ventas / duplicó rotación" — sale de las columnas de snapshot ya creadas.
- **Smoke UI en browser pendiente** (el smoke fue server-side: RPCs al centavo + build/tsc/lint): crear una promo de cada tipo desde `/promotions` y verla en POS y catálogo.
- v2 diferida: 2x1 *cruzado* (combinatoria multi-producto), precio de oferta por variante, redondeo configurable del % de promo.

### Catálogo público — pulido de diseño pendiente (2026-06-10)

> Contexto: ronda de conversión post-critique del catálogo ✅ (2026-06-10, commit `976e991`, changelog `0.0.8`): carrito mobile = bottom sheet + barra inferior fija con total; link `wa.me` explícito tras enviar el pedido (popup blockers de iOS Safari); `error.tsx`/`not-found.tsx`/`loading.tsx` propios de `/catalogo`; aclaración "no pagas ahora" en el checkout; voseo→tuteo en errores; `type="tel"`/`inputMode`/`autocomplete` en el form; subtotal redundante eliminado; verde unificado en `emerald`. Queda el pulido de diseño:

- ✅ **(2026-06-11) Shell del catálogo + tokenización del verde.** `CatalogShell` (contenedor de scroll — el body global tiene `overflow:hidden` — + contexto de carrito compartido entre las 3 páginas, cart sheet global bottom/right, barra mobile "Ver pedido" en todas las páginas), `CatalogNavbar` sticky (logo+nombre, nav Inicio/Ofertas, theme toggle, carrito con badge), `CatalogSearch` (typeahead con dropdown anclado al input — imagen, nombre, categoría · marca, variantes, precio con promo — navega al detalle, NO filtra la grilla; en detalle/promos trae los datos lazy vía RPCs anon), `CatalogFooter` (negocio + nav + WhatsApp; sin "creado con Pulsar" hasta cerrar el rebrand). El detalle de producto quedó con navbar/carrito/footer (cerrado el hallazgo P2 del critique). `CatalogHeader` eliminado. Tokens `--promo`/`--promo-foreground` en globals.css; cero `emerald-*` hardcodeado en el catálogo.
- **Sección Ofertas/destacados de la main page:** el contenedor del carrusel usa fondo `--promo` traslúcido (mismo lenguaje que los badges de éxito) — no es el diseño correcto para esta sección. Rediseñar el tratamiento visual del hero de ofertas (`OffersCarousel.tsx`).
- **~~🤖 Menores del critique: touch targets~~ ✅ (verificado 2026-06-17)** — ya resueltos: `VariantQuickSelector` recibe `touchOptimized` (true en mobile vía `ProductCard`), con swatches `h-11 w-11` (44px) y opciones `px-4 py-2.5` en táctil; los dots del carrusel (`OffersCarousel`) tienen área de toque `h-8` (32px) con el indicador visual `h-1.5` adentro. Los quantity steppers y el botón quitar del carrito usan `h-11 w-11` en mobile. (El "filtros ocultos por default en desktop" SÍ es decisión de UX → sigue fuera, NEEDS-OWNER.)
- **~~🤖 Accesibilidad del catálogo público~~ ✅ (verificado 2026-06-17)** — los 4 criterios ya se cumplen en `src/components/catalog/`: (1) las 7 `next/Image` (producto/logo) tienen `alt` descriptivo (nombre del producto/negocio); no quedan `<img>` crudos. (2) Los ~12 botones solo-ícono (carrito, theme toggle, flechas y dots del carrusel, hamburger, quitar/sumar/restar del carrito, badge de variantes, limpiar búsqueda) tienen `aria-label`. (3) Los 5 inputs del checkout (`CartPanel`) tienen `<label htmlFor>` asociado. (4) Sin `outline-none`/`focus:outline-none` sin reemplazo `focus-visible`/`focus:ring`. Auditado componente por componente; nada que cambiar.
- **~~🤖 Higiene de tokens del catálogo~~ ✅ (verificado 2026-06-17)** — barrido confirmó **cero** colores Tailwind hex/rgb hardcodeados en `src/components/catalog/` fuera del mapa semántico de `VariantQuickSelector` (la excepción explícita, intacta). Ningún `emerald-/amber-` suelto. La tokenización quedó cerrada en el commit del 2026-06-11 (`--promo`/`--promo-foreground`). Nada que cambiar.
  - **EXCEPCIÓN explícita (sigue vigente):** el mapa de colores de `VariantQuickSelector` (rojo→#ef4444, azul→#3b82f6, …) NO se toca — son colores semánticos de variantes que deben verse igual en cualquier tema.

### ~~🤖 Lista de precios del catálogo configurable~~ ✅ (implementado 2026-06-17)

Migración `20260617_02_catalog_price_list_setting.sql`: las 3 RPCs de catálogo (`get_catalog_products`, `get_catalog_product_with_variants`, `create_catalog_order`) ahora leen `businesses.settings->>'catalog_price_list_id'` y pasan `v_list_id`/`v_list_mult` a `compute_effective_price` en vez de NULL. Si la lista no existe o se borró, la query `SELECT INTO` no matchea → `v_list_id` queda NULL → fallback automático a precio base (sin error). Selector en `/settings` tab Catálogo vía `SelectDropdown` con opción "Precio base (sin lista)". Saved via `update_business_settings` con spread-merge (regla 22). Schema.sql en sync. tsc + lint limpios. **Migración NO aplicada a DB** (regla 4).

- **Decisiones pendientes (flagueadas en ⚠️ Preguntas):**
  - Qué pasa si la lista elegida se **archiva/borra** después. Hoy: fallback silencioso a precio base (query no encuentra la lista → NULL).
  - Si el selector debe mostrar el override por marca/producto de la lista o solo el nombre.

### 🔒 NEEDS-OWNER — Temas del catálogo (presets de diseño por negocio) — post-rebrand

> Planteado 2026-06-16. Idea grande; la dirección inicial es **dejar solo las bases**, no construir el sistema completo.

**Visión:** que el dueño elija un **tema** para su catálogo público según su rubro — ej. "Tienda de ropa", "Almacén/Kiosco", "Genérico/Estándar" (y a futuro: ferretería, gastronomía, etc.). Cada tema = paquete curado de tokens (paleta, tipografía, radios/sombras, quizá densidad y layout de grilla). Más adelante, opcionalmente, customización fina (colores/logo/tipografía a medida).

**Qué existe hoy (NO confundir):**
- `CatalogThemeProvider` maneja **solo claro/oscuro**, no presets visuales.
- Personalización ya disponible: `businesses.settings.primary_color` (configurable en `/settings`, aplicado en `layout.tsx`). El sistema de diseño ya usa tokens CSS (`--primary`, `--promo`, …) con valores claro/oscuro en `globals.css`; el catálogo ya tokenizó el verde.
- O sea: "elegir color principal" ya está; falta el concepto de **tema = bundle** y el de **tema default** explícito.

**Dirección acordada (no implementar aún):**
- Arrancar con **el diseño actual como "tema default"**, dejándolo como **tema configurable** (un solo valor hoy, ej. `businesses.settings.catalog_theme = 'default'`), para sumar más temas después sin re-arquitectura.
- **Presets curados primero**, NO customización total. La customización libre (color/logo/tipografía a elección) es mucho más cara: contraste/accesibilidad (WCAG), paridad claro/oscuro, carga/peso de fuentes, y matriz de QA por combinación. Diferir hasta tener demanda real.

**Por qué NEEDS-OWNER / por qué diferida:**
1. **Depende del rebrand** ([[project_naming_rebrand]], bloqueante de go-to-market): tipografía/logo/colores son decisiones de marca; el footer del catálogo ya esconde "creado con Pulsar" esperando esto. Construir el sistema de temas antes de cerrar la marca es construir sobre arena.
2. **Pre-beta sin usuarios** ([[project_estado_beta]]): es diferenciador, no blocker de validación.
3. **YAGNI con N=1:** la abstracción de tokens hay que extraerla de **dos temas reales** diseñados en concreto, no adivinarla con uno solo. Diseñar el 2º tema antes de generalizar.

**Lo único que paga sin riesgo desde ya (no requiere decidir nada):** seguir la **higiene de tokens** (cero colores hardcodeados en el catálogo, todo vía variable CSS). Eso es deuda técnica acotada y es prerequisito natural de cualquier theming futuro — podría tagearse 🤖 SCHEDULE-OK por separado si se quiere avanzar la base sin tocar arquitectura.

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
- **⏸️ EN PAUSA (flagueado 2026-06-17, ver "⚠️ Preguntas") — Segmentación POS vs Pedido online en stats/dashboard** (2026-05-29) — la columna `sales.source` (`'pos' | 'catalog'`) ya existe y se setea en la conversión de pedidos del catálogo, pero **no está expuesta** en la UI. El dato ya se captura desde ahora; solo falta mostrarlo. (Ventas históricas pre-columna quedan como `'pos'`; las que vinieron de pedidos siguen identificables vía `catalog_orders.sale_id`.) **El criterio 1 asume filtrado in-memory que ya no existe** (`SalesHistoryTable` migró a paginación server-side por RPC); ver la entrada de "⚠️ Preguntas" — necesita decisión de scope (migración para `p_source`) antes de avanzar.
  - **Criterios de aceptación:**
    1. Filtro de canal (chip, patrón regla 17: `Todos / Mostrador / Pedido online`) en el historial de ventas de `/dashboard` (`SalesHistoryTable.tsx`, que ya filtra 100% en memoria → sumar `source` al filtro existente, sin RPC nueva).
    2. Misma segmentación en `/stats` donde haya desglose de ventas (al menos un KPI o split visible POS vs catálogo).
    3. El export CSV de esas tablas incluye una columna "Canal" (`Mostrador`/`Pedido online`).
    4. Labels en español neutro (sin voseo, regla [[feedback_evitar_voseo]]): "Mostrador" para `pos`, "Pedido online" para `catalog`.
  - **Sin migración** (el dato ya existe). Si para `/stats` hiciera falta agrupar por `source` en una RPC server-side y no alcanza con filtrar en memoria → eso ES una decisión de scope: **marcarlo en "⚠️ Preguntas" y no asumir** (preferencia por solución in-memory si los volúmenes lo permiten).
  - **Verificar:** que el historial y los export sigan cuadrando (no romper totales); correr E2E si se toca el render del historial.

---

## Límites del flujo de creación (a tener en cuenta)

- **`NewProductModal` con variantes** exige que cada variante activa tenga `price > 0`. La regla de pricing (`compute_effective_price` / `calculateProductPrice`) soporta `price = 0 && cost > 0` → `cost × multiplicador`, pero ese estado **no es alcanzable por UI normal**. Sólo llegaría por importación masiva (P8b) o inserción manual en DB.

---

## CONTEXT.md — Discrepancias con la DB en vivo

> **✅ (2026-06-17) Reconciliado contra `supabase/schema.sql`.** Las 20 filas se verificaron una a una contra el dump del schema y se corrigieron en los docs (`CONTEXT.md`, `docs/db.md`, referencias en `CLAUDE.md`). Solo markdown — no se tocó código ni schema. Detalle de cada corrección abajo; la tabla de discrepancias quedó vacía (todas alineadas).
>
> **Dos filas de la tabla original tenían la columna "Realidad" equivocada** (la verdad la fijó `schema.sql`, no el claim previo):
> - `payments.method`: el claim decía "sólo `cash,card,transfer,mercadopago`" pero el CHECK del schema **incluye `credit`** (excluye `otro`). Docs corregidos a 5 valores. Consistente con CLAUDE.md regla 33 (`credit` excluido solo para pedidos online anónimos, no del CHECK).
> - `stats` permission: el claim decía "renombrada a `analysis`". La realidad en el modelo de 8 capacidades (2026-06-09) es **`reports`** — `proxy.ts` gatea con `'reports'` y un test documenta "reports replaces old 'analysis'". `analysis` fue un nombre intermedio ya muerto. Se corrigieron las 3 referencias `analysis` en CLAUDE.md → `reports`.
>
> Correcciones aplicadas: Project ID (typo `zrnthycz…`→`zrnthcz…` en CONTEXT.md), `businesses.accounting_enabled` (no existe — removido), `businesses.settings` keys (`currency`/`logo_upload_path`/`ai_insights_enabled`), `profiles.onboarding_state` (agregado), `sales.status` CHECK (`completed/cancelled/refunded` + columna `source`), `cash_sessions` (`difference` no existe; `notes`+`status` sí), `payments.status` (`refunded/cancelled`, no `failed`), `expense_items` y `audit_log` (secciones agregadas), `inventory_movements` (`reason`/`reference_id`/`variant_id` agregados; `created_by` eliminado M-3), `undo_import` (no existe — removido, P8b), `update_expense`/`create_mercaderia_expense`/`update_mercaderia_expense`/`update_product_variants`/`create_product_with_variants`/`compute_effective_price` (agregados a la tabla de funciones), permisos (modelo de 8 capacidades reescrito), `invoices` (marcada NOT-IN-SCHEMA en ambos docs — P10.b diferida), RPCs de inventario (ya documentadas correctas con SECURITY DEFINER + audit).

---

## Deuda técnica — Post-beta

| Item | Notas |
|------|-------|
| ~~`InventoryPanel.tsx` dropdown del header + footer stats~~ ✅ (2026-06-09, commit `ea562d6`) | Dropdown responsive del header extraído a `src/components/inventory/HeaderActionDropdown.tsx` (mide posición al abrir → estado, sin leer ref en render); footer stats memoizadas sobre `products`. InventoryPanel bajó de 1456 a 1327 líneas. Smoke-test desktop+mobile OK. |
| ~~`CartPanel.tsx` (~920L)~~ ✅ | `EditSalePanel` ya extraído a `src/components/pos/EditSalePanel.tsx`; `CartPanel` bajó a ~761L. |
| ~~Radix `DialogTitle` warnings~~ ✅ (2026-05-28) | Todos los `DialogContent` tienen `DialogTitle`. Faltaban 5 (`NewOperatorModal`, `EditOperatorModal`, `ExportPriceListModal`, `EditSupplierModal`, `ExpensesTable`); resueltos con `<VisuallyHidden><DialogTitle>` siguiendo la convención de `price-lists`. |
| ⏸️ EN PAUSA (flagueado 2026-06-17, ver "⚠️ Preguntas") `useEffect` para sales history en `CartPanel` | El target literal no existe: `CartPanel` solo tiene el `useEffect` del typeahead de clientes (no hay fetch de sales history). O bien el item se refiere a ese typeahead (migración mecánica pero camino del dinero → E2E, no ejecutable en el runner), o el fetch ya se migró/removió en la extracción de `EditSalePanel` y está resuelto. Necesita decisión. |
| ~~`theme.tsx` FOUC~~ ✅ (2026-05-28) | Resuelto con script inline bloqueante en `<head>` (`ThemeScript.tsx`) que aplica la clase `dark` antes del primer paint, leyendo `localStorage` + `prefers-color-scheme`. Constante única `THEME_STORAGE_KEY` en `lib/theme.ts`. El efecto de círculo del toggle (View Transition) se extrajo a `runThemeToggleTransition` en `lib/theme.ts` y ahora lo usan tanto el sidebar como el toggle del catálogo público. |
| ~~🤖 `!` assertions en env vars~~ ✅ (verificado 2026-06-17) | `client.ts` y `server.ts` ya validan explícito: `if (!url || !key) throw new Error('Missing Supabase env vars')`. Sin `!` non-null assertions. Nada que hacer. |
| 🔒 NEEDS-OWNER `protobufjs <=7.5.7` (npm audit, HIGH) | Transitiva vía `@sentry/nextjs` → `@opentelemetry/otlp-transformer`. **Riesgo real bajo**: es el transporte OTel de Sentry (serializa telemetría propia, no input de atacante), así que los CVE de DoS/inyección por protobuf malicioso no aplican. `npm audit fix` NO es quirúrgico (cambia 12 paquetes + warning de downgrade breaking de next). Si se ataca: `overrides` forzando solo protobufjs a 7.5.8+ y verificar con build. Decidido 2026-05-29: dejar, no urgente. |
| ~~`react-hooks/refs` en InventoryPanel/POSView (19 errores)~~ ✅ (2026-06-09, commit `ea562d6`) | Resueltos los 19: los 16 de InventoryPanel desaparecieron al extraer `HeaderActionDropdown` (mide al abrir → estado); los 3 de POSView (`itemCountRef`/`itemsRef`/`confirmingNewSaleRef` sincronizados en render) movidos a un `useEffect` de sync. Quedan `set-state-in-effect` (otra regla, deuda aparte: deep-link/scroll de InventoryPanel, patrón mounted del sidebar). |
| ~~`CartItem` en `lib/types/index.ts`~~ ✅ (2026-06-09, commit `0716e08`) | Movido a `src/lib/types/cart.ts` (CartItem + getCartItemId). Separado del modelo de entidades del server; consumidores (cart.store, price-lists, POSView, CartPanel) importan de `@/lib/types/cart`. |
| ~~Consolidación de toasts~~ ✅ (2026-06-09, commit `fab5ddd`) | `ToastProvider` global único (un solo `<Toast>` en `(app)/layout`); `useToast()` degrada a no-op fuera del provider (Sidebar también se monta en operator-select); ~14 call sites migrados; `FlashToast`/`NewOrderNotifier` unificados; variant `warning` tokenizado a `--warning`. |
| 🔒 NEEDS-OWNER `categories.public_read_categories` policy | Permite SELECT anon — OK para catálogo pero amplio. Endurecerla toca RLS de seguridad multi-tenant → revisar juntos. |
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

---

## Auditoría del camino del dinero (2026-06-12) — pendientes

> Auditoría con la skill `improve` (4 subagentes, scope: POS → precios/promos → catálogo → pedidos → caja). Planes autocontenidos en `plans/` (commiteados). Ejecutados y en producción el mismo día: 002 (xlsx→@e965/xlsx), 003 (hono fuera), 006 (lint verde), 001 v2 (suite cloud integrada: **387 tests + CI "Tests / Unit tests" en cada PR**, PR #7). Hallazgos descartados documentados en `plans/README.md` ("considered and rejected") — no re-auditar.

**Pendientes con plan escrito (ejecutar con el flujo executor+review o a mano):**
- **~~🤖 Plan 004 — Re-asentar REVOKE/GRANT~~ ✅ (ejecutado 2026-06-13, migración aplicada)** — ver `plans/README.md`.
- **~~🤖 Plan 005 — Centralizar `round2`~~ ✅ (ejecutado 2026-06-13)** — ver `plans/README.md`.

**Deuda derivada de la sesión (sin plan, anotar nomás):**
- **🤖 SCHEDULE-OK (de a uno) — Refactor selectivo de los 19 `react-hooks/set-state-in-effect`** (hoy en `warn`, decisión 2026-06-12, comentado en `eslint.config.mjs`): mounted pattern (regla 25) + reset-de-estado-al-abrir-modal. Con la suite de tests como red ya se puede encarar de a poco; prioridad: POSView/CartPanel (camino del dinero). Son además los componentes que React Compiler no optimiza. **Un componente por PR** (no batch — facilita revisión y aísla regresiones); los que tocan el camino del dinero (POSView/CartPanel) exigen E2E verde antes de cerrar.
- **~~🤖 Lint warnings de `.agents/`~~ ✅ (resuelto 2026-06-17, commit `c8a8def`)**: `.agents/**` agregado a `globalIgnores` de eslint.
- **🔒 NEEDS-OWNER — Deploy Vercel ~3m20** (analizado 2026-06-12, sano para el tamaño de la app): si se quiere afeitar → (a) subir sourcemaps de Sentry solo en producción (hoy corre en previews), (b) probar `next build --turbopack`. Toca config de build/CI → decisión del dueño.
- **~~🤖 Doc drift en CLAUDE.md~~ ✅ (verificado 2026-06-17)**: ambos sub-items ya estaban corregidos en `master` — CLAUDE.md referencia `docs/todo/backlog.md` (no `docs/backlog.md`) y dice "polled every 10s" / "polls every 10s" (no 30s). Nada que hacer.
