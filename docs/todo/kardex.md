# Kardex de inventario — diseño detallado (libro mayor de stock)

> **Estado:** 🔒 NEEDS-OWNER — diseño para ejecutar en sesión(es) en vivo. **Toca el camino del dinero** (trigger de venta, `delete_sale`, `update_sale`) → cada fase exige **E2E verde** antes de cerrar. NO es trabajo del agente headless (no tiene DB para correr E2E).
>
> **Decisión tomada (2026-06-20):** la tabla `inventory_movements` **se conserva y se completa** — NO se rehace de cero. La estructura es sólida; lo que falta es disciplina de escritura, dejar de borrar, y la capa de lectura. Ver "¿Ajustar o rehacer?" abajo.
>
> Verificado contra `supabase/schema.sql` + datos en vivo (read-only) el 2026-06-20.

---

## 1. Qué es y por qué

Un **kardex** es el libro mayor de inventario: el registro inmutable de **cada** movimiento de stock de un producto (entró 20 por compra, salieron 3 por venta, ajuste manual de −1, devolución +2…) de modo que siempre se cumpla el invariante:

```
stock_actual = stock_inicial (opening) + Σ movimientos
```

Es una **feature de confianza** para el comerciante: responde *"¿por qué tengo 5 si compré 20?"* con un historial auditable por producto. Hoy ese historial existe a medias y **nadie lo puede ver** (0 lecturas en `src/`).

Encaja como insumo natural del **módulo contable (P10.c, diferido)**: si la contabilidad avanza, el kardex es su base de valuación de inventario. No bloquea P10.c ni al revés, pero se diseñan compatibles.

---

## 2. Diagnóstico — qué hay hoy (con archivo:línea)

### 2.1 La tabla (sólida)

`supabase/schema.sql:8745`

```sql
inventory_movements (
  id uuid pk,
  business_id uuid,            -- FK businesses (ON DELETE CASCADE)
  product_id uuid,             -- FK products (ON DELETE SET NULL)
  variant_id uuid,             -- FK product_variants (ON DELETE SET NULL)
  type text NOT NULL,          -- CHECK: sale | purchase | adjustment | return
  quantity integer NOT NULL,   -- FIRMADO (ver convención abajo)
  reason text,
  reference_id uuid,           -- venta/gasto de origen
  created_at timestamptz DEFAULT now(),
  created_by_operator uuid     -- FK operators (ON DELETE SET NULL), NULL = dueño
)
-- RLS: policy tenant_isolation (business_id = get_business_id())  [schema.sql:10311]
-- Índices: business_id, product_id, variant_id (partial), created_by_operator
```

Tiene todo lo que un kardex necesita: variantes, atribución por operador, link al origen, aislamiento por tenant, índices correctos, y el CHECK ya contempla los 4 tipos. **No hay razón para rehacerla.**

### 2.2 Quién la ESCRIBE (3 caminos)

| Origen | Archivo:línea | Tipo | Signo | Operador |
|---|---|---|---|---|
| Trigger de venta `update_stock_on_sale` (fires en `sale_items` insert) | `schema.sql:8038` (insert en `:8063`) | `sale` | `-qty` (negativo) | ❌ no setea `created_by_operator` |
| `create_mercaderia_expense` | `schema.sql:1120` (insert en `:1212`) | `purchase` | `+qty` (positivo) | ✅ setea (pero NULL si dueño) |
| `update_mercaderia_expense` | `schema.sql:6977` (insert `:7208`, UPDATE `:7135`, DELETE `:7078`) | `purchase` | `+qty` | ❌ no setea en el insert |

> `create_sale_transaction` (`schema.sql:1846`) y la conversión de pedido online (`update_catalog_order_status`, `:6709`) **no escriben movimientos directo** — insertan `sale_items` y dejan que el trigger lo haga. O sea el camino de venta ya tiene **un solo punto de entrada** (el trigger). Bien.

### 2.3 Quién la BORRA / muta (anti-ledger — 5 funciones)

Un libro mayor real **nunca borra ni edita** un asiento; compensa con uno nuevo. Hoy:

