# Pulsar POS — Database Reference

> Full Postgres schema, RPC signatures, and RLS rules for the Supabase backend. Read this when adding/editing tables, writing RPCs, or wiring queries.
> Last verified against live Supabase: 2026-05-16.

---

## Connection

- Project ID: `zrnthcznbrplzpmxmkwk` (⚠️ CONTEXT.md has a typo: `zrnthycznbrplzpmxmkwk`)
- URL: `https://zrnthcznbrplzpmxmkwk.supabase.co`
- Region: sa-east-1
- Plan: FREE — do not suggest paid-plan features (e.g. Leaked Password Protection)

> All tables have RLS enabled. All policies use `get_business_id()` as the tenant boundary.

---

## Tables

### `businesses`
| column | type | notes |
|--------|------|-------|
| id | uuid PK | gen_random_uuid() |
| name | text | |
| slug | text UNIQUE | CHECK: `^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$` (3–50 chars) |
| plan | text | default `'free'` |
| settings | jsonb | default `'{"currency":"ARS"}'`. Supported keys: `currency` (ISO 4217: ARS\|USD\|EUR\|BRL\|CLP\|UYU\|PEN\|COP\|MXN\|PYG\|BOB), `logo_upload_path` (storage path for uploaded logo), `primary_color` (hex). **Always merge with spread — never replace the whole object.** |
| created_at | timestamptz | now() |
| whatsapp | text nullable | digits + country code only |
| logo_url | text nullable | |
| description | text nullable | visible in public catalog |
| country_code | text nullable | CHECK in (`AR`, `MX`, `CO`, `UY`); from P10.a |
| tax_id | text nullable | fiscal id (CUIT/RFC/NIT/RUT); from P10.a |
| timezone | text NOT NULL | IANA tz; default `'America/Argentina/Buenos_Aires'`. Used by P11.3 heatmap and any future time-of-day analytics. Backfilled from `country_code` on P11.3 rollout. |

> **Correction vs CONTEXT.md:** `accounting_enabled` column does NOT exist in the live DB. The `settings` JSONB also supports `currency` and `logo_upload_path` keys (not just `primary_color`).

---

### `profiles`
| column | type | notes |
|--------|------|-------|
| id | uuid PK | FK → auth.users(id) |
| business_id | uuid nullable | FK → businesses(id) |
| role | text | default `'cashier'` (but in practice always `'owner'` for rows that exist here) |
| name | text | |
| pin | text nullable | not used for owner |
| created_at | timestamptz | now() |
| avatar_url | text nullable | |
| onboarding_state | jsonb | default `'{"completed":false,"tour_done":false,"steps_done":[],"wizard_step":0}'`. Keys: `completed` (bool), `wizard_step` (int 0-4), `steps_done` (array: `business_info\|category\|product\|operator`), `tour_done` (bool). |

> **Correction vs CONTEXT.md:** `onboarding_state` column exists and is documented here for the first time. `permissions` JSONB column was removed (confirmed absent from live schema).

RLS policies: `own_profile` (ALL where id = auth.uid()), `tenant_select_profiles` (SELECT where business_id = get_business_id()), `insert_own_profile` (INSERT).

---

### `operators`
| column | type | notes |
|--------|------|-------|
| id | uuid PK | gen_random_uuid() |
| business_id | uuid | FK → businesses(id) |
| name | text | |
| role | text | CHECK: `('cashier','manager','custom')` — no `'owner'` |
| pin | text | bcrypt via `extensions.crypt()` |
| permissions | jsonb | default has 9 keys (no `price_override`, `free_line` — soft-default to false in code) |
| is_active | bool | default true |
| created_at | timestamptz | now() |

---

### `categories`
| column | type | notes |
|--------|------|-------|
| id | uuid PK | gen_random_uuid() |
| business_id | uuid nullable | FK → businesses(id) |
| name | text | |
| icon | text nullable | default `'📦'` |
| position | int nullable | default 0 |
| is_active | bool nullable | default true |
| created_at | timestamptz | now() |

---

### `brands`
| column | type | notes |
|--------|------|-------|
| id | uuid PK | gen_random_uuid() |
| business_id | uuid | FK → businesses(id) |
| name | text | UNIQUE (business_id, name) |
| created_at | timestamptz | now() |

---

