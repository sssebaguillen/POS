# Pulsar POS — Backlog & Known Issues

> Pending work across the P-phases (audit log, cash sessions, accounting, etc.), known bugs, CONTEXT.md discrepancies, and post-beta tech debt.

---

## DB Audit — Pending (non-critical for beta)

| ID | Issue | Status |
|----|-------|--------|
| G-3 | `cash_sessions.opened_by` and `closed_by` → FK to `profiles` but should FK to `operators`. Both fixed in migration `fix_cash_sessions_fk_to_operators` with `ON DELETE SET NULL`. | ✅ |
| M-3 | `inventory_movements.created_by` has no active FK and trigger doesn't populate it. Deferred. | ⏳ |

---

## P7h Audit Log — Remaining Phases

| Phase | Scope | Status |
|-------|-------|--------|
| Fase 1 | Sales + inventory (products, categories, brands, bulk) audit logging; `/activity` UI; `RecentActivityWidget` on dashboard | ✅ shipped 2026-05-15 |
| Fase 2 | Audit logging for expenses, suppliers, price lists, settings, operators; `audit_log.entity_type` expanded to `expense \| supplier \| price_list \| setting \| operator`; `/activity` entity filter switched from chips to dropdown (9 options) | ✅ shipped 2026-05-16 |
| Fase 3 | Revert mutation from audit log entry (undo from any entry) | ⏳ |

**Fase 2 RPC signature changes (callers updated in same PR):**
- `swap_default_price_list(p_operator_id, p_business_id, p_price_list_id)` — was `(p_price_list_id, p_business_id)`
- `update_business_slug(p_operator_id, p_business_id, p_slug)` — was `(p_slug)`
- `create_operator(p_actor_operator_id, p_business_id, ...)` — actor param added at the front
- `update_operator(p_actor_operator_id, p_business_id, p_target_operator_id, ...)` — actor + business added; target renamed
- `update_expense(..., p_operator_id)` — appended trailing actor param (DEFAULT NULL)
- `delete_expense(p_business_id, p_expense_id, p_operator_id)` — appended trailing actor param (DEFAULT NULL)
- `update_mercaderia_expense(..., p_operator_id)` — appended trailing actor param (DEFAULT NULL)

`create_expense` and `create_mercaderia_expense` already accepted `p_operator_id` (used to stamp `expenses.operator_id`); the same value is now reused as the audit actor.

Helper `getActorOperatorId(operator)` in `lib/operator.ts` returns `null` for owner, `profile_id` otherwise — use it whenever you need to pass `p_operator_id` to an audit-logged RPC.

**Scope cut in Fase 1:** `ImportProductsModal.handleCreate` still performs a direct `.update({ icon_color })` on `categories` instead of going through `create_category_guarded` / `update_category`. Move to RPC path in Fase 2.

**Pendiente — `update_product_variants` audit log (próxima prioridad post-feature de pricing de variantes 2026-05-26):**

La RPC `update_product_variants(p_product_id, p_options, p_variants)` viola la **regla 32** de CLAUDE.md: no tiene `p_operator_id`, no valida business explícitamente, y no llama `log_audit_event`. Toda edición de variantes (crear/renombrar opciones, agregar/editar/desactivar variantes, cambiar precio/costo/stock) hoy es **invisible** en `/activity`. Eso rompe la promesa del módulo de Actividad y bloquea cualquier futuro feature de undo (Fase 3).

Cambios requeridos en una PR independiente:
1. Cambiar firma a `update_product_variants(p_operator_id uuid, p_business_id uuid, p_product_id uuid, p_options jsonb, p_variants jsonb)`. Mantener `SECURITY DEFINER` + `search_path = public, extensions`.
2. Validar `business_id` contra `get_business_id()` (defense-in-depth, patrón de `create_product`).
3. Verificar permiso `stock_write` (el editor de variantes vive bajo `/inventory`).
4. Antes de aplicar cambios, snapshot del estado actual (opciones + variantes) para `old_data`. Después aplicar mutaciones, recoger nuevo estado para `new_data`.
5. Llamar `log_audit_event(p_business_id, p_operator_id, 'product_updated', 'product', p_product_id, <product_name>, old_data, new_data)` — **una sola entrada por edición de producto con el diff completo de variantes en `new_data`** (no una entrada por variante; ya es el patrón establecido para bulk ops).
6. Callers a actualizar en el mismo commit: `EditProductModal.tsx:418` y donde sea que `NewProductModal` invoque la RPC. Pasar `getActorOperatorId(operator)` desde el front.
7. Extender `ActivityDetail.tsx` / `payloads.ts` para renderizar el diff de variantes en `/activity` (variantes agregadas, removidas, renombradas, cambios de price/cost/stock).