| Función | Archivo:línea | Qué hace mal |
|---|---|---|
| `delete_sale` | `schema.sql:2666` | `DELETE FROM inventory_movements WHERE reference_id = sale_id` |
| `delete_expense` | `schema.sql:2415` | `DELETE ... WHERE reference_id = expense_id` |
| `delete_product` | `schema.sql:2623` | `DELETE ... WHERE product_id = ...` |
| `bulk_delete_products` | `schema.sql:317` | `DELETE ... WHERE product_id = ...` |
| `update_mercaderia_expense` | `schema.sql:7078` (DELETE) + `:7135` (**UPDATE quantity in-place**) | borra items removidos y **edita la cantidad de un asiento histórico** |

### 2.4 Mutaciones de stock que NO loguean (los huecos)

| Función | Archivo:línea | Hueco |
|---|---|---|
| `create_product` | `schema.sql:1471` (stock en `:1523`) | stock inicial nunca asentado |
| `create_product_with_variants` | `schema.sql:1554` (stock de variante ~`:1678`) | stock inicial de variante nunca asentado |
| `update_product` | `schema.sql:7500` (`stock` editable en `:7575`) | **ajuste manual de stock** no asentado (sí queda en `audit_log`, no en el kardex) |
| `update_product_variants` | `schema.sql:7614` | ajuste manual de stock de variante (auditar durante impl.) |
| `delete_sale` | `schema.sql:2661-2665` | revierte stock **solo de `products`, ignora `variant_id`** → 🐛 **bug latente**: borrar una venta con variante restaura el stock del padre, no de la variante |
| `update_sale` | `schema.sql:7993-8004` | revierte stock manual (este sí maneja variantes) y re-inserta items → el trigger asienta los nuevos, pero **los movimientos `sale` viejos quedan huérfanos** (nunca se revierten) → 🐛 el kardex **dobla** los asientos tras editar una venta |
| `delete_expense` | `schema.sql:2393-2395` | revierte stock y borra movimientos |

### 2.5 Nadie la LEE

`grep -rniE "inventory_movements" src/` → **cero**. No hay UI ni RPC de lectura. Tipos `adjustment` y `return` **nunca se escriben**.

---

## 3. Evidencia empírica (datos en vivo, read-only, 2026-06-20)

**Distribución y signo** (confirma la convención de signo firmado):

| type | filas | positivos | negativos | con variante | con operador |
|---|---|---|---|---|---|
| `purchase` | 171 | 171 | 0 | 79 | **0** |
| `sale` | 1267 | 0 | 1267 | 96 | **0** |

→ Convención **firmada confirmada** (`sale` negativo, `purchase` positivo). `adjustment`/`return` = 0 filas. **`created_by_operator` está NULL en el 100% de las filas** (los negocios de prueba son todos del dueño; aun así el trigger de venta ni siquiera lo setea).

**Deriva `stock_actual` vs `Σ movimientos`** (productos sin variante):

| Negocio | productos | con deriva | deriva total (u) |
|---|---|---|---|
| **Cecilia (ÚNICA cuenta real)** | 12 | **0** | **0** |
| Q tal lokis (test) | 30 | 30 | 30.000 |
| tienda de seba (test) | 5 | 4 | 157 |

> ⚠️ **`Q tal lokis` y `tienda de seba` son cuentas de prueba; la única cuenta real es Cecilia** (ver [[feedback_dev_businesses_only]]). Su stock está sembrado a mano (de ahí los 30.000 u redondos), **no** refleja uso real.

→ Leído correctamente: **en los datos reales el kardex YA reconcilia** (Cecilia: 12/12, deriva 0 — solo movió stock vía compras/ventas, nunca cargó stock inicial ni lo ajustó a mano, que son justo los caminos no logueados). La deriva masiva vive solo en las cuentas de prueba, donde se cargó stock inicial directo. **Conclusión:** el opening snapshot **no** arregla un problema de producción actual — lo necesitamos por **corrección estructural y a futuro**: en cuanto un usuario real cargue stock inicial al crear un producto o lo ajuste a mano (`create_product`/`update_product`, hoy sin loguear), la deriva aparecería. El opening sienta la línea de base para que el invariante se sostenga siempre (sección 5.4), no para tapar un agujero existente.