### `products`
| column | type | notes |
|--------|------|-------|
| id | uuid PK | gen_random_uuid() |
| business_id | uuid nullable | FK → businesses(id) |
| category_id | uuid nullable | FK → categories(id) |
| brand_id | uuid nullable | FK → brands(id) |
| name | text | |
| sku | text nullable | |
| barcode | text nullable | |
| price | numeric | default 0 |
| cost | numeric nullable | default 0 |
| stock | int | default 0 |
| min_stock | int nullable | default 0 |
| image_url | text nullable | HTTPS URL — `product-images` bucket or external URL |
| image_source | text nullable | CHECK: `('upload','url')`. Both null or both non-null. |
| is_active | bool nullable | default true |
| show_in_catalog | bool nullable | default true |
| sales_count | int nullable | default 0 |
| created_at | timestamptz | now() |

**Images:** `image_source = 'upload'` → path in bucket `product-images` (public). Storage path: `{businessId}/{uuid}.{ext}` — first segment is `businessId`, not `product.id`. Use `next/image` with `unoptimized={image_source === 'url'}` for external URLs.

---

### `price_lists`
| column | type | notes |
|--------|------|-------|
| id | uuid PK | gen_random_uuid() |
| business_id | uuid | FK → businesses(id) |
| name | text | |
| description | text nullable | |
| multiplier | numeric | default 1.0 — represents margin: 1.40 = 40% over cost |
| is_default | boolean | default false — unique partial index WHERE is_default = true |
| created_at | timestamptz | now() |

UI: user enters percentage (e.g. 40%) → stored as multiplier (1.40). Conversion only in UI, never in DB.

---

### `price_list_overrides`
| column | type | notes |
|--------|------|-------|
| id | uuid PK | gen_random_uuid() |
| price_list_id | uuid | FK → price_lists(id) ON DELETE CASCADE |
| product_id | uuid nullable | FK → products(id) ON DELETE CASCADE |
| brand_id | uuid nullable | FK → brands(id) ON DELETE CASCADE |
| multiplier | numeric | |
| created_at | timestamptz | now() |

Constraints: override by product OR by brand, never both or neither. UNIQUE (price_list_id, product_id), UNIQUE (price_list_id, brand_id).

---

### `sales`
| column | type | notes |
|--------|------|-------|
| id | uuid PK | gen_random_uuid() |
| business_id | uuid nullable | FK → businesses(id) |
| session_id | uuid nullable | FK → cash_sessions(id) |
| customer_id | uuid nullable | FK → customers(id) |
| operator_id | uuid nullable | FK → operators(id) |
| price_list_id | uuid nullable | FK → price_lists(id) ON DELETE SET NULL |
| subtotal | numeric | default 0 |
| discount | numeric nullable | default 0 |
| total | numeric | default 0 |
| status | text nullable | CHECK: `('completed','cancelled','refunded')` — default `'completed'` |
| notes | text nullable | |
| created_at | timestamptz | now() |

> **Correction vs CONTEXT.md:** Status CHECK is `('completed','cancelled','refunded')`, NOT `('pending','completed','cancelled')`. `pending` doesn't exist; `refunded` does.

---

### `sale_items`
| column | type | notes |
|--------|------|-------|
| id | uuid PK | gen_random_uuid() |
| sale_id | uuid nullable | FK → sales(id) |
| product_id | uuid nullable | FK → products(id) |
| quantity | int | default 1 |
| unit_price | numeric | price at time of sale |
| unit_price_override | numeric nullable | manually edited price in POS |
| override_reason | text nullable | free-text reason |
| total | numeric | NETO: promo unitaria → `qty×unit`; promo de cantidad → `qty×unit − promo_discount` |
| promotion_id | uuid nullable | FK → promotions(id) — informativo (2026-06-10) |
| promo_discount | numeric(12,2) | default 0 — ahorro de la línea, informativo |

---

### `payments`
| column | type | notes |
|--------|------|-------|
| id | uuid PK | gen_random_uuid() |
| sale_id | uuid nullable | FK → sales(id) |
| method | text | CHECK: `('cash','card','transfer','mercadopago')` |
| amount | numeric | |
| reference | text nullable | |
| status | text nullable | CHECK: `('completed','pending','refunded','cancelled')` — default `'completed'` |
| created_at | timestamptz | now() |

> **Correction vs CONTEXT.md:** method CHECK has only 4 values — `credit` and `otro` are NOT in the live schema. Status CHECK has `'refunded','cancelled'`, NOT `'failed'`.

---

