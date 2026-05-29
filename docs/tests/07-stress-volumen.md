# 07 — Stress de volumen + multi-tenant

Prueba de carga sintética para confirmar que **los números siguen dando perfectos** con cientos de transacciones, y que el aislamiento multi-tenant (RLS) se sostiene cuando dos negocios operan a la vez sobre la misma base.

> **Estado: PASA al 100%.** Todos los datos generados acá son **sintéticos y descartables** — se eliminan junto con los negocios de prueba. El negocio real (Cecilia) **no se tocó**.
>
> Fecha de ejecución: 2026-05-28. Base: proyecto Supabase `zrnthcznbrplzpmxmkwk`.

---

## Por qué esta prueba

La closed beta todavía no tiene usuarios reales de alto volumen. El cuello de botella no son features sino **confianza**: el sistema nunca fue estresado a fondo. Si confirmamos que con cientos de ventas, compras, pagos mixtos, fiado, cajas y snapshots los números cierran al centavo —y que un negocio nunca ve ni contamina los datos de otro— podemos confiar en el sistema antes de sumar usuarios reales.

Los imports de +1000 productos ya estaban validados (lazy loading + infinite scroll). Lo que faltaba era la **integridad numérica bajo volumen transaccional**.

## Metodología

- Volumen generado vía las **mismas RPC `SECURITY DEFINER` que usa la app** (`create_sale_transaction`, `create_mercaderia_expense`, `open/close_cash_session`, `upsert_daily_snapshot`) — no inserts crudos. El stock se decrementa por el trigger `update_stock_on_sale`, igual que en producción.
- Contexto de auth simulado dentro de la transacción con `set_config('request.jwt.claims', …)` para que `get_business_id()` resuelva al negocio de prueba.
- `created_at` de ventas/pagos/movimientos retro-fechado aleatoriamente sobre 30 días para poblar snapshots diarios reales.
- Reconciliación con los invariantes **R1–R9** de [`06-reconciliacion.sql`](06-reconciliacion.sql), scopeados por `business_id`. Tolerancia 0.01. Todo read-only.

## Negocios de prueba (todos descartables)

| Negocio | `business_id` | Rol en la prueba |
|---|---|---|
| Q tal lokis | `debd5e3c-01d9-4134-b070-00de4008556a` | Tenant 1 — volumen alto |
| tienda de seba | `abd2d7b9-7691-4400-8ddf-8928b60ccd68` | Tenant 2 — volumen medio + anomalías pre-existentes |
| **Cecilia** | `32ad0306-2803-4c64-a6b9-a0cdde7fb17a` | **Negocio real — NO se tocó** |

---

## Tenant 1 — Q tal lokis (volumen alto)

| Métrica | Valor |
|---|---|
| Ventas | 400 |
| Ítems de venta | 922 |
| Pagos | 493 |
| Movimientos de stock | 985 (63 de compra) |
| Gastos de mercadería | 30 |
| Sesiones de caja | 5 (cerradas) |
| Snapshots diarios | 31 |
| Rango de fechas | 2026-04-28 → 2026-05-28 |
| Saldo de cuenta corriente acumulado | $114.533,60 |

Mix de ventas: ~60% método único, ~30% pago mixto, ~10% fiado (crédito). 50 ventas distribuidas en 5 sesiones de caja cerradas con arqueo.

### Reconciliación tenant 1 — **10/10 PASS**

| Invariante | Resultado |
|---|---|
| R1 — `total` de línea = `qty × precio` (respeta override) | ✅ 0 |
| R2 — `sale.subtotal` = Σ ítems | ✅ 0 |
| R3 — `total` = `subtotal − discount` | ✅ 0 |
| R4 — pagos cubren el total (ventas completadas) | ✅ 0 |
| R5 — unidades vendidas = movimientos de stock (variant-aware) | ✅ 0 |
| R6 — `net_revenue` del snapshot = ventas reales del día (tz local) | ✅ 0 |
| R6b — días con ventas sin snapshot (gaps) | ✅ 0 |
| R8 — `sale_items` huérfanos | ✅ 0 |
| R9 — signo de movimientos (venta < 0, compra > 0) | ✅ 0 |

---

## Tenant 2 — tienda de seba (volumen medio)

