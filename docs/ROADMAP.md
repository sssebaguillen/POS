# Pulsar POS — Roadmap

> **Para Copilot:** Este archivo documenta el estado de cada fase del producto, qué está en scope ahora, y qué viene después. Usalo para entender qué features están activos, cuáles están pendientes y cuáles son futuros. No implementes features de fases futuras a menos que se pida explícitamente.

---

## Estado actual: Beta launch

Las fases P0–P7b están completas. El sistema está en preparación para beta con dos clientes iniciales.

### Beta blockers activos (alta prioridad)

- **Pago mixto** — una venta con múltiples métodos de pago (ej. parte efectivo + parte transferencia). El modelo de datos (`payments` table, múltiples rows por `sale_id`) ya lo soporta. Falta la UI en `PaymentModal`.
- **UI de caja registradora** — apertura y cierre de `cash_sessions`, con resumen imprimible al cerrar.
- **UI de clientes en el POS** — selector de cliente en `CartPanel` antes de confirmar venta.

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

### P7b.3 — Cierre de caja imprimible
Resumen imprimible al cerrar `cash_sessions`: ventas del turno, totales por método, diferencia vs apertura. Depende de que la UI de caja esté activa.

### P7c — Tests automatizados
- **P7c.1** — SQL tests con pgTAP: verificar RLS, triggers, RPCs
- **P7c.2** — Playwright E2E: flujo de registro, venta, operador, edición de venta, listas de precios

### P7d — Price override por línea en el POS
Permite editar el precio de un ítem directamente en el carrito sin modificar el producto maestro.

**Modelo de datos** — agregar a `sale_items`:
```sql
unit_price_override numeric,  -- nullable, reemplaza calculateProductPrice si presente
override_reason     text       -- nullable, motivo del override
```

**Permiso nuevo** — agregar `price_override: boolean` a `Permissions`. Impacta: `lib/operator.ts` (OWNER_PERMISSIONS), `sidebar.tsx`, `app/api/operator/switch/route.ts`. **Agregar en el mismo commit en todos los archivos.**

**Lógica de precio:**
```
precio_final = unit_price_override ?? calculateProductPrice(product, activePriceList, overrides)
```

**UI** — botón "Editar precio" por línea en `CartPanel`, visible solo si `permissions.price_override === true`. Modal con precio actual, input de nuevo precio, select de motivo.

---

## Fases futuras (no implementar todavía)

> Las fases siguientes están documentadas para orientación arquitectónica. No implementes nada de aquí a menos que se solicite explícitamente.

### P8 — Cuentas corrientes de clientes
Activar `customers.credit_balance`. Agregar `credit_limit` + `is_credit_enabled`. RPCs `apply_customer_credit` y `settle_customer_credit`. Método de pago `credit` en `PaymentModal`. Nueva ruta `/clientes`.

### P9 — Órdenes de compra
Tablas `purchase_orders` + `purchase_order_items`. RPC `receive_purchase_order` (actualiza stock + registra en `inventory_movements` con `type = 'purchase'`). Nueva ruta `/compras`.

### P10 — Módulo contable + facturación electrónica
Infraestructura contable invisible (tablas `chart_of_accounts`, `journal_entries`, `journal_lines`). Campo `accounting_enabled` en `businesses` (pendiente de agregar a DB). Tabla `invoices` (pendiente). Integración Facturama para Argentina (AFIP). Tabla `subscriptions` para billing. Planes `free | pro | enterprise`.

### P11 — Analytics avanzado
Tabla `daily_snapshots` con cron job. Comparación temporal (semana vs semana anterior). Heatmap por hora. Reporte mensual exportable en PDF.

### P12 — IA proactiva opt-in
Edge Function `generate-insights` con cron nocturno. Anthropic API: Haiku para análisis rutinario, Sonnet para anomalías. Tabla `ai_insights`. Canales: in-app, email (Resend), WhatsApp Business (fase madura).

### P13 — App móvil iOS/Android
React Native + Expo. Reutiliza `lib/payments.ts`, `lib/price-lists.ts`, `lib/operator.ts`. Modo offline básico. Escáner de barras vía cámara. Push notifications conectadas con P12.

---

## Orden de prioridad recomendado (P8+)

| Fase | Impacto retención | Impacto monetización | Complejidad |
|------|-------------------|----------------------|-------------|
| P8 Cuentas corrientes | Muy alto | Medio | Media |
| P9 Órdenes de compra | Alto | Bajo | Media |
| P10.1 Infraestructura contable (invisible) | Bajo ahora, crítico para P10.4 | Muy alto | Alta |
| P10.3–10.4 Facturación electrónica | Medio | Muy alto — desbloquea plan Pro | Alta |
| P10.5 Billing | Bajo (usuario) | Crítico (negocio) | Media |
| P11 Analytics avanzado | Alto | Medio | Media |
| P12 IA proactiva | Alto — diferenciador | Alto — justifica Pro | Media |
| P13 App móvil | Muy alto | Muy alto | Muy alta |

Secuencia: **P8 → P10.1 (infraestructura invisible, ya) → P9 → P10.2–10.5 → P11 → P12 → P13**

P10.1 conviene aplicarlo antes de que haya miles de ventas sin asientos contables, aunque la UI llegue mucho después.