### `inventory_movements`
| column | type | notes |
|--------|------|-------|
| id | uuid PK | gen_random_uuid() |
| business_id | uuid nullable | FK → businesses(id) |
| product_id | uuid nullable | FK → products(id) |
| type | text | CHECK: `('sale','purchase','adjustment','return')` |
| quantity | int | |
| reason | text nullable | human-readable reason |
| reference_id | uuid nullable | FK to source record (e.g. expense_id for purchases) |
| created_by | uuid nullable | legacy — no active FK (M-3, deferred) |
| created_by_operator | uuid nullable | FK → operators(id) — active field |
| created_at | timestamptz | now() |

> **Correction vs CONTEXT.md:** `reason` and `reference_id` columns exist in live DB but were not documented.

---

### `cash_sessions`
| column | type | notes |
|--------|------|-------|
| id | uuid PK | gen_random_uuid() |
| business_id | uuid nullable | FK → businesses(id) |
| opened_by | uuid nullable | FK → profiles(id) — G-3: should FK to operators |
| closed_by | uuid nullable | FK → profiles(id) |
| opening_amount | numeric nullable | default 0 |
| closing_amount | numeric nullable | |
| expected_amount | numeric nullable | |
| opened_at | timestamptz | now() |
| closed_at | timestamptz nullable | |
| notes | text nullable | |

> **Correction vs CONTEXT.md:** `status` and `difference` columns do NOT exist in live DB. `notes` exists instead.

---

### `customers`
| column | type | notes |
|--------|------|-------|
| id | uuid PK | gen_random_uuid() |
| business_id | uuid nullable | FK → businesses(id) |
| name | text | |
| phone | text nullable | |
| email | text nullable | |
| dni | text nullable | |
| credit_balance | numeric nullable | default 0 |
| notes | text nullable | |
| created_at | timestamptz | now() |

---

### `suppliers`
| column | type | notes |
|--------|------|-------|
| id | uuid PK | gen_random_uuid() |
| business_id | uuid | FK → businesses(id) |
| name | text | |
| contact_name | text nullable | |
| phone | text nullable | |
| email | text nullable | |
| address | text nullable | |
| notes | text nullable | |
| is_active | bool | default true |
| created_at | timestamptz | now() |

---

### `expenses`
| column | type | notes |
|--------|------|-------|
| id | uuid PK | gen_random_uuid() |
| business_id | uuid | FK → businesses(id) |
| operator_id | uuid nullable | FK → operators(id) ON DELETE SET NULL |
| supplier_id | uuid nullable | FK → suppliers(id) ON DELETE SET NULL |
| category | expense_category ENUM | `'mercaderia','alquiler','servicios','seguros','proveedores','sueldos','otro'` — default `'otro'` |
| amount | numeric | CHECK > 0 |
| description | text | |
| date | date | default CURRENT_DATE |
| attachment_url | text nullable | path in bucket `expense-receipts` |
| attachment_type | expense_attachment_type ENUM nullable | `'image','pdf','spreadsheet','other'` |
| attachment_name | text nullable | |
| notes | text nullable | |
| created_at | timestamptz | now() |
| updated_at | timestamptz | auto-updated by `set_updated_at` trigger |

Storage: `expense-receipts` bucket — private, 10MB max. Path: `{business_id}/{uuid}.{ext}`.

---

### `expense_items` ⭐ new — not in CONTEXT.md

Line items for `category = 'mercaderia'` expenses. Enables stock ingestion from the expenses module.

| column | type | notes |
|--------|------|-------|
| id | uuid PK | gen_random_uuid() |
| business_id | uuid | FK → businesses(id) |
| expense_id | uuid | FK → expenses(id) |
| product_id | uuid nullable | FK → products(id) — null allowed for unnamed items |
| product_name | text | captured at time of expense |
| quantity | int | CHECK > 0 |
| unit_cost | numeric | CHECK >= 0 |
| subtotal | numeric (generated) | `quantity * unit_cost` |
| update_cost | bool | default false — if true, updates `products.cost` on save |
| created_at | timestamptz | now() |

---

### `audit_log` ⭐ new (P7h Phase 1, 2026-05-15)

Append-only audit trail of business mutations. Indefinite retention. RLS enabled (tenant isolation via `business_id = get_business_id()`).

