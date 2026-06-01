# Customer Account Ledger — design (Option B)

> Goal: stop conflating "tender for a sale" and "credit settlement" in `payments`. Give
> cuenta corriente an append-only ledger so balances are auditable and reconcilable, and
> remove the misleading `sale_id IS NULL` settlement encoding.
>
> Status: design, not implemented. Split into Batch 1 (additive, safe) + Batch 2 (cutover).
> Data rule: backfills touch only dev businesses (tienda de seba, Q tal lokis). Cecilia has 0 customers.

---

## Problem recap (confirmed in code, 2026-06-01)

`settle_customer_credit` records a cobro de fiado as `INSERT INTO payments (sale_id=NULL, method, amount, 'completed')`.
So `payments.sale_id IS NULL` means "credit settlement", not "orphan". Three readers inner-join
`payments → sales` and therefore **silently drop settlements**:

1. `get_sales_by_payment_detail` — settlements invisible in payment-method stats (undercounts income).
2. `close_cash_session` — a **cash** settlement is not in the till's `expected_amount` → phantom surplus at close.
3. Reconciliation R8b — flags every settlement as an "orphan payment" (false positive).

Root cause: `payments` holds two concepts with no discriminator; settlement rows also lack
`customer_id`, `session_id`, and `business_id` (they are unanchored — a business delete leaves them floating).

`credit_balance` write paths (only two): `create_sale_transaction` (fiar → +) and
`settle_customer_credit` (cobro → −). `update_customer`/`create_customer` do **not** persist it
(the EditCustomerModal "balance" field is local UI echo only).

---

## Target model

New table `customer_account_movements` (append-only):

| column | type | notes |
|---|---|---|
| id | uuid pk | |
| business_id | uuid not null | FK businesses, RLS scoped |
| customer_id | uuid not null | FK customers |
| type | text not null | `charge` (fiar) \| `payment` (cobro) \| `opening` (backfill) |
| amount | numeric not null | always > 0; sign implied by `type` |
| method | text null | for `payment`: cash/card/transfer; null for charge/opening |
| sale_id | uuid null | FK sales — set for `charge` rows (the credit sale) |
| operator_id | uuid null | actor (null = owner) |
| balance_after | numeric not null | running balance snapshot |
| notes | text null | |
| created_at | timestamptz not null default now() | |

Indexes: `(business_id, customer_id, created_at)`. RLS: tenant-scoped like other tables.
Invariant: `SUM(signed amount) per customer == customers.credit_balance`.

---

## Batch 1 — additive foundation (SAFE, no behavior change)

Nothing reads the ledger yet, so nothing can break.

1. Create `customer_account_movements` + RLS + indexes (DDL — global, fine).
2. Dual-write (keep all existing behavior intact):
   - `create_sale_transaction`: when the sale is on credit, also insert a `charge` movement
     (`sale_id` = the new sale, `balance_after` = new credit_balance).
   - `settle_customer_credit`: also insert a `payment` movement (`balance_after` = new balance).
     **Keep** the existing `payments(sale_id=NULL)` insert for now — Batch 2 removes it.
3. Backfill (DEV BUSINESSES ONLY): for each customer with `credit_balance <> 0` in tienda de seba
   / Q tal lokis, insert one `opening` movement = current balance. (Only dev has customers.)
4. Reconciliation: add R10c — ledger sum per customer == `credit_balance`.

Risk: low. Pure addition + a guarded edit to the two RPCs. The `create_sale_transaction` change is
additive (one extra INSERT inside the existing credit branch) — needs careful review since it is the
most load-bearing RPC.

## Decisions (resolved 2026-06-01)

- **D1 — Till: YES.** Cash cobros count toward the cash session's `expected_amount` (real cash in the
  drawer). Card/transfer don't affect the till. Requires a `session_id` link on settlement movements.
- **D2 — Stats: SEPARATE line.** Settlements appear as their own "Cobros de cuenta corriente"
  collections line, **not merged** into the sales payment-mix — merging would double-count against the
  existing `'credit'` revenue line (a credit sale is already booked as revenue under `'credit'` at sale time).
- **D3 — Ledger only.** Settlements live solely in `customer_account_movements`; `payments.sale_id`
  becomes `NOT NULL`. Add a unified `cash_inflows` view so till/stats read both sources cleanly.

## Batch 2a — DONE (2026-06-01, mig 20260601_03)

D1 (till) + D3 (model) shipped. `payments.sale_id` is now `NOT NULL`; settlements live only in
the ledger with `session_id`. `close_cash_session` + `get_session_summary` + `CloseSessionModal`
all include cash settlements in the till's expected amount (the preview recomputes client-side, so
all three had to change together). The single dev orphan settlement row was removed from `payments`
first. Reconciliation R7 (now `apertura + ventas cash + cobros cash`) and R8b (now a true-orphan
check) updated; R7/R10c/orphan checks all pass. **Dropped** the `cash_inflows` view — nothing reads
it (no speculative infra). **Pending: Batch 2b (D2 stats line).**

## Batch 2 — cutover plan (reference)

Order matters; do it in one transaction where noted.

1. **Ledger: add `session_id`** (`uuid REFERENCES cash_sessions ON DELETE SET NULL`) + FK index.
   Only `payment` movements set it (the till only cares about cash collections).
2. **`settle_customer_credit`:** (a) stop the `INSERT INTO payments (sale_id=NULL,...)`; (b) resolve the
   open session for the business and store `session_id` on the `payment` movement. Settlement now lives
   only in the ledger. (Lookup is safe: ≤1 open session per business, enforced by the unique partial index.)
3. **Data cleanup (DEV ONLY):** delete the single `tienda de seba` orphan settlement row from `payments`
   (net effect already captured in the ledger `opening` backfill + audit_log). Confirm 0 NULL-sale
   payments remain, then `ALTER TABLE payments ALTER COLUMN sale_id SET NOT NULL`. (Same migration tx.)
4. **`close_cash_session` (D1):** `expected = opening + cash_sales + cash_settlements`, where
   `cash_settlements = Σ ledger payment movements for the session with method='cash'`.
5. **`get_sales_by_payment_detail` + UI (D2):** return a separate `collections` section (Σ ledger
   payment movements in range, by method); render as a distinct "Cobros de cuenta corriente" line in
   `PaymentMethodDetailView` — never summed into the sales payment-mix.
6. **`cash_inflows` view (D3):** union of sale-payments + ledger payment movements, for clean reads.
7. **Reconciliation:** R8b tightens to "0 payments with `sale_id` NULL"; R7 updated to include cash
   settlements; R10c stays.
8. **schema.sql** kept in sync.

Note: step 5 touches the frontend (`PaymentMethodDetailView` + the stats page). Could be split as Batch 2b
if we want the backend cutover (1–4, 6–7) landed first.
