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

## Batch 2 — cutover (BEHAVIOR-CHANGING, needs decisions)

Open product decisions (D1–D3 below) gate this batch.

- Stop inserting settlement rows into `payments` (settlements live only in the ledger).
- Migrate the 1 existing dev settlement payment row out of `payments` → ledger; then
  `ALTER TABLE payments ALTER COLUMN sale_id SET NOT NULL` (no more NULLs ever).
- Update readers per decisions:
  - `close_cash_session` (D1): include cash settlements in `expected_amount`.
  - `get_sales_by_payment_detail` (D2): include settlements (merged or separate line).
- Update reconciliation: R8b tightens to "0 payments with sale_id NULL"; R7 updated for settlements.

### Decisions needed before Batch 2

- **D1 — Till:** should a **cash** cobro de fiado count toward the cash session's expected amount?
  (Real cash entered the drawer → almost certainly yes.)
- **D2 — Stats:** should settlements appear in payment-method breakdowns? As a merged amount per
  method, or a separate "Cobros de cuenta corriente" line? (Affects whether "revenue" mixes sales + collections.)
- **D3 — payments.sale_id NOT NULL:** confirm we fully remove settlements from `payments`
  (vs. keeping a typed `payments` row with `customer_id`/`session_id`). Recommended: full removal,
  ledger is the single source for cuenta corriente.