| column | type | notes |
|--------|------|-------|
| id | uuid PK | gen_random_uuid() |
| business_id | uuid | FK → businesses(id) |
| operator_id | uuid nullable | FK → operators(id). **NULL = owner ("Dueño")** — owner has no row in `operators` |
| actor_role | text | snapshot of role at action time (`'owner'`, `'manager'`, `'cashier'`, `'custom'`) |
| action | text | e.g. `sale_created`, `sale_updated`, `sale_deleted`, `product_created`, `product_updated`, `product_deleted`, `product_bulk_deleted`, `product_bulk_status`, `product_bulk_category`, `product_bulk_brand`, `category_*`, `brand_*` |
| entity_type | text | `'sale' \| 'product' \| 'category' \| 'brand' \| 'expense' \| 'supplier' \| 'price_list' \| 'setting' \| 'operator' \| 'customer' \| 'catalog_order' \| 'promotion'` |
| entity_id | uuid nullable | id of affected entity (null for bulk) |
| entity_label | text nullable | snapshot label for display (sales have no label — show total from `new_data`/`old_data`) |
| old_data | jsonb nullable | full pre-state snapshot for `*_updated` / `*_deleted` |
| new_data | jsonb nullable | full post-state snapshot for `*_created` / `*_updated` |
| created_at | timestamptz | now() |

Helper: `log_audit_event(p_business_id, p_operator_id, p_actor_role, p_action, p_entity_type, p_entity_id, p_entity_label, p_old_data, p_new_data)` — called by all mutation RPCs. Convention: **`operator_id` is NULL when the owner performed the action**; the read RPC `get_audit_log` and UI both render that as "Dueño". Migrations: `20260515_06_audit_log_table.sql`, `20260515_07_audit_log_instrumentation.sql`, `20260515_08_audit_log_operator_id_nullable.sql`, `20260515_12_audit_sale_data.sql` (sale snapshots).

---

### `catalog_orders` ⭐ new (Pedidos Online, 2026-05-27)

Capturing the public catalog's WhatsApp-checkout intent as structured rows. Anon callers insert via `create_catalog_order` (SECURITY DEFINER, GRANT EXECUTE TO anon) — the table itself has no anon policy. Owner/operators mutate via `update_catalog_order_status`. Stock-negativo allowed (no stock validation at order time).

| column | type | notes |
|--------|------|-------|
| id | uuid PK | gen_random_uuid() |
| business_id | uuid | FK → businesses(id) ON DELETE CASCADE |
| order_number | int | per-business counter (`catalog_order_counters.last_number + 1`), unique with business_id |
| customer_name | text | trimmed at insert |
| customer_phone | text | digits-only normalized, indexed |
| delivery_type | text | `'takeaway' \| 'delivery'` |
| address | text nullable | required iff `delivery_type = 'delivery'` (CHECK constraint) |
| notes | text nullable | |
| subtotal, total | numeric(12,2) | re-priced server-side via `compute_effective_price` |
| status | text | `'recibido' \| 'aceptado' \| 'en_camino' \| 'listo_retiro' \| 'completado' \| 'rechazado' \| 'cancelado'` |
| sale_id | uuid nullable | FK → sales(id). Populated when status → `completado` |
| client_ip | inet nullable | captured by the API route for forensics |
| accepted_at, completed_at, rejected_at, cancelled_at | timestamptz nullable | set on each transition |
| created_at, updated_at | timestamptz | |

State machine (enforced in `update_catalog_order_status`):
- `recibido → aceptado | rechazado | cancelado`
- `aceptado → en_camino` (delivery only) `| listo_retiro` (takeaway only) `| cancelado`
- `en_camino | listo_retiro → completado | cancelado`
- `completado`, `rechazado`, `cancelado` terminal.

### `catalog_order_items` ⭐ new
Items snapshotted at order time (product/variant may be deleted later → FK SET NULL on those columns).

| column | type | notes |
|--------|------|-------|
| id | uuid PK | |
| order_id | uuid | FK → catalog_orders(id) ON DELETE CASCADE |
| product_id | uuid nullable | FK → products(id) ON DELETE SET NULL |
| product_name | text | snapshot |
| variant_id | uuid nullable | FK → product_variants(id) ON DELETE SET NULL |
| variant_label | text nullable | snapshot ("Rojo / M") |
| quantity | int CHECK > 0 | |
| unit_price | numeric(12,2) | server-re-priced |
| line_total | numeric(12,2) | unit_price × quantity |
| image_url | text nullable | snapshot |

### `catalog_phone_blacklist` ⭐ new
| column | type | notes |
|--------|------|-------|
| business_id, phone | composite PK | |
| reason | text nullable | |
| created_at | timestamptz | |

Populated when owner rechaza un pedido con la opción "bloquear este número" marcada. Checked by `create_catalog_order` before insert.

### `catalog_order_counters` ⭐ new
Per-business order-number counter; atomic increment via `INSERT … ON CONFLICT DO UPDATE`.

