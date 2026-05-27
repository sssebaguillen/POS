# Módulo Contable Pulsar — Plan refinado

## Context

Pulsar necesita un módulo contable interno (sin facturación electrónica ni ARCA) que registre **partida doble automáticamente** desde las operaciones existentes (ventas, gastos, crédito a clientes, caja). Objetivos en orden:

1. **Fidelidad de datos contables** — los asientos siempre cuadran, los cambios al documento fuente se reflejan en el GL, el historial es inmutable (reversiones, nunca borrado).
2. **No degradar performance del POS** — las ventas siguen siendo atómicas y rápidas; el costo extra es contenido.
3. **Flujo simple para el comerciante** — no ve débitos/créditos en su día a día; los contadores ven estructura familiar.

Decisiones cerradas con el usuario:
- **Inventario perpetuo** — compras = `Dr Inventario / Cr Caja`; ventas postean COGS = `Dr COGS / Cr Inventario` al `product.cost`.
- **`expenses.payment_method`** — nueva columna, el asiento usa la cuenta de pago correspondiente.
- **Auto-repost desde fuente** — editar venta/gasto en su UI revierte y reposta el asiento; Libro Diario read-only en v1.
- **3 fases** — F1 fundación, F2 reportes, F3 manuales/cierre. Solo F1 se detalla acá; F2/F3 se planearán cuando F1 esté en producción y validado.

Crítica al pre-plan anterior, ya incorporada:
- Pre-plan trataba mercadería como gasto directo (5100 COGS) — mezclaba compra con costo. Corregido: agregamos cuenta **1300 Mercadería en stock** (activo) y movemos 5100 al momento de la venta.
- Faltaba descuentos como contra-ingreso. Agregado: **4110 Descuentos otorgados**.
- Faltaba GL en `apply_customer_credit` y `settle_customer_credit`. Incluidos.
- Faltaba conectar `cash_sessions` al GL. Apertura/cierre generan asientos con diferencias a `6910 Diferencias de caja`.
- Faltaba audit logging de mutaciones de asientos. Incluido.
- Edición manual en Libro Diario diferida a F3.

---

## Fase 1 — Fundación (este sprint)

### Schema (1 migración: `YYYYMMDD_01_accounting_foundation.sql`)

**`accounts`** (plan de cuentas por tenant)
```sql
id uuid PK
business_id uuid NOT NULL FK businesses ON DELETE CASCADE
code text NOT NULL                 -- "1110", "4100", etc.
name text NOT NULL
type text NOT NULL CHECK (type IN ('asset','liability','equity','income','expense'))
parent_id uuid FK accounts
is_system boolean NOT NULL DEFAULT false
is_active boolean NOT NULL DEFAULT true
created_at timestamptz DEFAULT now()
UNIQUE (business_id, code)
```

**`journal_entries`**
```sql
id uuid PK
business_id uuid NOT NULL FK businesses ON DELETE CASCADE
date date NOT NULL                 -- se llena desde sales.created_at / expenses.date
description text NOT NULL
source_type text NOT NULL CHECK (source_type IN ('sale','expense','credit_apply','credit_settle','cash_open','cash_close','manual','reversal'))
source_id uuid                     -- sale_id / expense_id / cash_session_id / customer_id
is_reversed boolean NOT NULL DEFAULT false
reversed_by uuid FK journal_entries
reversal_of uuid FK journal_entries
operator_id uuid FK operators      -- NULL = owner (regla 31 de CLAUDE.md)
created_at timestamptz DEFAULT now()
INDEX (business_id, date DESC)
INDEX (business_id, source_type, source_id)
```

**`journal_entry_lines`**
```sql
id uuid PK
journal_entry_id uuid NOT NULL FK journal_entries ON DELETE CASCADE
account_id uuid NOT NULL FK accounts
type text NOT NULL CHECK (type IN ('debit','credit'))
amount numeric NOT NULL CHECK (amount > 0)
created_at timestamptz DEFAULT now()
INDEX (account_id)
```

**`expenses.payment_method`** — nueva columna, enum existente de payments (`cash|card|transfer|mercadopago|otro`), default `'cash'` para backfill.

**RLS:**
- `accounts`, `journal_entries`, `journal_entry_lines`: SELECT por `business_id = get_business_id()`. Sin policies de INSERT/UPDATE/DELETE — mutación solo via RPCs SECURITY DEFINER.

### Plan de cuentas default (semilla en bootstrap)