**Seguridad:** `anon` tiene `GRANT ALL` (INSERT/UPDATE/DELETE/SELECT/TRUNCATE) sobre la tabla (`schema.sql:19060`). La RLS `tenant_isolation` lo salva (`get_business_id()` es NULL para anon → 0 filas), así que **no es explotable hoy**, pero es un grant sucio que viola la regla 34 → revocar al tocar la tabla (fase 0).

---

## 4. ¿Ajustar o rehacer? → **Ajustar**

| Criterio | Veredicto |
|---|---|
| Estructura de la tabla | ✅ Sólida — rehacerla rediseñaría las mismas columnas |
| Datos existentes | 1.438 asientos reales (sale+purchase) — tirarlos no aporta |
| Convención de signo | ✅ Ya firmada y consistente |
| Problema real | Cobertura incompleta + borrado destructivo + sin lectura — **disciplina, no estructura** |

**Cambio de raíz necesario:** hoy el stock se muta **inline en ~9 lugares**. Eso es lo que deja derivar el libro. La solución es **un único punto de paso** (sección 5.1) por el que pasen TODAS las mutaciones de stock — así el kardex no puede divergir por construcción.

---

## 5. Diseño

### 5.1 El corazón: helper `record_stock_movement` (único choke point)

Una función `SECURITY DEFINER` que en **una sola operación atómica**: (a) actualiza `products.stock` o `product_variants.stock`, y (b) asienta la fila en `inventory_movements` con el `balance_after` resultante.

```sql
-- Firma propuesta (afinar en impl.)
record_stock_movement(
  p_business_id   uuid,
  p_product_id    uuid,
  p_variant_id    uuid,        -- NULL si el producto no tiene variantes
  p_type          text,        -- sale | purchase | adjustment | return | opening
  p_quantity      integer,     -- FIRMADO (delta a aplicar): venta −, compra/devolución/opening +
  p_reason        text,
  p_reference_id  uuid,        -- venta/gasto de origen (NULL para ajuste/opening manual)
  p_operator_id   uuid         -- NULL = dueño
) RETURNS void
```

Comportamiento:
1. `UPDATE` del stock correspondiente (`+ p_quantity`, ya firmado) y devolver el nuevo valor.
2. `INSERT` en `inventory_movements` con `quantity = p_quantity` y `balance_after = nuevo_stock`.
3. **Nunca** lee/edita/borra asientos previos.

Todas las funciones que hoy tocan stock dejan de hacer `UPDATE ... SET stock = ...` inline y llaman a este helper. El **trigger de venta sigue existiendo** (es el punto de entrada del camino de venta) pero su cuerpo pasa a invocar el helper en vez de mutar stock + insertar a mano.

> **Nota de transacción:** el helper corre dentro de la misma transacción que su llamador (las RPC ya son atómicas). Si el llamador hace rollback, el asiento también. Correcto.

### 5.2 Cambio de esquema (mínimo, no destructivo)

1. **`ALTER TABLE inventory_movements ADD COLUMN balance_after integer;`** — saldo corrido por `(product_id, variant_id)` tras el movimiento. Permite leer "stock a tal fecha" y reconciliar barato. Histórico previo queda NULL (ver 5.4).
2. **Extender el CHECK de `type`** para incluir `'opening'`: `CHECK (type IN ('sale','purchase','adjustment','return','opening'))`.
3. (Opcional, decisión abierta — sección 8) `unit_cost numeric` para valuación de inventario (insumo de P10.c). **No** en v1 salvo que se decida; el costo vive hoy en `products/variants`.

**Convención de signo (se mantiene la actual):** `quantity` firmado.
- `sale` → negativo · `purchase` → positivo · `return` → positivo · `opening` → positivo (= stock inicial) · `adjustment` → delta firmado (puede ser ±).

### 5.3 Retrofit — mapa exacto de call sites

Cada uno deja de mutar stock inline y pasa por `record_stock_movement`:

