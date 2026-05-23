# Test 01 — Flujo de venta en el POS

**Perfil de usuario objetivo:** almacén, 100-200 ventas/día, efectivo y transferencia principalmente.

**Setup previo:** tener al menos 5 productos con stock > 0, una lista de precios activa, y un operario creado.

---

## 1.1 Venta simple en efectivo

**Objetivo:** venta básica funciona de punta a punta.

- [ ] Agregar 1 producto al carrito
- [ ] Verificar que el precio mostrado es correcto (con lista activa si corresponde)
- [ ] Seleccionar método Efectivo, ingresar monto
- [ ] Confirmar venta
- [ ] Verificar toast de confirmación
- [ ] Verificar que el stock del producto decrementó exactamente en 1
- [ ] Verificar que la venta aparece en el historial del dashboard

---

## 1.2 Venta con múltiples productos

- [ ] Agregar 4-5 productos distintos al carrito
- [ ] Modificar la cantidad de uno a 3 unidades
- [ ] Verificar subtotal y total calculados correctamente
- [ ] Completar venta en efectivo
- [ ] Verificar que el stock de cada producto decrementó por la cantidad vendida

---

## 1.3 Venta con pago mixto (efectivo + transferencia)

- [ ] Agregar productos por un total de ~$5.000
- [ ] Activar pago mixto
- [ ] Poner $2.000 en efectivo y el resto en transferencia
- [ ] Confirmar venta
- [ ] Verificar que los dos métodos aparecen en el detalle de la venta

---

## 1.4 Venta con descuento

- [ ] Agregar productos al carrito
- [ ] Aplicar descuento del 10%
- [ ] Verificar que el total refleja el descuento
- [ ] Completar venta
- [ ] Verificar que en el historial figura el descuento aplicado

---

## 1.5 Venta con override de precio manual

- [ ] Agregar un producto al carrito
- [ ] Editar el precio de esa línea manualmente
- [ ] Verificar que el total se recalcula
- [ ] Completar venta
- [ ] Verificar que en el detalle de la venta figura el precio overrideado y el motivo si se ingresó

---

## 1.6 Venta con línea libre

- [ ] Agregar una línea libre con descripción y precio
- [ ] Agregar también un producto normal
- [ ] Completar venta
- [ ] Verificar que la línea libre no afecta ningún stock
- [ ] Verificar que aparece en el recibo con la descripción correcta

---

## 1.7 Volumen — 20 ventas seguidas

**Objetivo:** detectar degradación, errores silenciosos o bugs de concurrencia bajo uso sostenido.

- [ ] Hacer 20 ventas consecutivas sin parar (simular hora pico)
- [ ] Ventas variadas: distintos productos, distintos métodos de pago
- [ ] Verificar que ninguna venta quedó sin registrar
- [ ] Verificar que el stock de los productos más vendidos es consistente con la cantidad de ventas
- [ ] Verificar que no hubo errores en Sentry durante la ronda

**Cómo verificar el stock:**
```sql
-- Reemplazar con los IDs de los productos usados
SELECT id, name, stock, sales_count FROM products 
WHERE business_id = get_business_id()
ORDER BY sales_count DESC LIMIT 10;
```

---

## 1.8 Anulación de venta

- [ ] Hacer una venta normal
- [ ] Anularla desde el historial del dashboard
- [ ] Verificar que el stock volvió al valor anterior
- [ ] Verificar que la venta figura como anulada, no desaparece del historial

---

## 1.9 Venta con operario activo

- [ ] Cambiar al operario (no dueño) desde el selector
- [ ] Hacer una venta
- [ ] Verificar que la venta queda asociada al operario en el historial
- [ ] Verificar que el operario figura en el registro de actividad