```
ACTIVO
1000  Activo (parent)
1100  Caja y bancos                                (parent)
1110  Caja efectivo                    is_system   ← payment_method = cash | otro
1120  Transferencias bancarias         is_system   ← payment_method = transfer
1130  Mercado Pago                     is_system   ← payment_method = mercadopago
1140  Tarjeta crédito/débito           is_system   ← payment_method = card
1200  Cuentas por cobrar               (parent)
1210  Clientes cuenta corriente        is_system   ← customer credit
1300  Mercadería en stock              is_system   ← inventario (NUEVO vs pre-plan)

INGRESOS
4000  Ingresos                         (parent)
4100  Ventas                           is_system
4110  Descuentos otorgados             is_system   (contra-ingreso, NUEVO vs pre-plan)

COSTOS
5000  Costos                           (parent)
5100  Costo de mercadería vendida      is_system   ← posteado en venta, no en compra

GASTOS
6000  Gastos operativos                (parent)
6100  Alquiler                         is_system
6200  Servicios                        is_system
6300  Sueldos                          is_system
6400  Seguros                          is_system
6500  Proveedores                      is_system
6900  Gastos varios                    is_system
6910  Diferencias de caja              is_system   (sobrantes/faltantes en cierre, NUEVO)
```

Mapeos vivirán en una función SQL helper `get_payment_account_id(business_id, payment_method)` y `get_expense_account_id(business_id, expense_category)` para no hardcodear códigos en cada RPC.

### Bootstrap + backfill

- **`bootstrap_new_user`** (en `supabase/schema.sql`): después de crear `businesses` + `profiles`, llamar a nueva función `seed_default_chart_of_accounts(business_id)` que inserta las cuentas de arriba.
- **Backfill** (mismo migration): para cada `businesses` existente, ejecutar el seed si no tiene `accounts`. Luego, **NO** backfilleamos asientos históricos en F1 — el GL arranca desde la fecha de migración. Documentado en la migración como decisión explícita. (Backfill histórico se evalúa en F3 si hay demanda real.)

### RPCs nuevas / modificadas

**Helper interno `post_journal_entry(business_id, date, description, source_type, source_id, operator_id, lines jsonb) → uuid`**
- Valida `SUM(debit) = SUM(credit)` con tolerancia `< 0.01`.
- Valida que todas las `account_id` pertenezcan al business.
- Inserta entry + lines en una operación.
- Loguea a `audit_log` con `entity_type='journal_entry'`.
- Llamada desde todas las RPCs de abajo.

**Helper interno `reverse_journal_entry(entry_id, reason text, operator_id) → uuid`**
- Crea entry inverso (débitos ↔ créditos), `source_type='reversal'`, `reversal_of=entry_id`.
- Marca original `is_reversed=true`, `reversed_by=nuevo_id`.
- Loguea a `audit_log`.

**Modificar `create_sale_transaction`** (`20260517_01_p8_customer_credit.sql`)
Al final del bloque atómico actual, postear asiento compuesto:
```
Por cada payment en p_payments:
  Dr [cuenta_pago(method)]  amount    -- 1110/1120/1130/1140/1210 según method (credit → 1210)
Si sales.discount > 0:
  Dr 4110 Descuentos otorgados  discount
Cr 4100 Ventas  subtotal                -- subtotal antes de descuento

Si hay items con cost > 0:
  Dr 5100 COGS  SUM(quantity * cost)
  Cr 1300 Mercadería en stock  SUM(quantity * cost)
```
Notas:
- El subtotal de la venta se acredita en 4100 sin descontar. El descuento se debita en 4110. Eso preserva ingreso bruto y descuentos por separado.
- COGS se calcula leyendo `products.cost` para cada `sale_item` con `product_id` no nulo. `free_line_description` (sin product_id) no aporta COGS.
- Si `product.cost = 0`, no se postea esa línea (consistente con `calculateProductPrice`).

**Modificar `create_expense` y `create_mercaderia_expense`**
- Aceptan nuevo `p_payment_method text default 'cash'`.
- **Gastos no-mercadería** (`create_expense`):
  ```
  Dr [cuenta_gasto(category)]  amount   -- 6100/6200/6300/6400/6500/6900
  Cr [cuenta_pago(payment_method)]  amount
  ```
- **Mercadería** (`create_mercaderia_expense`):
  ```
  Dr 1300 Mercadería en stock  amount   -- ¡AHORA es activo, no gasto!
  Cr [cuenta_pago(payment_method)]  amount
  ```