| Función | Cambio |
|---|---|
| `update_stock_on_sale` (trigger) | cuerpo → `record_stock_movement(type='sale', qty=-NEW.quantity, ref=sale_id, op=...)`. **Sumar atribución de operador** (hoy NULL). El `sales_count` sigue acá. |
| `create_mercaderia_expense` | por item → helper `type='purchase', qty=+v_qty, op=v_stored_op_id` |
| `update_mercaderia_expense` | **dejar de UPDATE/DELETE asientos**: ítem removido → `return`/`adjustment` compensatorio; cambio de cantidad → asiento `adjustment` por el delta; ítem nuevo → `purchase` |
| `create_product` | si `stock>0` → helper `type='opening', qty=+stock, reason='Stock inicial'` |
| `create_product_with_variants` | por variante con `stock>0` → `opening` |
| `update_product` | si `p_changes ? 'stock'` y cambió → `adjustment` por el delta (`nuevo - viejo`), `reason='Ajuste manual'` |
| `update_product_variants` | ídem para variantes (auditar el path exacto en impl.) |
| `delete_sale` | **dejar de DELETE asientos**: por item → `return` compensatorio (`+qty`). **Arreglar el bug de variantes** (hoy solo revierte `products`). |
| `update_sale` | revertir items viejos con `return` compensatorio (en vez del UPDATE manual de stock) **antes** de borrar `sale_items`; el re-insert dispara el trigger que asienta los nuevos. Cierra el doble-conteo. |
| `delete_expense` | **dejar de DELETE asientos**: por item → `adjustment`/`return` compensatorio (`-qty`) |
| `delete_product` / `bulk_delete_products` | el producto se borra (FK `ON DELETE SET NULL` deja los asientos con `product_id=NULL`). **Decisión abierta** (sección 8): ¿dejar los asientos huérfanos como histórico, o asentar un `adjustment` de cierre antes de borrar? Hoy hacen `DELETE` — al menos quitar el `DELETE` y dejar que el FK los deje colgando es más "ledger" que borrarlos. |

### 5.4 Migración de opening snapshot (línea de corte)

Como el histórico está incompleto (sin opening ni ajustes manuales), **no se intenta reconstruir el pasado**. En su lugar:

1. Migración que inserta **un asiento `opening` por cada producto/variante con `stock <> 0`**, con `quantity = stock_actual`, `balance_after = stock_actual`, `reason = 'Saldo inicial (migración kardex)'`, `created_at = now()`.
2. Desde ese punto, el helper mantiene el invariante hacia adelante.
3. Los 1.438 asientos `sale`/`purchase` previos quedan con `balance_after = NULL` → **informativos**, no entran en el invariante.

**Invariante autoritativo (robusto, no depende de sumar el histórico):**

```
Para cada (product_id, variant_id):
  balance_after del movimiento más reciente  ==  products/variants.stock
```

El helper lo garantiza por construcción; el opening lo siembra. Esto va como test de reconciliación nuevo en `docs/tests/06-reconciliacion.sql` (junto a R1/R12 de promos) y, si se quiere, como check en CI.

### 5.5 Seguridad (fase 0)

`REVOKE ALL ON inventory_movements FROM anon;` (la tabla nunca se toca desde el cliente anon; el catálogo no la usa). Mantener `authenticated` (RLS sigue scopeando). Alinea con regla 34.

### 5.6 UI de lectura

- **"Historial de stock" por producto:** drawer/sección en `EditProductModal` (y/o `ProductStockModal`, que hoy ya abre por producto y es read-only vía `get_product_with_variants`). Lista cronológica: fecha, tipo (con glyph Phosphor), cantidad firmada, saldo resultante (`balance_after`), origen (link a venta/gasto), operador (`COALESCE(nombre, 'Dueño')`).
- **RPC nueva** `get_stock_history(p_business_id, p_product_id, p_variant_id?, paginado)` — `SECURITY DEFINER` + `assert_tenant` + `REVOKE anon` / `GRANT authenticated` (regla 34), gate de permiso `inventory_read`.
- Encaja con el módulo Compras / "Reponer stock" futuro y con la vista del Asistente P12 (señales de stock).

---

## 6. Plan de ejecución (por fases — cada fase = 1 PR, money-path → E2E + sesión en vivo)

> Las migraciones se **escriben** y quedan en el PR; **aplicar a prod lo hace Sebastián** (regla 4, [[project_migration_apply_mechanism]]). Mantener `supabase/schema.sql` en sync en cada fase.

