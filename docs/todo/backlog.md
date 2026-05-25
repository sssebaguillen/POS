# Pulsar POS — Backlog & Known Issues

> Trabajo pendiente, bugs conocidos, errores de CONTEXT.md y deuda técnica post-beta.

---

## DB Audit — Pendiente

| ID | Issue |
|----|-------|
| M-3 | `inventory_movements.created_by` no tiene FK activa y el trigger no lo popula. |

---

## P7h Audit Log — Pendiente

- **Fase 3:** revertir una mutación desde su entrada en `/activity` (undo desde cualquier evento).
- **Scope cut Fase 1:** `ImportProductsModal.handleCreate` aún hace `.update({ icon_color })` directo sobre `categories` en vez de pasar por `update_category`. Mover a RPC.

---

## Otras P-Phases

- **P8b** — `undo_import` RPC (planeada, nunca creada).
- **P10** — facturación electrónica (planes pagos). Tabla `invoices` existe pero sin uso.
- **P11**, **P12** — TBD.

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