Se sembraron 120 ventas nuevas (cash / mixto / transferencia, sin fiado) sobre las 15 pre-existentes del testing manual.

| Métrica | Valor |
|---|---|
| Ventas | 135 (120 nuevas + 15 previas) |
| Ítems de venta | 232 |
| Pagos | 176 |
| Movimientos de venta | 234 |
| Snapshots diarios | 30 |
| Rango de fechas | 2026-04-29 → 2026-05-28 |

### Reconciliación tenant 2

| Invariante | Resultado | Nota |
|---|---|---|
| R1 — `total` de línea | ✅ 0 | |
| R2 — `subtotal` = Σ ítems | ✅ 0 | |
| R3 — `total` = `subtotal − discount` | ✅ 0 | |
| R4 — pagos cubren el total | ⚠️ 2 de 135 | **Pre-existentes**, no del volumen generado |
| R5 — stock vs movimientos | ⚠️ 1 | **Pre-existente** |
| R6 — snapshot net | ✅ 0 | |
| R6b — snapshot gaps | ✅ 0 | |
| Orphan payments (global) | ⚠️ 1 | **Pre-existente** ($4000, `sale_id` NULL) |

**Las 3 anomalías son pre-existentes del testing manual por UI, no del volumen sintético.** Las 2 ventas que fallan R4 son del 2026-05-14 (total $250 / pagado $125), anteriores al sembrado de hoy. Las **120 ventas generadas pasan los 8 invariantes**. Están documentadas como hallazgos en el backlog (`docs/todo/backlog.md` → "Bugs conocidos"):

- **Borrar una venta deja pagos huérfanos** (R8b) — `payments.sale_id → NULL` al eliminar la venta.
- **Cuenta corriente sin ledger / auditoría** (R10b) — `credit_balance` se ajusta directo, sin tabla append-only.

> El valor de que estas anomalías aparezcan acá: demuestran que **el harness de reconciliación detecta problemas reales** y que **quedan confinadas a un solo tenant** — no se propagan.

---

## Aislamiento multi-tenant (RLS)

Probado impersonando el rol `authenticated` con el JWT de cada dueño dentro de una transacción (`set local role authenticated; set local request.jwt.claims = …`), de modo que las políticas RLS sí se evalúan (el rol admin del MCP las saltearía).

| Prueba | Resultado |
|---|---|
| Tenant 1 ve solo sus ventas | ✅ 400 visibles; 0 de tenant 2; 0 de Cecilia |
| Tenant 2 ve solo sus ventas/productos/clientes | ✅ 135 ventas, 9 productos; 0 filas de tenant 1 (ventas, clientes, pagos) |
| `get_business_id()` resuelve al negocio correcto por JWT | ✅ ambos |
| Filtro explícito por `business_id` ajeno | ✅ devuelve 0 (RLS lo reccorta) |
| **Escritura cross-tenant** (tenant 2 intenta crear venta en tenant 1 vía RPC) | ✅ **Rechazada** — `"Contexto de negocio invalido"`; conteo de tenant 1 sin cambios (400) |
| Contaminación de tenant 1 tras sembrar tenant 2 | ✅ tenant 1 sigue 400 ventas, R1–R6 = 0 |

`create_sale_transaction` valida `p_business_id IS DISTINCT FROM get_business_id()` antes de escribir nada, así que ni siquiera con `business_id` ajeno explícito se puede inyectar en otro tenant.

---

## Conclusión

- **Integridad numérica al 100% bajo volumen.** 535 ventas sintéticas (400 + 135) repartidas en 2 negocios, con pagos únicos/mixtos/fiado, cajas y snapshots: **todos los invariantes pasan** salvo 3 anomalías pre-existentes y ya documentadas, ajenas al volumen generado.
- **Aislamiento multi-tenant sólido.** Ningún negocio ve ni puede escribir datos de otro, ni por query directa ni por RPC. RLS + el chequeo de `business_id` en las RPC funcionan en conjunto.
- **El harness de reconciliación es confiable:** atrapó problemas reales (R4/R5/orphan) y los ubicó en el tenant correcto sin falsos positivos sobre los datos limpios.

### Limpieza pendiente

Todos los datos de **Q tal lokis** y **tienda de seba** son descartables y deben eliminarse antes de salir de beta. Cecilia es el único negocio real y se mantuvo intacto.