**Modificar `update_expense` y `update_mercaderia_expense`**
- Al inicio: reversar el asiento existente (lookup por `source_type='expense', source_id=expense_id, is_reversed=false`).
- Al final: postear asiento nuevo con los valores actualizados.

**Modificar `delete_*` de expenses** (si existen) — solo reversar el asiento, no borrar.

**Modificar edición/borrado de ventas** — buscar las RPCs `update_sale` / `delete_sale` (o las que use `EditSalePanel` en `CartPanel.tsx`) y aplicar el mismo patrón reversar + repostear.

**Modificar `apply_customer_credit`** (`20260517_01_p8_customer_credit.sql`)
```
Dr 1210 Clientes cta cte  amount
Cr [lo que aplique según contexto]
```
Releer la RPC para confirmar — si lo que hace es "aplicar saldo a una venta existente", el asiento puede ya estar cubierto por `create_sale_transaction` con `method='credit'`. Si es una operación separada, postear acá. **A confirmar al ejecutar.**

**Modificar `settle_customer_credit`** — cliente paga deuda:
```
Dr [cuenta_pago(p_method)]  amount
Cr 1210 Clientes cta cte  amount
```

**Hooks de `cash_sessions`** — buscar RPC de open/close (o crear si la lógica vive en código TS hoy):
- **Apertura:** sin asiento si `opening_amount == 0`. Si `> 0`, asiento de ajuste de saldo inicial — **a discutir caso real**, probablemente no necesario porque el saldo de 1110 ya viene del día anterior. Marcar como TODO de F2.
- **Cierre con diferencia:** si `closing_amount != expected_amount`:
  ```
  Si faltante (closing < expected):  Dr 6910 Diferencias de caja  diff   Cr 1110 Caja  diff
  Si sobrante (closing > expected):  Dr 1110 Caja  diff   Cr 6910 Diferencias de caja  diff (negativo en P&L)
  ```

### UI (Fase 1)

**Sidebar** — sección "Finanzas" ya existe (`src/components/sidebar.tsx`) con `/expenses` y `/cash-sessions`. Agregar **`/finanzas/diario`** ("Libro diario") dentro de esa sección. **No** crear sección nueva "Contabilidad".

**`/finanzas/diario` (read-only en F1)**
- Server Component (edge runtime), gate de permisos `analysis` (mismo patrón que `/activity`).
- Reusar `DateRangeFilter` (`src/components/shared/DateRangeFilter.tsx`) — today/week/month/quarter/year/custom.
- Tabla paginada server-side via nueva RPC `get_journal_entries(p_business_id, p_date_from, p_date_to, p_page, p_page_size, p_include_reversed boolean)`.
- Filas expandibles: cabecera con fecha, descripción, total débito = total crédito; al expandir muestra líneas con código + nombre de cuenta + Debe / Haber.
- Asientos revertidos: badge ámbar "Anulado" + texto en `text-muted-foreground` con `line-through`; visibles si toggle "Mostrar anulados" está on (default off).
- Asientos de reversión: badge "Anula #N" con link al original.
- Asientos generados desde fuente (sale/expense): link al documento fuente (`/dashboard?sale=…`, `/expenses?id=…`).
- **No hay botón "Editar"** en F1.

**Sin** `/finanzas/resultados`, `/finanzas/flujo`, `/finanzas/cuentas` en F1 — esas van a F2.

---

## Archivos críticos a modificar

| Archivo | Cambio |
|---|---|
| `supabase/migrations/YYYYMMDD_01_accounting_foundation.sql` | NUEVO — schema + seed + backfill + helpers |
| `supabase/migrations/YYYYMMDD_02_accounting_hooks.sql` | NUEVO — modifica create_sale_transaction, create_expense, create_mercaderia_expense, update_expense, update_mercaderia_expense, apply_customer_credit, settle_customer_credit, sale update/delete RPCs, expenses.payment_method column |
| `supabase/schema.sql` | Actualizar `bootstrap_new_user` para llamar `seed_default_chart_of_accounts` |
| `src/lib/types/index.ts` | Agregar `JournalEntry`, `JournalEntryLine`, `Account` types |
| `src/lib/payments.ts` | Confirmar que `PAYMENT_OPTIONS` cubre el set usado por expenses (reusar) |
| `src/components/expenses/NewExpensePanel.tsx` | Selector de `payment_method` (reusar `SelectDropdown` + `PAYMENT_OPTIONS`) |
| `src/components/expenses/EditExpensePanel.tsx` | Selector de `payment_method` |
| `src/app/(app)/finanzas/diario/page.tsx` | NUEVO — Server Component edge |
| `src/components/finanzas/JournalView.tsx` | NUEVO — tabla expandible client component |
| `src/components/finanzas/JournalEntryRow.tsx` | NUEVO |
| `src/components/sidebar.tsx` | Agregar item "Libro diario" en sección Finanzas |
| `src/lib/operator.ts` | Si `analysis` permission no cubre `/finanzas/diario`, evaluar; probablemente sí (mismo gate que `/activity`) |

