# Roadmap de mejoras — Pulsar POS

> Documento vivo de recomendaciones de la revisión del **2026-06-20** (sesión en vivo).
> Se va marcando `[x]` a medida que cada ítem se completa. Origen: corrida de recomendaciones
> sobre el estado actual de la app. Complementa a [`backlog.md`](backlog.md) (no lo reemplaza).

## La lente

El cuello de botella de Pulsar **no son features** — la app ya hace más que muchos POS pagos
(venta, caja, clientes con cuenta corriente, catálogo + pedidos online, estadísticas ricas,
gastos, promos, listas, audit, permisos, IA proactiva, kardex en construcción). El cuello es
**confianza / validación / go-to-market**. Por eso el mayor leverage está en lo que hace que un
dueño confíe en 5 minutos y en lo que destraba el lanzamiento — no en sumar funcionalidad.

---

## Orden de ejecución acordado (2026-06-20, refinado y confirmado)

Secuencia principal:

1. [ ] **1.3 — Loop de compartir catálogo** + **2.4 — Etiquetas/códigos de barras** (quick wins juntos, en vivo)
2. [ ] **2.1 — Ficha de cliente con estado de cuenta + historial** (scope reads-only → **agente nocturno**)
3. [ ] **1.1 — Datos demo / sandbox** (rellenar después de 2.1 para que el demo ejercite la ficha nueva; flexible — los datos viven en DB, se puede antes)
4. [ ] **2.2 — Devoluciones** (empezar la **exploración de UX ya**; construir en 1–2 días + su E2E)
5. [ ] **2.3 — Módulo de compras `/purchases`** (detrás de 2.2)
6. [ ] **UI/UX** con `/impeccable`, `/emil-design-eng`, `/transitions-dev` (POS + primer-uso)
7. [ ] **1.4 — Importación/migración de datos** (feature self-serve; ver detalle — wedge de adopción)

Transversales (no son un paso único):
- [ ] **Thermonuclear** como pasada de cleanup al cerrar **cada feature sustancial** (2.1, devoluciones, compras) **y** como driver del refactor de `InventoryPanel` (4.1).
- [ ] **4.3 — E2E viaja con cada feature money-path** (devoluciones, compras, cuenta corriente), no diferido.
- [ ] **4.2 — Barrido de errores + error boundaries** → **agente nocturno** (chico, ya sembrado customers/providers).

En paralelo (decisión del dueño, no dev):
- [ ] **1.2 — Naming/rebrand** — bloqueante real de go-to-market. No bloquea la cola de dev, pero sí el lanzamiento.

---

## Detalle de los ítems

### 1. Adopción y confianza

**1.1 — Datos demo / sandbox (modo jugar)** · `[ ]`
Hay onboarding (wizard + checklist) pero tras completarlo el dueño aterriza en dashboard/stats
vacíos → cero "aha". Propuesta: **datos de muestra cargables y borrables** (catálogo + ventas
sembradas) + **"primera venta guiada"**. Es un **sandbox para experimentar sin ensuciar métricas
reales** — distinto de 1.4 (importar datos reales). Las dos conviven: el sandbox sigue valiendo
porque jugar con datos reales arruinaría las métricas del negocio. No money-path si es
borrable/aislado; sí decisión de producto.

**1.2 — Naming/rebrand** · `[ ]`
Bloqueante de go-to-market (ver [`branding.md`](branding.md) y memoria). Decisión, no dev.

**1.3 — Loop de compartir catálogo** · `[ ]`
El catálogo público (`puls.ar/slug`) es la superficie viral. Afordances de **compartir (QR +
link)** desde la app → cada cliente difunde. Bajo costo, alto retorno de adopción.