| column | type | notes |
|--------|------|-------|
| business_id | uuid PK | |
| last_number | int | |

### `promotions` ⭐ new (2026-06-10)
Promos y ofertas — plan completo en `docs/todo/promotions.md`. Una promo = exactamente un target (producto XOR categoría XOR marca, CHECK `promotions_scope_one`). Vigente = `is_active AND archived_at IS NULL AND now() ∈ [starts_at, ends_at]`. `show_in_catalog` solo controla la sección Ofertas destacada — el precio aplica siempre (paridad POS↔catálogo). Usadas en ventas se ARCHIVAN, nunca se borran (sin CASCADE). RLS: SELECT-only por negocio; escrituras solo vía RPCs guardadas.

| column | type | notes |
|--------|------|-------|
| id | uuid PK | |
| business_id | uuid NOT NULL | FK → businesses |
| name | text | |
| kind | text | CHECK `('percent','offer_price','quantity')` |
| percent | numeric | kind=percent: (0,100] |
| offer_price | numeric | kind=offer_price (solo productos sin variantes) |
| group_size / affected_units / pay_percent | int/int/numeric | kind=quantity: "cada N unidades, K pagan P%" — 2x1=(2,1,0), 3x2=(3,1,0), 2da al 50%=(2,1,50) |
| product_id / category_id / brand_id | uuid nullable | scope (exactamente uno) |
| starts_at / ends_at | timestamptz nullable | NULL = sin límite |
| is_active / show_in_catalog | boolean | default true |
| archived_at | timestamptz nullable | archivado = terminal |

`catalog_order_items` y `daily_snapshots` también suman columnas promo: `promotion_id`+`promo_discount` (informativas, líneas netas) y `promo_discounts_total`+`promo_sales_count` (agregados para P12) respectivamente. Espejo SQL↔TS de resolución/cálculo: `find_applicable_promotion`/`apply_unit_promo`/`compute_quantity_promo_discount` ↔ `src/lib/promotions.ts`.

### `invoices`
| column | type | notes |
|--------|------|-------|
| id | uuid PK | |
| business_id | uuid | |
| sale_id | uuid | FK → sales(id) |
| provider | text | e.g. `'facturama'`, `'alegra'` |
| external_id | text | ID at the external provider |
| status | text | |
| pdf_url | text nullable | |
| created_at | timestamptz | |

Currently unused (P10, paid plans).

---

## RLS Policies Summary

All tables enforce tenant isolation via `get_business_id()`. Key exceptions:

| table | policy | effect |
|-------|--------|--------|
| businesses | `public_read_businesses` | anon can SELECT (for catalog slug lookup) |
| categories | `public_read_categories` | anon can SELECT (for catalog) |
| products | `public_read_products` | anon can SELECT (for catalog) |
| profiles | `own_profile` | user can only access their own row via `auth.uid()` |
| profiles | `tenant_select_profiles` | SELECT also by business_id (for operator lookups) |
| profiles | `insert_own_profile` | anyone can INSERT (registration flow) |
| payments | `tenant_isolation` | via sub-select on sales.business_id |
| sale_items | `tenant_isolation` | via sub-select on sales.business_id |
| price_list_overrides | `tenant_isolation` | via sub-select on price_lists.business_id |
| expense_items | `owner_manage_expense_items` | business_id = get_business_id() |

---

## SQL Functions Reference

All SECURITY DEFINER, all with `set search_path = public, extensions`.

### General SQL Rules

- All RPC functions: `SECURITY DEFINER` + `set search_path = public, extensions`.
- `pgcrypto` functions: call as `extensions.crypt()` / `extensions.gen_salt()` — without the search_path, PostgreSQL won't find them.
- `create_operator` and `update_operator` return JSON — always check `data.success`, not just `error`.
- RPCs that return `{ data: [...] }`: always extract `.data` — never iterate the wrapper directly:
  ```ts
  const { data: rpcResult } = await supabase.rpc('get_top_products_detail', { ... })
  const rows = (rpcResult as unknown as { data: RowType[] } | null)?.data ?? []
  ```

### Function signatures

