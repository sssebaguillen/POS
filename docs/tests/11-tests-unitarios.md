# 11 — Tests unitarios y de componentes (Vitest)

> Suite de tests automatizados sobre la lógica de negocio (`src/lib/`), los API routes (`src/app/api/`) y los componentes del flujo de cobro (`src/components/pos/`).
> Última corrida: **325 tests en 23 archivos, todos en verde.**

Esta suite complementa los tests manuales (`01`–`04`) y los SQL/seguridad (`05`–`10`): cubre la **capa de lógica TypeScript + el flujo de cobro en React** que hasta ahora dependía 100% de revisión manual. Antes de esta suite el repo tenía **0 tests automatizados**.

---

## 1. Cómo correr

| Comando | Qué hace |
|---|---|
| `npm test` | Corre toda la suite una vez (modo CI). |
| `npm run test:watch` | Modo watch para desarrollo. |
| `npx vitest run --coverage` | Corre con reporte de cobertura (texto + `coverage/coverage-summary.json`). |
| `npx vitest run src/lib/__tests__/price-lists.test.ts` | Corre un archivo puntual. |

## 2. Infraestructura

- **Runner:** [Vitest](https://vitest.dev) (`vitest.config.ts` en la raíz). Elegido sobre Jest por arranque más rápido, ESM nativo y API compatible con Jest — encaja con Next 16 + TS sin transformaciones extra.
- **Environment:** `node` por defecto (la lógica no toca el DOM). Los tests de **componentes** declaran `// @vitest-environment jsdom` en la primera línea + `import '@/test/dom'` (helper compartido que registra los matchers de `@testing-library/jest-dom` y el `cleanup()` de RTL). Se evitó un `setupFiles` global a propósito para que los tests node nunca carguen `react-dom`/`jest-dom`.
- **Testing de componentes:** [React Testing Library](https://testing-library.com/) + `@testing-library/user-event`, sobre `jsdom`.
- **Alias `@/`:** resuelto en `vitest.config.ts` vía `resolve.alias` apuntando a `./src` (espeja `tsconfig.json`).
- **Timezone fijada:** `process.env.TZ = 'America/Argentina/Buenos_Aires'` en el config. Hace deterministas los tests de fechas/locale (mercado primario, UTC-3 sin DST). Sin esto, los tests de `date-utils` y `format` darían distinto según la máquina/CI.
- **Cobertura:** provider `v8`, scope `src/lib/**` + `src/app/api/**` (los componentes UI quedan fuera hasta tener jsdom). El directorio `coverage/` ya está en `.gitignore`.

## 3. Qué se testea (por módulo)

### Lógica de precios y carrito — el corazón del POS

| Archivo | Tests | Foco |
|---|---|---|
| `src/lib/__tests__/price-lists.test.ts` | 37 | `applyRounding`, `calculateProductPrice`, `resolveDisplayPrice`, `resolveCartItemPrice`, `getMarginPercent` |
| `src/lib/store/__tests__/cart.store.test.ts` | 36 | `resolveDiscountAmount` + todas las acciones y selectores del store Zustand |

**Regla de negocio clave codificada en los tests** (confirmada con el pedido del usuario):

- El **multiplicador de la lista de precios SOLO aplica cuando hay una lista activa Y `cost > 0`**. No es un margen global.
- El **carrito por defecto usa el precio del producto** (`unit_price` / precio de variante) tal cual; solo recalcula contra la lista si hay una seleccionada y la línea no es manual (`priceIsManual`).
- El **catálogo online muestra el precio del producto** (`resolveDisplayPrice` con `priceList = null` → devuelve `price`, nunca multiplica).
- Para variantes, `variant.price > 0` siempre gana sobre la lista (precio explícito de variante manda).

Estos invariantes están cubiertos con casos positivos y negativos (lista activa vs. null, cost 0 vs. >0, override de producto vs. marca, redondeo `step`/`up`, descuento `fixed`/`percent` con clamp a `[0, subtotal]`).

### Utilidades de dominio

| Archivo | Tests | Foco |
|---|---|---|
| `src/lib/__tests__/date-utils.test.ts` | 28 | Resolución de períodos, límites de semana (lunes), período anterior, params de URL |
| `src/lib/__tests__/format.test.ts` | 13 | `formatMoney`/`formatNumber`/`toTitleCase` bajo locale es-AR |
| `src/lib/__tests__/validation.test.ts` | 14 | `BUSINESS_SLUG_REGEX` + bloqueo de esquemas en `validateImageUrl` |
| `src/lib/__tests__/payments.test.ts` | 11 | Type guards, labels, mapas de color |
| `src/lib/__tests__/audit.test.ts` | 11 | Clasificación de tono + lookup de labels de auditoría |
| `src/lib/__tests__/mappers.test.ts` | 19 | Unwrap de relaciones, coerción de listas/overrides, stats de operadores |
| `src/lib/__tests__/errors.test.ts` | 16 | `translateDbError` — toda la tabla de mapeo |
| `src/lib/__tests__/accent-colors.test.ts` | 6 | Completitud de los 4 mapas de tonos |
| `src/lib/__tests__/utils.test.ts` | 4 | `cn()` (merge de clases Tailwind) |

### Seguridad — autenticación de operadores

| Archivo | Tests | Foco |
|---|---|---|
| `src/lib/__tests__/operator.test.ts` | 29 | Parseo de permisos + **cookie `operator_session` firmada con HMAC** |
| `src/app/api/operator/switch/__tests__/route.test.ts` | 10 | Route de switch owner/operador (mock de Supabase) |
| `src/app/api/operator/logout/__tests__/route.test.ts` | 4 | Logout solo borra cookies |

Los operadores montan sobre la sesión Supabase del dueño: la cookie firmada es **lo único** que restringe su rol/permisos. La suite verifica explícitamente los vectores de escalada de privilegios:

- ✅ Round-trip: una cookie recién firmada verifica y parsea de vuelta.
- ✅ **Manipulación rechazada:** editar el payload a `role: 'owner'` reusando la firma vieja → `null`.
- ✅ Cookie sin firmar (JSON plano legacy) → `null`.
- ✅ Firmada con otro secreto → `null`.
- ✅ **Fail-closed:** sin `OPERATOR_SESSION_SECRET`, `signOperatorSession` lanza (nadie puede operar).
- ✅ Route de switch: PIN normalizado a 4 dígitos, lockout de `verify_operator_pin` propagado al cliente, owner con password incorrecta → 401.
- ✅ Logout: ambas cookies a `maxAge: 0`, **nunca** re-emite una sesión firmada (guard contra auto-restauración del owner).

### API / integraciones

| Archivo | Tests | Foco |
|---|---|---|
| `src/app/api/catalog/orders/__tests__/route.test.ts` | 17 | Validación de payload anónimo, rate-limit per-IP, mapeo de errores RPC→HTTP |
| `src/lib/api/__tests__/sales.test.ts` | 11 | `unwrapRpc` (contrato de envelope) + wrappers de venta (mock RPC) |
| `src/lib/__tests__/inventory-products.test.ts` | 11 | Normalización de stock/precio de variantes + fetch paginado (mock Supabase) |
| `src/lib/__tests__/business.test.ts` | 9 | `requireAuthenticatedBusinessId` y helpers (mock Supabase) |
| `src/lib/__tests__/analytics.test.ts` | 6 | Contrato de privacidad: PostHog no emite sin `window` + token |
| `src/lib/printer/__tests__/escpos.test.ts` | 8 | Generación de buffer ESC/POS (init, corte, sanitizado de acentos) vía Web Serial mockeado |
| `src/lib/printer/__tests__/receipt.test.ts` | 5 | `buildReceiptData` (mapeo venta → ticket) |

El endpoint público `/api/catalog/orders` se valida en profundidad porque es la única superficie **anónima** que escribe: UUIDs mal formados, nombres/notas sobre el límite, carrito vacío, cantidades fuera de rango, y el rate-limiter in-memory (5 req/hora por `slug+IP`, 6ª → 429).

### Componentes — flujo de cobro (jsdom + RTL)

| Archivo | Tests | Foco |
|---|---|---|
| `src/components/pos/__tests__/PaymentModal.test.tsx` | 12 | Modal de cobro: efectivo/tarjeta/crédito, pago mixto, confirmación |
| `src/components/pos/__tests__/CartPanel.test.tsx` | 8 | Carrito: descuento, override de precio por línea, cantidad |

**PaymentModal** (la acción más consecuente del POS — cerrar una venta):
- Efectivo: el botón confirmar queda deshabilitado hasta que el monto cubre el total; muestra "Falta" / "Vuelto"; al confirmar manda `[{ method:'cash', amount }]`.
- Tarjeta/transferencia: habilita confirmar sin monto y manda el total completo.
- Crédito: oculto si el cliente no es apto; habilitado dentro del límite; bloqueado si el total lo supera.
- Pago mixto: exige ambos montos y que sumen ≥ total; manda dos pagos.
- Error del RPC → muestra el mensaje y **no** completa la venta (`onSaleCompleted` no se llama).

**CartPanel** (descuento + override de precio, lo que el usuario pidió cubrir):
- Descuento fijo y porcentual reflejados en el store y en los totales; el `%` se clampa a 100.
- El trigger de descuento y el de override de precio están **gateados por `permissions.price_override`** (no aparecen sin el permiso).
- Override de precio por línea → marca `priceIsManual` y recalcula el total de la línea.
- Controles de cantidad (+/−) actualizan el store.

Los componentes se testean con sus dependencias pesadas mockeadas (`createSaleTransaction`, `trackSale`, `supabase/client`, `next/navigation`, y los hijos `ReceiptPreviewModal`/`SalesHistoryPanel`), de modo que el test ejerce la **lógica del componente**, no la red ni la impresora.

## 4. Cobertura

Scope: `src/lib/**` + `src/app/api/**` (excluye componentes UI y tipos).

```
TOTAL   stmts 73.46%   branches 72.08%   lines 74.96%
```

Archivos **con tests** y su cobertura de líneas:

| Archivo | Líneas |
|---|---|
| `lib/price-lists.ts` | 100% |
| `lib/store/cart.store.ts` | 100% |
| `lib/validation.ts` · `format.ts` · `payments.ts` · `audit.ts` · `errors.ts` · `accent-colors.ts` · `business.ts` · `utils.ts` | 100% |
| `lib/api/_helpers.ts` · `lib/api/sales.ts` | 100% |
| `lib/inventory-products.ts` | 100% |
| `lib/constants/*` | 100% |
| `lib/printer/receipt.ts` | 100% |
| `lib/operator.ts` | 98.3% |
| `lib/date-utils.ts` | 98.4% |
| `lib/printer/escpos.ts` | 95.1% (ramas de error de hardware serial no simuladas) |
| `app/api/operator/logout/route.ts` | 100% |
| `app/api/catalog/orders/route.ts` | 95.1% |
| `app/api/operator/switch/route.ts` | 89.5% |
| `lib/analytics.ts` | 45% (solo el gating + eventos clave; el resto son wrappers idénticos) |

> Los **componentes** se miden por archivo, no en el agregado anterior (el scope de cobertura es `lib` + `api`). Cobertura de los dos componentes testeados: `PaymentModal.tsx` ≈ **70% líneas**, `CartPanel.tsx` ≈ **57% líneas**. Lo no cubierto en ellos es periférico al cobro: preview/impresión de ticket, búsqueda de cliente, producto libre y atajos de teclado.

## 5. Hallazgos durante el testeo

1. **Quirk de timezone en rangos custom de `getDateRange`.** Un string `YYYY-MM-DD` se parsea como **medianoche UTC** y luego `startOfDay`/`endOfDay` lo corren a la zona local (UTC-3), así que un rango que arranca "2026-01-01" en realidad empieza el **31/12/2025** local. Queda fijado en un test explícito (`date-utils.test.ts`). La versión basada en strings (`resolveDateRange`) **no** tiene este problema, por lo que el impacto se limita a rangos personalizados client-side. **Decisión pendiente del equipo:** ¿se considera bug a corregir (parsear como local) o comportamiento aceptado? No se modificó el código — la tarea era escribir tests.

2. Ningún test reveló bugs de lógica de precios/carrito/descuentos: los invariantes se cumplen como están documentados en `CLAUDE.md`.

## 6. Qué NO está cubierto (y por qué)

Intencionalmente fuera del scope de esta tanda:

- **Componentes React grandes** todavía sin tests: `InventoryPanel`, `NewProductModal`/`EditProductModal`, `VariantEditor`, `ImportProductsModal`, vistas de `stats`. El flujo de cobro (`PaymentModal`, `CartPanel`) **ya está cubierto** (§3).
- **Wrappers finos sobre SDKs/DOM** sin lógica propia: `lib/supabase/{client,server}.ts`, `lib/posthog-server.ts`, `lib/theme.ts` (View Transition sobre el DOM), `lib/context/CurrencyContext.tsx`.
- **Integraciones externas:** `lib/feedback/{github,telegram}.ts` y `app/api/feedback/route.ts` — candidatos a tests de integración con los servicios mockeados, no a unit tests puros.
- **Capa DB / RLS / RPC SECURITY DEFINER** — ya cubierta por los scripts SQL `05`–`10` y la auditoría `08`.

## 7. Próximos pasos sugeridos

1. **Más componentes** del catálogo/inventario: `InventoryPanel` (CRUD + bulk) y los modales de producto/variantes, reusando el harness jsdom ya montado.
2. **`app/api/feedback/route.ts`** con GitHub/Telegram mockeados.
3. **Integrar `npm test` en CI** (GitHub Actions) como gate de merge.
4. Definir qué hacer con el quirk de UTC-3 en rangos custom (§5.1).
