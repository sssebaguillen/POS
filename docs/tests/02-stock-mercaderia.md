# Test 02 — Stock y gastos de mercadería

**Perfil de usuario objetivo:** almacén con stock volátil, ~10 pedidos de mercadería por semana.

---

## 2.1 Carga de mercadería básica

- [ ] Ir a Gastos → Nuevo gasto → categoría Mercadería
- [ ] Agregar 3 productos con cantidades y costos distintos
- [ ] Guardar el gasto
- [ ] Verificar que el stock de cada producto incrementó correctamente
- [ ] Verificar que el costo de cada producto se actualizó si se marcó la opción
- [ ] Verificar que aparece en el historial de gastos con el total correcto

---

## 2.2 Edición de mercadería — delta de stock

**Objetivo:** el RPC `update_mercaderia_expense` hace reconciliación por delta, no reemplaza.

- [ ] Crear un gasto de mercadería con producto A × 10 unidades
- [ ] Anotar el stock resultante de A
- [ ] Editar ese gasto y cambiar A a 15 unidades (agregar 5)
- [ ] Verificar que el stock de A aumentó exactamente 5 (no 15)
- [ ] Editar de nuevo y bajar A a 8 unidades (quitar 7)
- [ ] Verificar que el stock de A bajó exactamente 7

---

## 2.3 Edición de mercadería — quitar un producto

- [ ] Crear gasto con productos A y B
- [ ] Editar y eliminar B de la lista
- [ ] Verificar que el stock de B volvió al valor anterior al gasto
- [ ] Verificar que el stock de A no cambió

---

## 2.4 Edición de mercadería — conflicto de costo

- [ ] Crear gasto con producto A, costo $100
- [ ] Hacer una venta de A (para que el costo ya esté "en uso")
- [ ] Editar el gasto cambiando el costo de A a $120
- [ ] Verificar que el sistema muestra advertencia de conflicto de costo
- [ ] Confirmar la opción elegida y verificar que el costo quedó actualizado correctamente

---

## 2.5 Stock negativo — comportamiento esperado

**Decisión de diseño explícita:** el POS permite vender con stock en 0 o negativo. En almacenes de alto volumen es común vender un producto antes de haberlo cargado al sistema. El stock negativo es una señal de que hay mercadería pendiente de registrar, no un error.

- [ ] Crear un producto con stock = 1
- [ ] Vender 1 unidad → stock queda en 0
- [ ] Vender 1 unidad más → stock queda en -1, la venta se completa sin error
- [ ] **Resultado esperado (correcto):** venta completada, stock = -1
- [ ] Cargar mercadería de ese producto → stock vuelve a positivo

**Verificar stock negativo actual en SQL:**
```sql
SELECT name, stock FROM products 
WHERE stock < 0 AND business_id = get_business_id();
```

Stock negativo en esta query es normal y esperado, no indica un problema.

---

## 2.6 Stock con variantes

- [ ] Crear producto con 3 variantes (ej: talle S, M, L), cada una con stock distinto
- [ ] Vender variante M × 2 unidades
- [ ] Verificar que solo el stock de la variante M decrementó
- [ ] Verificar que el stock de S y L no cambió
- [ ] Cargar mercadería solo de variante L
- [ ] Verificar que solo el stock de L aumentó

---

## 2.7 Movimientos de inventario

- [ ] Después de hacer ventas y cargas de mercadería
- [ ] Verificar en SQL que los movimientos quedaron registrados:

```sql
SELECT type, quantity, reason, created_at 
FROM inventory_movements 
WHERE business_id = get_business_id()
ORDER BY created_at DESC 
LIMIT 20;
```

- [ ] Ventas deben aparecer como `type = 'sale'` con `quantity` negativa
- [ ] Mercadería debe aparecer como `type = 'purchase'` con `quantity` positiva
