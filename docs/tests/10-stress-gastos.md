# 10 — Stress de gastos + movimiento de stock

Continuación del [stress de volumen (07)](07-stress-volumen.md). Aquel probó que **las ventas dan perfectas** bajo cientos de transacciones. Este agrega lo que faltaba: **gastos operativos y de mercadería en volumen**, con foco en lo más crítico — los **gastos de mercadería mueven stock** (`create_mercaderia_expense` → trigger de compra), donde un error contamina el inventario.

> **Estado: PASA al 100%.** Todos los datos son **sintéticos y descartables** — etiquetados con `expenses.notes = 'stress-gastos-20260530'`. El negocio real (Cecilia) **no se tocó**; `Q tal lokis` tampoco.
>
> Fecha de ejecución: 2026-05-30. Base: proyecto Supabase `zrnthcznbrplzpmxmkwk`. Negocio: **tienda de seba** (`abd2d7b9-7691-4400-8ddf-8928b60ccd68`, entorno dev).

---

## Por qué esta prueba

Los gastos de mercadería son el flujo más delicado del sistema después de la venta: cada compra **incrementa stock** (en producto o variante), **opcionalmente actualiza el costo**, y registra un `inventory_movements` de tipo `purchase`. Si la venta resta y la compra suma, el stock real es la suma algebraica de ambos ledgers. Había que confirmar que esa aritmética cierra al centavo y a la unidad bajo volumen, conviviendo ventas y compras sobre los mismos productos.

## Metodología

- Volumen generado vía las **mismas RPC `SECURITY DEFINER` que usa la app** — `create_expense` (operativos), `create_mercaderia_expense` (mercadería, `p_update_stock = true`) y `create_sale_transaction` (ventas). El stock se mueve solo por el trigger `update_stock_on_sale` (ventas) y por el `UPDATE products/product_variants SET stock` interno de `create_mercaderia_expense` (compras). Nada de inserts crudos.
- Contexto de auth simulado con `set_config('request.jwt.claims', …)` apuntando al `sub` del dueño, de modo que `auth.uid()` (gasto) y `get_business_id()` (venta) resuelvan al negocio de prueba.
- Gastos retro-fechados por `p_date`, ventas retro-fechadas por `created_at`, distribuidos sobre la ventana 2026-04-29 → 2026-05-30 para poblar snapshots diarios reales.
- **Baseline de stock capturado antes de generar** (tabla temporal) para medir el delta exacto causado por la prueba.

## Volumen generado (tienda de seba)

| Métrica | Valor |
|---|---|
| Gastos generados | 120 |
| — operativos (alquiler/servicios/seguros/proveedores/sueldos/otro) | 80 |
| — de mercadería (mueven stock) | 40 |
| Ítems de mercadería → movimientos `purchase` | 77 |
| Ventas nuevas (cash) | 50 |
| Ventana de fechas | 2026-04-29 → 2026-05-30 |

Mercadería: 1–3 ítems por gasto, sobre productos **y variantes**, cantidades 1–8, ~40% con `update_cost = true`. Ventas: 1–2 ítems, cantidades 1–3, pago cash = total, sobre los mismos productos comprados (para forzar convivencia compra↔venta en el ledger).

---

## Reconciliación de gastos + stock — **9/9 PASS**

Invariantes específicas de este test (scopeadas a los datos generados vía el marcador y el baseline):

| Invariante | Resultado |
|---|---|
| **E1** — `expenses.amount` (mercadería) = Σ(`expense_items.unit_cost × quantity`) | ✅ 0 |
| **E2** — movimientos `purchase` = Σ ítems del gasto (por gasto/producto/variante) | ✅ 0 |
| **E3** — delta de stock (post − baseline) = Σcompras − Σventas (variant-aware) | ✅ 0 |
| **E5** — signos: `purchase.quantity > 0`, `expenses.amount > 0` | ✅ 0 |

Invariantes generales del dataset (06-reconciliacion.sql), scopeadas a tienda de seba tras refrescar snapshots:

| Invariante | Resultado | Nota |
|---|---|---|
| R1 — `total` de línea = `qty × precio` | ✅ 0 | |
| R2 — `subtotal` = Σ ítems | ✅ 0 | |
| R3 — `total` = `subtotal − descuento` | ✅ 0 | |
| R6 — snapshots == recálculo en vivo (incl. `expenses_total`, `operating_expenses_total`, `inventory_expenses_total`) | ✅ 0 | el split operativo vs mercadería en el snapshot cuadra exacto |
| R6b — todo día con ventas tiene snapshot | ✅ 0 | |
| R4 — pagos cubren el total | ⚠️ 2 | **Pre-existentes** |
| R5 — stock vendido = movimientos | ⚠️ 2 | **Pre-existentes** |

### Las 2 anomalías R4/R5 son pre-existentes, no de esta sesión

Ambas corresponden a las **mismas dos ventas del 2026-05-14** (`c205e2ea…` y `5142bd60…`, total $250 / pagado $125, producto "Chau"), creadas por testing manual de UI con timestamps `18:11` y `18:19` (microsegundos). Las 50 ventas de esta prueba tienen `created_at` exacto a las `13:00:00` y pago cash = total, así que **no pueden** fallar R4 ni aparecer entre los ofensores de R5. Ya estaban documentadas en [07](07-stress-volumen.md) y en el backlog ("Bugs conocidos": borrar venta deja pagos huérfanos / cuenta corriente sin ledger).

> El test 07 las contó como R4=2 / R5=1; el conteo real de R5 es 2 (ambas ventas tienen el desfasaje de variante). Sigue siendo 100% pre-existente — el delta no cambió por nada que hiciéramos en esta sesión.

---

## Conclusión

- **Integridad de gastos al 100%.** 120 gastos (80 operativos + 40 de mercadería) cuadran al centavo: el monto del gasto es exactamente la suma de sus ítems, y el snapshot diario separa operativos de mercadería sin drift.
- **El stock se mueve perfecto.** Las 40 compras generaron 77 movimientos `purchase` que igualan unidad por unidad a sus ítems, y el delta de stock final (compras menos ventas, variant-aware) coincide exacto con el baseline — conviviendo con 50 ventas nuevas sobre los mismos productos.
- **Cero anomalías nuevas.** Las únicas 2 que aparecen (R4/R5) son las pre-existentes del 2026-05-14, ajenas a esta prueba. El harness volvió a confinarlas correctamente.

### Limpieza pendiente

Todo lo generado acá es descartable. Para borrarlo:

```sql
-- gastos + ítems + movimientos de compra de esta prueba
DELETE FROM inventory_movements
WHERE type='purchase'
  AND reference_id IN (SELECT id FROM expenses WHERE notes='stress-gastos-20260530');
DELETE FROM expense_items
WHERE expense_id IN (SELECT id FROM expenses WHERE notes='stress-gastos-20260530');
DELETE FROM expenses WHERE notes='stress-gastos-20260530';
-- (las 50 ventas sintéticas no quedan marcadas; si se quieren purgar, cruzar por created_at exacto 13:00:00 en la ventana)
```

> Ojo: borrar las compras **no revierte** el stock que sumaron (no hay reversa automática por `DELETE` directo). Si se purga, recalcular stock desde el ledger o restaurar el baseline. Por eso lo más limpio es eliminar el negocio de prueba entero antes de salir de beta, como indica [07](07-stress-volumen.md).
