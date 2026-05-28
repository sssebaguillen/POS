# Pulsar POS — Backlog & Known Issues

> Trabajo pendiente, bugs conocidos, errores de CONTEXT.md y deuda técnica post-beta.

---

## DB Audit — Pendiente

| ID | Issue |
|----|-------|
| M-3 | `inventory_movements.created_by` no tiene FK activa y el trigger no lo popula. |

---

## Bugs conocidos

- **Badge de pedidos online no persiste el "leído" ✅** (2026-05-28) — el estado "leído" vivía en localStorage (`orders-online-seen-at`), per-browser-per-device: no sincronizaba entre dispositivos y un browser nuevo/incógnito recontaba todos los `recibido`. Fix aplicado: columna `businesses.catalog_orders_read_at` (per-business), RPC `mark_catalog_orders_read()` llamada al abrir `/orders`, y `get_catalog_orders_unread_count()` (sin params) que cuenta `recibido AND created_at > catalog_orders_read_at`. Cliente (`UnreadBadge`/`OrdersView`) ya no usa localStorage. Migración `20260528_04_catalog_orders_read_at.sql`.

---

## P7h Audit Log — Pendiente

- **Fase 3:** revertir una mutación desde su entrada en `/activity` (undo desde cualquier evento).
- **Scope cut Fase 1:** `ImportProductsModal.handleCreate` aún hace `.update({ icon_color })` directo sobre `categories` en vez de pasar por `update_category`. Mover a RPC.

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
| `CartPanel.tsx` (~920L) | `EditSalePanel` embebido — separarlo |
| Radix `DialogTitle` warnings | Agregar `<VisuallyHidden><DialogTitle>` a todos los modales |
| `useEffect` para sales history en `CartPanel` | Patrón pre-React Query, no migrado |
| `theme.tsx` FOUC | `localStorage` post-hydration causa flash — debería usar cookie como el sidebar |
| `!` assertions en env vars | En `client.ts` y `server.ts` |
| `CartItem` en `lib/types/index.ts` | Tipo client-only mezclado con tipos del server |
| `categories.public_read_categories` policy | Permite SELECT anon — OK para catálogo pero amplio |
| `DateRangeFilter.tsx` | `QUARTER_RANGES` recalcula en cada render. No-issue en práctica. |
| `daily_snapshots` agrupa en UTC | `upsert_daily_snapshot` usa `s.created_at::date` (UTC). Una venta a las 22:00 ART cae al snapshot del día siguiente. P11.3 (heatmap) ya respeta `businesses.timezone`; el re-backfill de `daily_snapshots` con TZ correcta se difiere para evitar shift de valores ya consumidos en prod. |
