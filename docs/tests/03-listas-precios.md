# Test 03 — Listas de precios y distribución

**Perfil de usuario objetivo:** almacén que funciona también como distribuidor, con distintos precios según cliente/canal.

---

## 3.1 Creación de lista de precios

- [ ] Crear lista "Mayorista" con multiplicador 1.20 (20% sobre costo)
- [ ] Verificar que los precios calculados en la lista son correctos para 5 productos
- [ ] Crear lista "Minorista" con multiplicador 1.50
- [ ] Verificar que ambas listas coexisten sin pisarse

---

## 3.2 Lista con override por producto

- [ ] En la lista "Mayorista", setear un override del 1.10 para el producto A
- [ ] Verificar que A muestra precio con 1.10 y el resto con 1.20
- [ ] Verificar que el override se guarda y persiste al recargar la página

---

## 3.3 Lista con override por marca

- [ ] En la lista "Mayorista", setear override de 1.15 para la marca X
- [ ] Verificar que todos los productos de la marca X muestran precio con 1.15
- [ ] Verificar que un producto de marca X con override individual usa su override (no el de marca)

---

## 3.4 Aplicar lista en el POS

- [ ] En el POS, seleccionar la lista "Mayorista"
- [ ] Agregar producto A al carrito
- [ ] Verificar que el precio en el carrito corresponde al calculado por `calculateProductPrice` con esa lista
- [ ] Cambiar a lista "Minorista" sin limpiar el carrito
- [ ] Verificar que los precios del carrito se actualizan

---

## 3.5 Precio manual vs lista activa

- [ ] Con lista "Mayorista" activa en el POS
- [ ] Agregar producto B al carrito
- [ ] Editar manualmente el precio de B
- [ ] Cambiar la lista activa
- [ ] Verificar que el precio de B NO cambia (está marcado como manual)
- [ ] Verificar que los demás productos SÍ actualizan su precio con la nueva lista

---

## 3.6 Producto sin costo con lista activa

**Caso edge frecuente en almacenes.**

- [ ] Crear un producto con costo = 0 y precio = $500
- [ ] Activar una lista de precios con multiplicador 1.30
- [ ] Agregar el producto al carrito
- [ ] Verificar que usa el precio directo ($500) y no intenta multiplicar sobre 0
- [ ] Verificar en el inventario que la lista muestra "Sin costo" o similar sin crashear

---

## 3.7 Venta con lista y verificación en historial

- [ ] Hacer una venta aplicando la lista "Mayorista"
- [ ] Ir al historial del dashboard
- [ ] Verificar que la venta muestra la lista de precios usada
- [ ] Los precios registrados deben coincidir con los de la lista en el momento de la venta

---

## 3.8 Lista por defecto

- [ ] Marcar "Mayorista" como lista por defecto
- [ ] Cerrar el POS y volver a abrirlo
- [ ] Verificar que la lista "Mayorista" está seleccionada automáticamente
- [ ] Cambiar la lista por defecto a "Minorista"
- [ ] Recargar el POS y verificar que ahora arranca con "Minorista"
