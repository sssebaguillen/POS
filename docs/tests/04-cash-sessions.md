# Test 04 — Sesiones de caja y arqueo

---

## 4.1 Abrir caja desde el POS

- [ ] Ir al POS sin sesión de caja activa
- [ ] Verificar que aparece el banner amber "No hay caja abierta"
- [ ] Hacer clic en "Abrir caja"
- [ ] Ingresar fondo inicial de $5.000
- [ ] Confirmar
- [ ] Verificar que el widget cambia a verde "Caja abierta"
- [ ] Verificar que muestra la hora de apertura y el nombre del operario

---

## 4.2 Ventas dentro de la sesión

- [ ] Con sesión abierta, hacer 5 ventas
- [ ] Verificar que el widget actualiza el contador de ventas y el total acumulado
- [ ] Ir a /cash-sessions y verificar que la sesión activa muestra los mismos números

---

## 4.3 Cerrar caja — arqueo exacto

- [ ] Hacer exactamente $10.000 en ventas en efectivo (para tener un expected conocido)
- [ ] Hacer clic en "Cerrar caja"
- [ ] Verificar el resumen: ventas del turno, desglose por método
- [ ] El efectivo esperado debe ser: fondo inicial + ventas en efectivo
- [ ] Ingresar ese mismo monto como "efectivo contado"
- [ ] Verificar que la diferencia muestra "Cuadra exacto"
- [ ] Confirmar cierre
- [ ] Verificar que el widget vuelve al estado sin sesión

---

## 4.4 Cerrar caja — con diferencia

- [ ] Abrir nueva sesión con fondo $2.000
- [ ] Hacer ventas en efectivo por $3.000 (expected = $5.000)
- [ ] Al cerrar, ingresar $4.800 como contado
- [ ] Verificar que la diferencia muestra "-$200 faltante" en rojo
- [ ] Ingresar notas: "faltaron $200"
- [ ] Confirmar y verificar en /cash-sessions que la sesión cerrada muestra la diferencia correcta

---

## 4.5 Sugerencia de fondo del turno anterior

- [ ] Cerrar una sesión con contado = $7.500
- [ ] Abrir nueva sesión inmediatamente
- [ ] Verificar que el campo fondo inicial está pre-completado con $7.500
- [ ] Verificar que aparece el hint "Sugerido del cierre anterior"
- [ ] Cambiar el monto y verificar que el hint desaparece

---

## 4.6 No se pueden abrir dos sesiones simultáneas

- [ ] Abrir una sesión de caja
- [ ] Intentar abrir otra (si hay otro operario, que intente también)
- [ ] Verificar que el sistema muestra error "Ya existe una sesión de caja abierta"

---

## 4.7 Historial en /cash-sessions

- [ ] Ir a /cash-sessions
- [ ] Verificar que el historial muestra todas las sesiones anteriores
- [ ] Verificar columnas: fecha, quién abrió, quién cerró, duración, ventas, total, diferencia
- [ ] La diferencia debe ser verde si ≥ 0, roja si < 0
- [ ] Las sesiones abiertas no muestran diferencia

---

## 4.8 Detalle de sesión

- [ ] Hacer clic en una sesión cerrada del historial
- [ ] Verificar que el panel lateral muestra:
  - Fechas y operarios de apertura y cierre
  - Fondo inicial
  - Cantidad y total de ventas
  - Desglose por método de pago
  - Efectivo esperado, contado y diferencia
  - Notas si las hubo

---

## 4.9 Ventas sin sesión activa

- [ ] Cerrar la sesión de caja
- [ ] Hacer una venta
- [ ] Verificar que la venta se completa sin error (el POS no bloquea)
- [ ] Verificar en SQL que `sales.session_id` es NULL para esa venta:

```sql
SELECT id, session_id, total, created_at 
FROM sales 
WHERE business_id = get_business_id()
ORDER BY created_at DESC LIMIT 5;
```