| function | description |
|----------|-------------|
| `bootstrap_new_user(p_user_id, p_business_name, p_user_name)` | Creates businesses + profiles |
| `get_business_id()` | STABLE — used in RLS policies. Returns auth.uid()'s business_id |
| `create_sale_transaction(...)` | Atomically inserts sale + sale_items + payments. Audit `new_data` is a post-insert snapshot `{total, subtotal, status, customer_id, payments[], items[]}` |
| `update_sale(p_sale_id, p_business_id, p_operator_id, ...)` | Reverts stock manually, DELETEs items, INSERTs new; calls `reconcile_sales_count`; logs `sale_updated` with `customer_id` in old/new data |
| `delete_sale(p_sale_id, p_business_id, p_operator_id)` | Deletes sale + reverts stock; logs `sale_deleted` with `customer_id` in `old_data` |
| `get_sale_detail(p_sale_id, p_business_id)` | Full sale with items and payments |
| `reconcile_sales_count(p_business_id)` | Recalculates `sales_count` from sale_items JOIN sales |
| `create_operator(p_business_id, p_name, p_role, p_pin, p_permissions?)` | Returns `{success, operator_id?, error?}` |
| `update_operator(p_operator_id, p_business_id, p_name, p_role, p_permissions)` | Returns `{success, error?}` |
| `verify_operator_pin(p_business_id, p_operator_id, p_pin)` | Returns `{success, profile_id?, name?, role?, permissions?, error?}` |
| `get_operator_stats(p_operator_id, p_date_from?, p_date_to?)` | Sales stats for a sub-operator — derives business_id from auth.uid() |
| `get_owner_stats(p_date_from?, p_date_to?)` | Sales stats for owner — derives business_id from auth.uid() |
| `swap_default_price_list(p_price_list_id, p_business_id)` | Atomic default swap |
| `create_promotion(p_operator_id, p_business_id, p_name, p_kind, …)` | Verifica `inventory_write` + tenant + scope del negocio; logs `promotion_created`. Returns `{success, id?, error?}` |
| `update_promotion(…, p_promotion_id, …, p_is_active)` | Ídem; rechaza archivadas; logs `promotion_updated` |
| `archive_promotion(p_operator_id, p_business_id, p_promotion_id)` | `is_active=false` + `archived_at=now()` (terminal); logs `promotion_archived` |
| `find_applicable_promotion(p_business_id, p_product_id, p_category_id, p_brand_id, p_at?)` | Promo vigente más aplicable (producto > categoría > marca; desempata la más reciente). Helper del path de catálogo — sin guard de tenant (como `compute_effective_price`) |
| `apply_unit_promo(p_kind, p_percent, p_offer_price, p_unit_price)` | IMMUTABLE — unitario con promo (percent/offer_price; oferta nunca sube el precio) |
| `compute_quantity_promo_discount(p_group_size, p_affected_units, p_pay_percent, p_unit_price, p_quantity)` | IMMUTABLE — descuento de línea `floor(qty/N)×K×unit×(1−P/100)` |
| `update_business_slug(p_slug)` | Validates format + uniqueness; throws in Spanish on failure; GRANT EXECUTE TO authenticated |
| `create_category_guarded(p_operator_id, p_business_id, p_name, p_icon, p_icon_color?)` | Verifies `stock_write`; accepts optional `icon_color`; logs `category_created` |
| `create_brand_guarded(p_operator_id, p_business_id, p_name)` | Verifies `stock_write`; logs `brand_created` |
| `create_product(p_operator_id, p_business_id, ...)` | Verifies `stock_write`; inserts product; logs `product_created` (migration `20260515_10`) |
| `update_product(p_operator_id, p_business_id, p_product_id, ...)` | Verifies `stock_write`; logs `product_updated` with full old/new snapshots |
| `delete_product(p_operator_id, p_business_id, p_product_id)` | Verifies `stock_write`; logs `product_deleted` |
| `update_category(p_operator_id, p_business_id, p_category_id, p_name, p_icon, p_icon_color)` | Verifies `stock_write`; accepts `icon_color` (migration `20260515_04`); logs `category_updated` |
| `delete_category(p_operator_id, p_business_id, p_category_id)` | Verifies `stock_write`; logs `category_deleted` |
| `delete_brand(p_operator_id, p_business_id, p_brand_id)` | Verifies `stock_write`; logs `brand_deleted` |
| `log_audit_event(p_business_id, p_operator_id, p_actor_role, p_action, p_entity_type, p_entity_id, p_entity_label, p_old_data, p_new_data)` | Helper called by all mutation RPCs to insert an `audit_log` row. `p_operator_id` is NULL for owner actions. |
| `get_audit_log(p_business_id, p_entity_type?, p_operator_id?, p_date_from?, p_date_to?, p_limit?, p_offset?)` | Returns `{data: AuditLogRow[], total}`. `p_operator_id = '00000000-0000-0000-0000-000000000000'` filters to owner-only (`operator_id IS NULL`); other UUIDs filter by that operator; NULL means no operator filter. Projects `actor_name = COALESCE(o.name, 'Dueño')`. |
| `get_business_balance(p_business_id, p_from?, p_to?)` | `{income, expenses, profit, margin, by_category, period_from, period_to}` |
| `get_expenses_list(p_business_id, p_from?, p_to?, p_category?, p_limit?, p_offset?)` | `{data: Expense[], total}` |
| `create_expense(p_business_id, p_category, p_amount, p_description, ...)` | `{success, id}` |
| `update_expense(p_business_id, p_expense_id, p_description, p_date, ...)` | Edits non-mercadería expenses; rejects if category = 'mercadería'. Returns `{success, error?}` |
| `delete_expense(p_business_id, p_expense_id)` | `{success}` |
| `create_mercaderia_expense(p_business_id, p_description, p_date?, p_supplier_id?, p_operator_id?, p_notes?, p_items?, p_update_stock?)` | Creates mercadería expense + expense_items + optional stock updates. Returns `{success, id, total}` |
| `update_mercaderia_expense(p_business_id, p_expense_id, p_description, p_date, p_supplier_id?, p_notes?, p_items?)` | Delta-based edit: reverts removed items, applies qty deltas, warns on cost conflicts. Returns `{success, warnings}` |
| `get_stats_kpis(p_business_id, p_from?, p_to?)` | KPIs with `total_units`, `peak_day`, `day_of_week` |
| `get_stats_evolution(p_business_id, p_from?, p_to?)` | Sales evolution with prev_period overlay |
| `get_stats_breakdown(p_business_id, p_from?, p_to?)` | Breakdown by category and brand |
| `get_top_products_detail(p_business_id, p_from?, p_to?, p_limit?, p_offset?)` | `{data: ProductSalesDetail[], total}` |
| `get_sales_by_category_detail(p_business_id, p_from?, p_to?, p_limit?, p_offset?)` | `{data: CategorySalesDetail[], total}` |
| `get_sales_by_brand_detail(p_business_id, p_from?, p_to?, p_limit?, p_offset?)` | `{data: BrandRow[], total}` — `BrandRow`: `brand_id, brand_name, transaction_count, units_sold, revenue, product_count` |
| `get_sales_by_payment_detail(p_business_id, p_from?, p_to?)` | `{data: PaymentMethodDetail[]}` |
| `get_sales_by_operator_detail(p_business_id, p_from?, p_to?)` | `{data: OperatorSalesDetail[]}` |
| `get_daily_snapshots(p_business_id, p_from?, p_to?)` | P11.1 — `{data: DailySnapshotRow[]}` desde `daily_snapshots`. `p_from`/`p_to` default = últimos 30 días. |
| `upsert_daily_snapshot(p_business_id, p_snapshot_date)` | P11.1 — recomputa el snapshot diario (sales+expenses+top product) y hace UPSERT. SECURITY DEFINER. |
| `refresh_daily_snapshot(p_business_id, p_snapshot_date?)` | P11.1 — wrapper validado por `get_business_id()`. Default = `current_date - 1`. |
| `refresh_all_daily_snapshots(p_snapshot_date?)` | P11.1 — recorre todos los negocios. `GRANT EXECUTE TO service_role` (Edge Function nocturno). |
| `get_period_comparison(p_business_id, p_from?, p_to?)` | P11.2 — `{current, previous, days[]}` sobre `daily_snapshots`. Alinea período anterior por offset. |
| `get_sales_heatmap(p_business_id, p_from?, p_to?)` | P11.3 — `{data: SalesHeatmapCell[]}` agrupado por `(weekday, hour)` en `businesses.timezone`. Sólo celdas con datos; la UI completa con ceros. |
| `get_dead_stock(p_business_id, p_days_threshold?=90, p_bucket?, p_limit?=500, p_offset?=0)` | Stock inmovilizado / capital inmovilizado (lente RECENCIA). Clasifica productos CON stock en `never_sold` (nunca vendido) o `dead` (>= 90d sin moverse), variant-aware (stock/costo desde `product_variants` si existen), excluye productos < 14 días (gracia) y los que rotan bien. El eje cobertura (sobrestock) NO vive acá. **No usa `inventory_movements`** (tabla parcial, ver backlog): última venta desde `sale_items`⋈`sales` completadas, antigüedad desde `created_at`. Incluye discontinuados. Devuelve `{data, total, summary}`; `summary` agrega capital y conteos por bucket + `products_missing_cost`. La página la llama sin filtro (`p_bucket=null`, `p_limit=500`) y filtra/pagina en memoria. `assert_tenant` + `GRANT EXECUTE TO authenticated`. Mig. `20260530_02`. |
| `get_overstock(p_business_id, p_limit?=500, p_offset?=0)` | Sobrestock / capital comprado de más (lente COBERTURA). Productos que SÍ rotan pero con cobertura (meses de stock = stock ÷ velocidad) >= 6 meses. Velocidad = `units_90d ÷ (min(90,age)/30)` (meses reales de historia, no 3 fijo); exige >= 30 días de historia. `excess_capital = frozen_capital × (cobertura − 6)/cobertura` (variant-safe). Mutuamente excluyente con `get_dead_stock` (sin ventas en 90d → velocidad 0 → no cae acá). Variant-aware. Devuelve `{data, total, summary}`; `summary` = `{total_excess_capital, total_overstock_capital, products_count}`. La página la llama sin paginar (`p_limit=500`) y pagina en memoria. `assert_tenant` + `GRANT EXECUTE TO authenticated`. Mig. `20260531_01`. |
| `bulk_delete_products(p_business_id, p_ids uuid[])` | Bulk delete with business_id guard |
| `bulk_set_product_status(p_business_id, p_ids uuid[], p_status text)` | Bulk activate/discontinue |
| `bulk_set_product_catalog(p_operator_id, p_business_id, p_product_ids uuid[], p_show_in_catalog boolean)` | Alta/baja masiva en catálogo online. Espeja `bulk_set_product_status` (guard `get_business_id`, permiso `stock_write`, audit `product_bulk_catalog`, conteo de delta real vía `show_in_catalog IS DISTINCT FROM`). `REVOKE … FROM PUBLIC, anon` + `GRANT EXECUTE TO authenticated`. Mig. `20260601_01`. |
| `bulk_update_product_category(p_business_id, p_ids uuid[], p_category_id uuid)` | Bulk category change |
| `bulk_update_product_brand(p_business_id, p_ids uuid[], p_brand_id uuid)` | Bulk brand change |
| `get_catalog_products(p_slug)` | Public catalog products (SECURITY DEFINER, GRANT EXECUTE TO anon) |
| `get_catalog_categories(p_slug)` | Public catalog categories (SECURITY DEFINER, GRANT EXECUTE TO anon) |
| `create_catalog_order(p_slug, p_customer_name, p_phone, p_delivery_type, p_address, p_notes, p_items, p_client_ip)` | Anon-callable (GRANT EXECUTE TO anon). Validates phone/blacklist/anti-spam (3 pending per phone/hour), re-precia items con `compute_effective_price`, reserva `order_number` per-business, inserta `catalog_orders` + `catalog_order_items`. Returns `{success, order_id, order_number, total}`. |
| `get_catalog_orders(p_status?, p_from?, p_to?)` | Lista de pedidos del negocio (autenticado). |
| `get_catalog_order(p_order_id)` | Detalle + items. Returns `{success, order, items}`. |
| `get_catalog_orders_unread_count()` | Conteo de pedidos en estado `recibido` (autenticado). Usado por badge del sidebar y `NewOrderNotifier`. |
| `update_catalog_order_status(p_operator_id, p_order_id, p_new_status, p_blacklist?)` | Valida transición; en `completado` llama a `create_sale_transaction` (payment_method `'other'`) y guarda `sale_id`. En `rechazado` con `p_blacklist=true` agrega el teléfono a `catalog_phone_blacklist`. Audit: `catalog_order_<status>` / entity_type `catalog_order`. Reusa permiso `sales`. |
| `set_updated_at()` | Trigger function: sets `updated_at = now()` on UPDATE |
| `rls_auto_enable` | Admin utility — enables RLS on all tables automatically |

> **`undo_import` does NOT exist in the live DB.** CONTEXT.md documents it as existing, but it was not created. It is planned for P8b.

> **RPC wrapper pattern:** Stats and expenses RPCs return `{ data: [...] }`. Always extract `.data`:
> ```ts
> const rows = (rpcResult as unknown as { data: RowType[] } | null)?.data ?? []
> ```

---

## Migration naming convention

Migrations live in `supabase/migrations/` and use the pattern `YYYYMMDD_NN_short_description.sql` (e.g. `20260515_06_audit_log_table.sql`). `NN` is a sequence number scoped to the day. Files are applied in lexicographic order.
