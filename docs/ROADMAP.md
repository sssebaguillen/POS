# Pulsar POS — Roadmap

> **Para Copilot:** Este archivo documenta el estado de cada fase del producto, qué está en scope ahora, y qué viene después. Usalo para entender qué features están activos, cuáles están pendientes y cuáles son futuros. No implementes features de fases futuras a menos que se pida explícitamente.

---

## Estado actual: Closed beta / pulido (2026-06-06)

**Fases P0–P12 completas.** El sistema está en closed beta con un negocio activo. **No hay beta blockers abiertos** — los tres que figuraban acá (pago mixto, UI de caja, cliente en el POS) están shipped, igual que cuentas corrientes (P8), fundación fiscal (P10.a), analytics avanzado (P11) e IA proactiva ambiente (P12).

### Prioridad estratégica inmediata

El cuello de botella **no son features — es validación/confianza, y todavía no hay usuarios reales.** Por eso el foco no es construir un módulo nuevo, sino:

1. **Pulido de lo existente** — nada bloquea, pero quedan items de UX/claridad (rediseño de permisos a 8 flags, segmentación POS vs catálogo en stats, etc.). Ver `docs/todo/backlog.md`.
2. **Definir el nombre real del producto** — "Pulsar" tiene problemas de naming; el más serio es que `pulsar.lat` ya está ocupado por un sistema de gestión de negocios similar. Decisión pendiente: ¿rebrand? (ver `docs/todo/` cuando se documente).
3. **Conseguir usuarios reales / validación** — es lo de mayor ROI ahora, por encima de cualquier feature net-new.

Construir infraestructura pesada (contable, facturación) sigue gateado a demanda real.

### Gate para activar P10 contable completo

- 3–5 negocios activos usando el producto semanalmente
- 2 negocios pidiendo explícitamente contabilidad o facturación electrónica
- 1 negocio dispuesto a pagar por esas capacidades

---

## Fases completadas ✅

### P0 — Prototipo HTML estático
Validación de flujo completo (carrito, pago, caja) sobre un caso de uso real: "De Todo Sin TACC", San Rafael, Argentina.

### P1 — Fundación técnica
Stack: Next.js App Router + TypeScript + Tailwind + shadcn/ui + Supabase + Vercel.  
Auth via `proxy.ts` (no `middleware.ts`). `businessId` siempre de `profiles.business_id`. RLS habilitado en todas las tablas desde día 1.

### P2 — POS funcional
Flujo de venta completo. Carrito con Zustand (`lib/store/cart.store.ts`). `PaymentModal` con métodos: `cash`, `card`, `transfer`, `mercadopago`, `otro` (siempre en inglés en DB — labels en `lib/payments.ts`). Trigger `update_stock_on_sale` en PostgreSQL.

### P3 — Inventario
`InventoryPanel.tsx` — tabla de productos con filtros, búsqueda, acciones inline. Marcas como entidades propias (`brands` table + `brand_id` FK en `products`). Schema de imágenes preparado (`image_url`, `image_source`, bucket `product-images`), UI pendiente.

### P4 — Operadores y PIN
Tabla `operators` con roles `manager | cashier | custom`. PINs hasheados con bcrypt via `pgcrypto` (requiere `set search_path = public, extensions`). Cookies `operator_session` + `op_perms`. Vista `/operator-select`.

### P5 — Listas de precios
Tablas `price_lists` + `price_list_overrides`. Fórmula única en `lib/price-lists.ts`: `cost × (product_override ?? brand_override ?? list.multiplier)`. UI muestra %, DB guarda multiplier. `swap_default_price_list` RPC atómica.

### P6 — Permisos expandidos
8 campos booleanos: `sales`, `stock`, `stock_write`, `stats`, `price_lists`, `price_lists_write`, `settings`, `expenses`. `OWNER_PERMISSIONS` en `lib/operator.ts`. Catálogo público vía RPCs `get_catalog_products` + `get_catalog_categories` (GRANT TO anon).

### P7a — Hardening y seguridad
`get_business_id()` como STABLE + SECURITY DEFINER + `(select auth.uid())`. 12 FK indexes. Bug crítico `update_sale` resuelto (doble descuento de stock). Módulo gastos: tablas `suppliers` + `expenses`, ENUMs `expense_category` + `expense_attachment_type`, bucket privado `expense-receipts`. Región Vercel migrada a `gru1` (São Paulo).

### P7b — Barcode + Impresora térmica
Búsqueda y escaneo por barcode USB (lector actúa como teclado, envía código + Enter). `ReceiptTemplate.tsx` con `@media print` para impresora térmica 58mm/80mm via `window.print()`.