Pre-requisito: el front necesita conocer el `operator` activo en `EditProductModal` y `NewProductModal` para pasar `p_operator_id`. Hoy esos modales no reciben `activeOperator` por props — verificar el path y agregar el prop drilling necesario, o leer la cookie via context si ya hay uno.

---

## Other P-Phases

- **P8a** — cash sessions UI ✅ shipped. G-3 FK migration also done (`fix_cash_sessions_fk_to_operators`).
- **P8b** — `undo_import` RPC (planned but never created)
- **P9** — expenses module (mercadería partial: `expense_items`, `create_mercaderia_expense`, `update_mercaderia_expense` already shipped)
- **P10** — billing / facturación electrónica (paid plans). `invoices` table currently unused.
- **P11**, **P12** — TBD

---

## Dead Code in proxy.ts

The CONTEXT.md mentions a dead `/stock` guard in `proxy.ts`. This does NOT appear in the current `proxy.ts` source — it was already removed or never added. No action needed.

---

## CONTEXT.md Errors (not yet corrected in that file)

| Area | Documented | Reality |
|------|-----------|---------|
| Project ID | `zrnthycznbrplzpmxmkwk` | `zrnthcznbrplzpmxmkwk` |
| `businesses.accounting_enabled` | Listed as existing | Does not exist in live DB |
| `businesses.settings` keys | Only `primary_color` mentioned | Also supports `currency` and `logo_upload_path` |
| `profiles.onboarding_state` | Not documented | Exists with onboarding wizard state |
| `sales.status` CHECK | `('pending','completed','cancelled')` | `('completed','cancelled','refunded')` — no `pending`, has `refunded` |
| `cash_sessions` columns | Lists `status`, `difference` | Neither exists in live DB; `notes` exists instead |
| `payments.method` CHECK | Lists `credit`, `otro` | Not in live DB — only `cash,card,transfer,mercadopago` |
| `payments.status` CHECK | `('pending','completed','failed')` | `('completed','pending','refunded','cancelled')` — no `failed` |
| `expense_items` table | Not documented | Exists — full line-item system for mercadería |
| `inventory_movements` | No `reason`, `reference_id` | Both exist in live DB |
| `undo_import` RPC | Documented as existing | Does NOT exist in live DB |
| `update_expense` RPC | Not documented | Exists — for editing non-mercadería expenses |
| `create_mercaderia_expense` RPC | Not documented | Exists |
| `update_mercaderia_expense` RPC | Not documented | Exists |
| Permissions count | "9 campos" | 11 fields — `price_override` is the 10th, `free_line` is the 11th |
| `stats` permission | Documented as `stats` | Renamed to `analysis` on 2026-05-16 (covers dashboard, stats, /activity) |
| `audit_log` table | Not documented | Exists — P7h Phase 1, append-only audit trail |
| Inventory mutation RPCs | Direct table writes documented | All mutations now go through SECURITY DEFINER RPCs (`create_product`, `update_product`, `delete_product`, etc.) with audit logging |

---

## Technical Debt — Pending Post-Beta

| Item | Notes |
|------|-------|
| `InventoryPanel.tsx` (~1291 lines) | Extract 5 embedded sub-components |
| `CartPanel.tsx` (~920 lines) | `EditSalePanel` is embedded — separate it |
| `ProductsPanel.tsx` (294L) | Deleted — file did not exist. ✅ |
| `components/sales/` | Deleted — directory did not exist. ✅ |
| `formatMoney` duplicated | All three files already use `useFormatMoney()` from `CurrencyContext`. ✅ |
| `validateImageUrl` duplicated | Both modals already import from `@/lib/validation`. ✅ |
| `FieldGroup` duplicated | Both modals already import from a shared file. ✅ |
| `DateRangeFilter.tsx` | `QUARTER_RANGES` recalculates inside component on each render — not frozen at module load. Non-issue in practice. |
| Radix `DialogTitle` warnings | Add `<VisuallyHidden><DialogTitle>` to all modals |
| `useEffect` for sale history in `CartPanel` | Pre-React Query pattern, not migrated |
| `theme.tsx` FOUC | `localStorage` post-hydration causes flash — should use cookie like sidebar |
| `settings/page.tsx` auth | Already uses `requireAuthenticatedBusinessId`. ✅ |
| `operator-select/page.tsx` | Already typed as `Exclude<UserRole, 'owner'>`. ✅ |
| `!` assertions in env vars | In `client.ts` and `server.ts` |
| `CartItem` in `lib/types/index.ts` | Client-only type mixed with server types |
| `categories.public_read_categories` policy | Allows anon SELECT — fine for catalog but broad |
| Vestigial `categories.is_active` | Dropped in migration `drop_categories_is_active`. RPCs (`create_category_guarded`, `get_catalog_categories`) and `CategoryModal.refreshCategories` updated. `brands` had no `is_active` column. | ✅ |