- **Fase 0 — Prep no-breaking.** `ADD COLUMN balance_after`, extender CHECK con `opening`, crear `record_stock_movement` (todavía sin usar), `REVOKE anon`. Sin cambio de comportamiento. Verif: build + el helper testeado aislado.
- **Fase 1 — Opening snapshot.** Migración que siembra `opening` por producto/variante + setea `balance_after`. Test de invariante (5.4) pasa tras esto. (Solo escribe asientos, no cambia stock.)
- **Fase 2 — Rutear escritores existentes por el helper.** Trigger de venta + mercadería create/update. Verificar que el stock no cambia y el kardex queda correcto. **🔴 money-path → E2E.**
- **Fase 3 — Cerrar los huecos.** `create_product`/`create_product_with_variants` (`opening`), `update_product`/`update_product_variants` (`adjustment`). **🔴 toca inventario.**
- **Fase 4 — Anti-ledger + bugfixes.** Reemplazar los `DELETE`/`UPDATE` de asientos por compensaciones en `delete_sale`/`delete_expense`/`update_sale`/`update_mercaderia_expense`; arreglar el bug de variantes de `delete_sale` y el doble-conteo de `update_sale`; decidir `delete_product`/`bulk_delete_products`. **🔴 money-path → E2E.**
- **Fase 5 — Capa de lectura.** `get_stock_history` + UI "Historial de stock" + test de invariante en CI.

Orden recomendado estricto: **0 → 1 → 2 → 3 → 4 → 5** (cada una deja la app consistente; el invariante se puede verificar desde la fase 1).

---

## 7. Riesgos / cuidados

- **Doble conteo en `update_sale`** (hoy ya roto): la fase 2 mete el trigger en el re-insert; la fase 4 cierra el revert con compensación. Hacer las dos antes de confiar en el libro para ventas editadas.
- **`balance_after` y concurrencia:** el helper debe leer el stock *después* del `UPDATE` en la misma sentencia/transacción (`UPDATE ... RETURNING stock`) para que dos movimientos concurrentes no calculen el mismo saldo. El POS ya usa `FOR UPDATE` en caminos sensibles (regla 33); aplicar el mismo criterio.
- **No retroactivo:** el invariante vale **desde el opening**. Comunicar en la UI que el historial arranca en la fecha de migración (no inventar pasado).
- **Atribución de operador:** aprovechar para empezar a setear `created_by_operator` en todos los caminos (hoy 100% NULL). Pasar `getActorOperatorId(operator)` como ya hacen las RPC auditadas.

---

## 8. Decisiones abiertas (para Sebastián, en sesión en vivo)

1. **`unit_cost` en los asientos (valuación):** ¿sumamos `unit_cost` ahora (insumo de P10.c, permite valuar el inventario y calcular CMV) o lo dejamos para cuando se encare contabilidad? Recomendación: **dejarlo fuera de v1** salvo que P10.c esté cerca.
2. **`delete_product`/`bulk_delete_products`:** ¿asiento de cierre (`adjustment` a 0) antes de borrar, o dejar los asientos huérfanos (`product_id=NULL` vía FK) como histórico? Recomendación: **quitar el `DELETE` y dejar el FK colgar** (más barato, más "ledger"); evaluar asiento de cierre en fase 4.
3. **`opening` para productos con `stock = 0`:** ¿asentar opening 0 (deja todos los productos con al menos un asiento) o solo los `<> 0`? Recomendación: **solo `<> 0`** (menos ruido; el invariante con `balance_after` no lo necesita).
4. **Test de invariante en CI:** ¿lo sumamos a la suite cloud (387 tests, "Tests / Unit tests")? Recomendación: **sí**, como query de reconciliación en `06-reconciliacion.sql`.
5. **¿Vincular con P10.c desde ya?** El kardex es base de la valuación contable. Si contabilidad sigue diferida (memoria: no hasta varios usuarios reales), construir kardex **sin** acoplarlo a P10.c, dejando `unit_cost` como punto de extensión.

---

## 9. Fuera de alcance (v1)

- Valuación de inventario / CMV (depende de decisión 1 + P10.c).
- Conteos físicos / ajuste por inventario físico masivo (sería un nuevo origen `adjustment` con UI propia — feature aparte).
- Replay histórico anterior al opening (imposible, datos incompletos).
- Multi-depósito / ubicaciones (no hay modelo de depósitos hoy).
</content>
</invoke>