---

## En desarrollo / próximo

### P7b.3 — Cierre de caja imprimible ✅
UI de `cash_sessions` shipped: apertura/cierre, RPC `get_session_summary`, widget en sidebar (`CashSessionWidget`), historial (`CashSessionsView`) y detalle (`SessionDetailPanel`).

### P7c — Tests automatizados (pendiente)
- **P7c.1** — SQL tests con pgTAP: verificar RLS, triggers, RPCs
- **P7c.2** — Playwright E2E: flujo de registro, venta, operador, edición de venta, listas de precios
- Único bloque relevante del roadmap que sigue sin arrancar. No bloquea, pero es la red de seguridad antes de escalar usuarios.

### P7d — Price override por línea en el POS ✅
Shipped. `sale_items.unit_price_override` + `override_reason`, permiso `price_override`, guard server-side en `create_sale_transaction` (mig `atomic_credit_and_price_override_guard`). UI de "Editar precio" por línea en `CartPanel`.

---

## Fases — hechas y futuras

### P8 — Cuentas corrientes de clientes ✅
Shipped + ledger append-only `customer_account_movements` (charge/payment/opening con `balance_after`). `credit_limit` + `is_credit_enabled`, método `credit` en `PaymentModal`, ruta `/customers`, RPC `settle_customer_credit`. Detalle en `docs/todo/customer-account-ledger.md`.

### P9 — Órdenes de compra / módulo Compras (pendiente)
Tablas `purchase_orders` + `purchase_order_items`, RPC `receive_purchase_order`, ruta `/purchases`. Hoy lo cubre **a medias** el gasto-mercadería (`create_mercaderia_expense`). Dirección: reposición vía compra, no edit manual de stock; botón "Reponer stock" → `/purchases` con items precargados. No urgente. Ver `docs/todo/` (módulo Compras).

### P10 — Base comercial/fiscal + contabilidad
- **P10.a — Base mínima ✅ (2026-05-27)** — tabla `subscriptions`, `businesses.country_code` + `tax_id`, helper `get_plan_limits`. Backfilled.
- **P10.b — Facturación electrónica (diferida)** — tabla `invoices` + integración por país. Gateada a demanda real.
- **P10.c — Contabilidad completa (diferida)** — `chart_of_accounts`, `journal_entries`, `journal_lines`, asientos automáticos, libro diario. Gateada a las señales del gate de arriba. Decisión de `inventory_movements` (kardex) se resuelve junto con esto — ver `docs/todo/backlog.md`.

### P11 — Analytics avanzado ✅ (todo hecho)
- **P11.1 ✅** — `daily_snapshots` + cron nocturno + widget en `/stats`.
- **P11.2 ✅** — `get_period_comparison` + página `/stats/trends`.
- **P11.3 ✅** — heatmap día/hora (`/stats/heatmap`), reporte PDF por rango (`/stats/report`), y salud de inventario / dead-stock + overstock (`/stats/inventory-health`).

### P12 — IA proactiva opt-in ✅ (capa ambiente)
Shipped: tabla `ai_insights` + opt-in, RPCs de detección N1 + historial N2, Edge Function `generate-insights` (cron nocturno, **Groq Llama 3.3 70b** — no Anthropic; el free-tier de Anthropic no era necesario y Groq da $0), UI anclada (glyphs en dashboard/stats/inventory). **Diferido (no es deuda):** vista propia del Asistente (`/insights`), dominios cliente/proveedor, y monetización por plan (metering). Detalle en `docs/todo/p12-ia-proactiva.md`.

### P13 — App móvil iOS/Android (futuro)
React Native + Expo. Reutiliza `lib/payments.ts`, `lib/price-lists.ts`, `lib/operator.ts`. Modo offline básico, escáner por cámara, push conectadas con P12.

---

## Qué sigue (post-P12)

No queda una "fase siguiente" obvia que construir — el producto está completo para closed beta. El orden recomendado ahora **no es por feature**:

1. **Pulido** — items de UX/claridad sin bloqueo (ver `docs/todo/backlog.md`).
2. **Naming / rebrand** — resolver el conflicto de "Pulsar" (`pulsar.lat` ocupado por un competidor) antes de cualquier lanzamiento público.
3. **Usuarios reales / validación** — mayor ROI que cualquier feature net-new.

Lo pendiente de construir (P9 Compras, P10.b/c fiscal-contable, P13 móvil, y las ideas del backlog) se retoma **con señal real de demanda**, no por anticipado. La hipótesis sigue siendo que la validación importa más que el siguiente módulo.