## Utilidades a reusar (no duplicar)

- `log_audit_event` (RPC existente) — para audit de mutaciones de asientos. Patrón en `supabase/migrations/20260515_06_audit_log_table.sql`.
- `get_business_id()` + `getActorOperatorId(operator)` (`src/lib/operator.ts`) — para `p_operator_id`.
- `requireAuthenticatedBusinessId` (`src/lib/business.ts`) — en la page del Libro Diario.
- `DateRangeFilter`, `PageHeader` con breadcrumbs, `formatMoney` (`src/lib/format.ts`), `SelectDropdown`.
- `PAYMENT_OPTIONS` / `PAYMENT_LABELS` / `normalizePayment` de `src/lib/payments.ts`.
- Patrón de chips para filtros (regla 17 de CLAUDE.md) en `JournalView` si hace falta filtrar por `source_type`.

## Verificación (end-to-end)

1. **Migración:** correr en local; `select * from accounts where business_id = '<test>'` debe devolver las cuentas del seed con `is_system=true`.
2. **Bootstrap nuevo:** crear user nuevo → confirmar plan de cuentas seedeado.
3. **Venta cash $1000, sin descuento, item con cost $400:**
   - Asiento 1: `Dr 1110 1000 / Cr 4100 1000`
   - Asiento 2: `Dr 5100 400 / Cr 1300 400`
   - Verificar `SUM(debit) = SUM(credit)` por entry.
4. **Venta con descuento $100 sobre subtotal $1000, pagada $500 efectivo + $400 tarjeta:**
   - `Dr 1110 500, Dr 1140 400, Dr 4110 100 / Cr 4100 1000`. Total 1000 = 1000. ✓
5. **Venta a cuenta corriente $500:**
   - `Dr 1210 500 / Cr 4100 500`
6. **Compra mercadería $2000 transferencia:**
   - `Dr 1300 2000 / Cr 1120 2000` (NO va a 5100)
7. **Gasto alquiler $5000 efectivo:**
   - `Dr 6100 5000 / Cr 1110 5000`
8. **Edición de gasto:** cambiar amount $5000 → $4500. Verificar:
   - Entry original `is_reversed=true`, `reversed_by` apunta a un entry de reversión.
   - Entry de reversión existe con débitos/créditos invertidos.
   - Entry nuevo con $4500 existe.
   - `SELECT SUM(amount) FROM lines WHERE account_id=6100` refleja solo $4500 neto.
9. **Cobro a cliente cta cte $300 efectivo:**
   - `Dr 1110 300 / Cr 1210 300`
10. **Cierre de caja con faltante $50:**
    - `Dr 6910 50 / Cr 1110 50`
11. **UI `/finanzas/diario`:** abrir, filtrar por hoy, confirmar que aparecen los asientos de los tests; expandir uno, ver líneas; togglear "Mostrar anulados".
12. **Audit log:** `SELECT * FROM audit_log WHERE entity_type='journal_entry' ORDER BY created_at DESC LIMIT 10` muestra una entrada por asiento creado/revertido.
13. **Performance:** medir latencia de `create_sale_transaction` antes/después con sale de 5 items + 2 payments. Aceptable: < +50ms en p95. Si excede, considerar mover el GL posting a `AFTER INSERT` trigger asíncrono (pero romperíamos atomicidad — preferible optimizar query).
14. **RLS:** crear sale como business A; con user de business B, `select * from journal_entries` no debe verla.

## Out of scope (F1)

- Reportes (P&L, cashflow, plan de cuentas) → **F2**
- Asientos manuales desde UI → **F3**
- Edición manual de asientos en Libro Diario → **F3**
- Cierre de período / lock contable → **F3**
- Backfill histórico de ventas/gastos previos a la migración → **F3** si hay demanda
- Multi-moneda, ajustes por inflación → fuera de roadmap
- Exportación XLSX/PDF → **F2** (deseable, no bloqueante)
- ARCA / facturación electrónica → fuera de este módulo