**1.4 — Importación / migración de datos reales** · `[ ]`
Traer la historia real de un negocio establecido (productos + ventas de varios años + clientes)
para que vea **su** negocio dentro de Pulsar — con métricas reales y sugerencias de IA sobre su
propia data. Es el **wedge de adopción** para PyMEs que migran de "software menores" (caso del
usuario de ~10 años: miles de ventas/día, reposición casi diaria, 2 operarios + owner). Hoy el
dueño lo hace **manual** (recibe los datos del cliente y los carga); como **feature self-serve**
(importador CSV/Excel de productos + histórico de ventas + clientes) es un diferenciador fuerte.
Grande, money-path (escribe ventas/stock históricos) → diseño cuidado + E2E. No urgente para la
beta pero alto impacto de cierre/confianza. *(Nota: el usuario grande aún no envió sus datos.)*

### 2. Huecos de feature

**2.1 — Ficha de cliente: estado de cuenta + historial** · `[ ]`
`CustomerView` muestra el saldo pero no el **historial de compras ni el estado de cuenta** por
cliente. La cuenta corriente queda a medio servir (no se le puede mostrar al cliente "esto
debés + estas compras"). Mayormente lectura. Money-path-adjacent. **Grande pero acotable →
candidato a agente nocturno si se scopea reads-only.**

**2.2 — Devoluciones de primera clase** · `[ ]`
Existe estado `refunded` + `delete_sale`, pero falta un flujo limpio **"devolver producto →
reingresa stock + ajusta caja/cuenta"**. Sin eso, las devoluciones descuadran caja. **Bloqueante
= diseño de producto/UX** (cómo que sea natural, rápido y sin fricción pero completo). Money-path
→ E2E. Diferido 1–2 días para explorar la UX.

**2.3 — Módulo de compras `/purchases`** · `[ ]`
Reposición vía compra (no edit manual de stock). Hoy lo cubre a medias el gasto-mercadería; para
beta no es imprescindible. Cierra el loop de **Salud de inventario** (detecta stock muerto/
sobrestock pero no hay acción de reponer). Diferido ~1 día. Ya esbozado en backlog/memoria.

**2.4 — Impresión de etiquetas / códigos de barras** · `[ ]`
El POS ya **lee** scanner; falta **generar etiquetas imprimibles** (precio + barcode). Necesidad
real de kiosco/almacén. *(Ojo: tiene matices de formato — térmica vs hoja A4, simbología de
barcode — que lo hacen menos trivial de lo que parece.)*

### 3. Diseño / UX (con las skills)

**3.1 — Auditar el POS** con `/impeccable` + `emil-design-eng`/`transitions-dev` · `[ ]`
Driver diario: ergonomía, velocidad, mobile.

**3.2 — Auditar primer uso / empty states / dashboard** · `[ ]`
Atado a 1.1: primera impresión que define si se quedan.

**3.3 — Pasada de motion** en micro-interacciones clave (agregar al carrito, éxito de pago) · `[ ]`
Calidad percibida → confianza.

### 4. Calidad / técnica

**4.1 — Thermonuclear sobre `InventoryPanel`** (~1291 líneas) · `[ ]`
CLAUDE.md ya marca su refactor pendiente. Target perfecto para el primer "code judo".

**4.2 — Cerrar barrido de errores tragados + error boundaries** · `[ ]`
Hecho `/stats`; sembrado customers/providers. Cerrar con `error.tsx` a nivel `(app)` + revisar
otros Server Components.

**4.3 — Ampliar E2E** · `[ ]`
Hoy cubre registro→venta→caja. Sumar cuenta corriente / pedido-online→venta / devoluciones
cuando existan.

---

## Bitácora de decisiones

- **2026-06-20** — Creado el roadmap. **Orden refinado confirmado por el dueño:** (1.3+2.4) →
  2.1 → 1.1 → 2.2 → 2.3 → UI/UX → 1.4; transversales: thermonuclear por-feature, E2E con cada
  feature money-path, 4.2 al agente nocturno; 1.2 (naming) en paralelo. Distinción clave aclarada:
  **1.1 (sandbox para jugar) ≠ 1.4 (importar datos reales)** — conviven. Agregado 1.4 como ítem
  (wedge de adopción para negocios establecidos; hoy manual, futuro self-serve). Arranca 1.3.
