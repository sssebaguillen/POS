# Revisión de Estructura de Carpetas — PulsarPos

## 1. Resumen Ejecutivo

### Gravedad actual: MODERADA (6/10)

La arquitectura base es **sólida**. Los imports usan `@/` aliases, la separación Server/Client Components es correcta, y la estructura `app/components/lib/hooks` es la canónica de Next.js. No hay un caos estructural.

Sin embargo, hay **deuda técnica acumulada** que dificulta la escalabilidad:

| Problema | Impacto |
|----------|---------|
| 5 rutas/carpetas en español mezcladas con inglés | Confusión de naming, URLs inconsistentes |
| `components/analytics/` mezcla Dashboard y Stats | Acoplamiento innecesario entre módulos independientes |
| `components/stock/` vs `components/products/` split confuso | Lógica de productos fragmentada |
| `components/dashboard/` tiene sub-componentes de analytics | Dependencia cruzada (analytics importa de dashboard) |
| `GastosView.tsx` en español dentro de `expenses/` en inglés | Inconsistencia de naming dentro del mismo módulo |
| `sales/page.tsx` es un redirect vacío | Ruta muerta que ocupa espacio |
| Archivos >700 LOC sin descomponer | InventoryPanel (1345), CartPanel (1027), etc. |

### ¿Cuánto ganamos con la refactor?
- **Naming 100% consistente** en inglés (developer experience)
- **Módulos autocontenidos** que se entienden sin contexto externo
- **URLs limpias** (sin mezcla de idiomas en la barra de navegación)
- **Base escalable** para futuros módulos (CRM, reportes, facturación)
- **Onboarding más rápido** para nuevos devs

---

## 2. Estructura Actual vs Estructura Propuesta

### ESTRUCTURA ACTUAL
```
src/
├── app/
│   ├── (app)/
│   │   ├── dashboard/          ✅ OK
│   │   ├── gastos/             ❌ ESPAÑOL → expenses
│   │   ├── inventory/          ✅ OK
│   │   ├── operator-select/    ✅ OK
│   │   ├── pos/                ✅ OK
│   │   ├── price-lists/        ✅ OK
│   │   ├── products/           ✅ OK
│   │   ├── profile/            ✅ OK
│   │   ├── sales/              ⚠️ REDIRECT VACÍO (solo redirige a /dashboard)
│   │   ├── settings/           ✅ OK
│   │   ├── stats/
│   │   │   ├── breakdown/      ✅ OK
│   │   │   ├── metodos-pago/   ❌ ESPAÑOL → payment-methods
│   │   │   ├── operadores/     ❌ ESPAÑOL → operators
│   │   │   └── top-products/   ✅ OK
│   │   └── layout.tsx          ✅ OK
│   ├── (auth)/                 ✅ OK
│   ├── api/operator/           ✅ OK
│   └── catalogo/               ⚠️ ESPAÑOL (pero es URL pública — ver nota)
│       └── [slug]/
│
├── components/
│   ├── analytics/              ⚠️ MEZCLA Dashboard + Stats
│   │   ├── DashboardView.tsx      → debería estar en dashboard/
│   │   ├── StatsView.tsx          → debería estar en stats/
│   │   └── utils.ts               → compartido entre ambos
│   ├── catalogo/               ❌ ESPAÑOL → catalog
│   ├── dashboard/              ⚠️ Sub-componentes importados por analytics/
│   │   ├── BalanceWidget.tsx
│   │   └── SalesHistoryTable.tsx
│   ├── expenses/               ✅ Carpeta en inglés
│   │   └── GastosView.tsx      ❌ ESPAÑOL → ExpensesView.tsx
│   ├── operator/               ✅ OK
│   ├── pos/                    ✅ OK
│   ├── price-lists/            ✅ OK
│   ├── products/               ⚠️ Solo tiene ProductsPanel (1 archivo)
│   ├── profile/                ✅ OK
│   ├── sales/                  ❌ CARPETA VACÍA
│   ├── settings/               ✅ OK
│   ├── shared/                 ✅ OK
│   ├── stats/                  ✅ OK
│   ├── stock/                  ⚠️ Nombre confuso (es inventario/productos)
│   ├── ui/                     ✅ OK
│   └── sidebar.tsx             ✅ OK (archivo suelto está bien aquí)
│
├── hooks/                      ✅ OK
├── lib/                        ✅ OK
└── proxy.ts                    ✅ OK (no es middleware.ts — es importado por middleware)
```

### ESTRUCTURA PROPUESTA
```
src/
├── app/
│   ├── (app)/
│   │   ├── dashboard/          ✅ sin cambios
│   │   ├── expenses/           🔄 renombrado de gastos/
│   │   ├── inventory/          ✅ sin cambios
│   │   ├── operator-select/    ✅ sin cambios
│   │   ├── pos/                ✅ sin cambios
│   │   ├── price-lists/        ✅ sin cambios
│   │   ├── products/           ✅ sin cambios
│   │   ├── profile/            ✅ sin cambios
│   │   ├── settings/           ✅ sin cambios
│   │   ├── stats/
│   │   │   ├── breakdown/      ✅ sin cambios
│   │   │   ├── payment-methods/ 🔄 renombrado de metodos-pago/
│   │   │   ├── operators/      🔄 renombrado de operadores/
│   │   │   └── top-products/   ✅ sin cambios
│   │   └── layout.tsx
│   ├── (auth)/                 ✅ sin cambios
│   ├── api/operator/           ✅ sin cambios
│   └── catalog/                🔄 renombrado de catalogo/ (ver nota abajo)
│       └── [slug]/
│
├── components/
│   ├── catalog/                🔄 renombrado de catalogo/
│   ├── dashboard/              🔄 CONSOLIDADO — absorbe DashboardView + utils
│   │   ├── DashboardView.tsx      ← movido de analytics/
│   │   ├── BalanceWidget.tsx      (ya estaba aquí)
│   │   ├── SalesHistoryTable.tsx  (ya estaba aquí)
│   │   └── utils.ts               ← movido de analytics/ (funciones compartidas)
│   ├── expenses/
│   │   └── ExpensesView.tsx    🔄 renombrado de GastosView.tsx
│   ├── inventory/              🔄 renombrado de stock/
│   ├── operator/               ✅ sin cambios
│   ├── pos/                    ✅ sin cambios
│   ├── price-lists/            ✅ sin cambios
│   ├── products/               ✅ sin cambios
│   ├── profile/                ✅ sin cambios
│   ├── settings/               ✅ sin cambios
│   ├── shared/                 ✅ sin cambios
│   ├── stats/                  🔄 CONSOLIDADO — absorbe StatsView
│   │   ├── StatsView.tsx          ← movido de analytics/
│   │   ├── BreakdownDetailView.tsx
│   │   ├── OperatorSalesDetailView.tsx
│   │   ├── PaymentMethodDetailView.tsx
│   │   └── TopProductsDetailView.tsx
│   ├── ui/                     ✅ sin cambios
│   └── sidebar.tsx             ✅ sin cambios
│
├── hooks/                      ✅ sin cambios
├── lib/                        ✅ sin cambios
└── proxy.ts                    ✅ sin cambios
```

### NOTA SOBRE `catalogo/` → `catalog/`
La ruta `/catalogo/[slug]` es una **URL pública** que los negocios comparten con clientes.
Si ya hay negocios en producción compartiendo links tipo `tudominio.com/catalogo/mi-tienda`,
renombrar rompe esos links.

**Opciones:**
- **A) Renombrar + redirect** — crear un redirect permanente de `/catalogo/*` → `/catalog/*` en middleware
- **B) Mantener `/catalogo/`** — es la única excepción justificada (URL pública para mercado LATAM)

**Recomendación:** Opción B — mantener `catalogo/` en la ruta de app/ (es user-facing y tiene sentido en español para el mercado). Pero sí renombrar `components/catalogo/` → `components/catalog/` (eso es interno, no user-facing).

---

## 3. Movimientos y Renombrados Concretos

### FASE 1: Renombrados de componentes (0 impacto en URLs)

| # | Actual | Nuevo | Archivos que importan (actualizar) |
|---|--------|-------|------------------------------------|
| 1 | `components/expenses/GastosView.tsx` | `components/expenses/ExpensesView.tsx` | `app/(app)/gastos/page.tsx` (1 import) |
| 2 | `components/catalogo/` | `components/catalog/` | `app/catalogo/layout.tsx`, `app/catalogo/[slug]/page.tsx`, + 6 imports internos |
| 3 | `components/stock/` | `components/inventory/` | `app/(app)/inventory/page.tsx`, `components/products/ProductsPanel.tsx`, + 10 imports internos |
| 4 | `components/analytics/DashboardView.tsx` | `components/dashboard/DashboardView.tsx` | `app/(app)/dashboard/page.tsx` (1 import) |
| 5 | `components/analytics/StatsView.tsx` | `components/stats/StatsView.tsx` | `app/(app)/stats/page.tsx` (1 import) |
| 6 | `components/analytics/utils.ts` | `components/dashboard/utils.ts` | `components/dashboard/DashboardView.tsx`, `components/stats/StatsView.tsx` (2 imports) |
| 7 | Eliminar `components/analytics/` | (vacía después de mover) | — |
| 8 | Eliminar `components/sales/` | (carpeta vacía) | — |

### FASE 2: Renombrados de rutas (cambian URLs)

| # | Actual | Nuevo | Referencias a actualizar |
|---|--------|-------|--------------------------|
| 9 | `app/(app)/gastos/` | `app/(app)/expenses/` | `proxy.ts` (1 ref), `sidebar.tsx` (2 refs), `components/dashboard/BalanceWidget.tsx` (1 link) |
| 10 | `app/(app)/stats/metodos-pago/` | `app/(app)/stats/payment-methods/` | `components/stats/StatsView.tsx` (1 link) |
| 11 | `app/(app)/stats/operadores/` | `app/(app)/stats/operators/` | Ninguna referencia directa (no hay links a esta ruta en código) |
| 12 | Eliminar `app/(app)/sales/` | (redirect muerto) | Ninguna referencia |

### FASE 3: Renombrado público (opcional — ver nota catalogo)

| # | Actual | Nuevo | Referencias a actualizar |
|---|--------|-------|--------------------------|
| 13 | `app/catalogo/` | Mantener (URL pública LATAM) | — |

---

## 4. Plan de Migración Paso a Paso

### Pre-requisitos
```bash
# 1. Asegurar branch limpio
git checkout -b refactor/folder-structure
git status  # debe estar limpio

# 2. Verificar que build actual funciona
npm run build
```

### PASO 1 — Renombrar componentes internos (RIESGO: BAJO)
Estos cambios NO afectan URLs. Solo renombran archivos/carpetas de componentes.

```bash
# 1a. GastosView → ExpensesView
git mv src/components/expenses/GastosView.tsx src/components/expenses/ExpensesView.tsx

# 1b. catalogo/ → catalog/ (componentes, NO la ruta de app/)
git mv src/components/catalogo src/components/catalog

# 1c. stock/ → inventory/
git mv src/components/stock src/components/inventory

# 1d. Mover DashboardView a dashboard/
git mv src/components/analytics/DashboardView.tsx src/components/dashboard/DashboardView.tsx

# 1e. Mover StatsView a stats/
git mv src/components/analytics/StatsView.tsx src/components/stats/StatsView.tsx

# 1f. Mover utils.ts a dashboard/ (principal consumidor)
git mv src/components/analytics/utils.ts src/components/dashboard/utils.ts

# 1g. Eliminar analytics/ (ya vacía) y sales/ (vacía)
rmdir src/components/analytics
rmdir src/components/sales
```

**Actualizar imports después de PASO 1:**

Archivos a editar (buscar y reemplazar):

| Buscar | Reemplazar | Archivos afectados |
|--------|------------|---------------------|
| `@/components/expenses/GastosView` | `@/components/expenses/ExpensesView` | `app/(app)/gastos/page.tsx` |
| `@/components/catalogo/` | `@/components/catalog/` | 8 archivos (layout, page, y 6 componentes internos) |
| `@/components/stock/` | `@/components/inventory/` | ~15 archivos (page, ProductsPanel, + internos) |
| `@/components/analytics/DashboardView` | `@/components/dashboard/DashboardView` | `app/(app)/dashboard/page.tsx` |
| `@/components/analytics/StatsView` | `@/components/stats/StatsView` | `app/(app)/stats/page.tsx` |
| `@/components/analytics/utils` | `@/components/dashboard/utils` | `DashboardView.tsx`, `StatsView.tsx` |

**Herramienta recomendada para actualizar imports automáticamente:**
```bash
# Usar sed para reemplazos masivos (macOS)
find src -type f \( -name "*.ts" -o -name "*.tsx" \) -exec sed -i '' \
  's|@/components/expenses/GastosView|@/components/expenses/ExpensesView|g' {} +

find src -type f \( -name "*.ts" -o -name "*.tsx" \) -exec sed -i '' \
  's|@/components/catalogo/|@/components/catalog/|g' {} +

find src -type f \( -name "*.ts" -o -name "*.tsx" \) -exec sed -i '' \
  's|@/components/stock/|@/components/inventory/|g' {} +

find src -type f \( -name "*.ts" -o -name "*.tsx" \) -exec sed -i '' \
  's|@/components/analytics/DashboardView|@/components/dashboard/DashboardView|g' {} +

find src -type f \( -name "*.ts" -o -name "*.tsx" \) -exec sed -i '' \
  's|@/components/analytics/StatsView|@/components/stats/StatsView|g' {} +

find src -type f \( -name "*.ts" -o -name "*.tsx" \) -exec sed -i '' \
  's|@/components/analytics/utils|@/components/dashboard/utils|g' {} +
```

**Verificar:**
```bash
npm run lint && npm run build
git add -A && git commit -m "refactor: rename component folders to consistent English names"
```

### PASO 2 — Renombrar rutas (RIESGO: MEDIO)
Estos cambios SÍ cambian las URLs. Hay que actualizar sidebar, proxy, y links internos.

```bash
# 2a. gastos/ → expenses/
git mv src/app/\(app\)/gastos src/app/\(app\)/expenses

# 2b. metodos-pago/ → payment-methods/
git mv src/app/\(app\)/stats/metodos-pago src/app/\(app\)/stats/payment-methods

# 2c. operadores/ → operators/
git mv src/app/\(app\)/stats/operadores src/app/\(app\)/stats/operators

# 2d. Eliminar sales/ (redirect muerto)
rm src/app/\(app\)/sales/page.tsx
rmdir src/app/\(app\)/sales
```

**Actualizar referencias de rutas:**

| Archivo | Cambio |
|---------|--------|
| `src/proxy.ts` | `/gastos` → `/expenses` |
| `src/components/sidebar.tsx` | `href: '/gastos'` → `href: '/expenses'` + `hrefs: ['/gastos']` → `hrefs: ['/expenses']` |
| `src/components/dashboard/BalanceWidget.tsx` | `href="/gastos"` → `href="/expenses"` |
| `src/components/stats/StatsView.tsx` | `href="/stats/metodos-pago"` → `href="/stats/payment-methods"` |
| `src/app/(app)/expenses/page.tsx` | Renombrar función `GastosPage` → `ExpensesPage` |
| `src/app/(app)/stats/payment-methods/page.tsx` | Renombrar función `MetodosPagoDetailPage` → `PaymentMethodsDetailPage` |
| `src/app/(app)/stats/operators/page.tsx` | Renombrar función `OperadoresDetailPage` → `OperatorsDetailPage` |

```bash
# Reemplazos masivos
find src -type f \( -name "*.ts" -o -name "*.tsx" \) -exec sed -i '' \
  "s|'/gastos'|'/expenses'|g" {} +

find src -type f \( -name "*.ts" -o -name "*.tsx" \) -exec sed -i '' \
  "s|/stats/metodos-pago|/stats/payment-methods|g" {} +
```

**Verificar:**
```bash
npm run lint && npm run build
git add -A && git commit -m "refactor: rename Spanish route paths to English"
```

### PASO 3 — Verificación final

```bash
# Buscar cualquier referencia residual en español
grep -rn "gastos\|catalogo\|metodos-pago\|operadores\|GastosView\|/stock/" src \
  --include="*.ts" --include="*.tsx" | grep -v node_modules

# Build completo
npm run build

# Verificar que no quedaron carpetas vacías
find src -type d -empty
```

---

## 5. Recomendaciones Adicionales

### 5.1. Archivos grandes que deberían descomponerse (futuro)

Estos archivos exceden los ~150 LOC recomendados. No es urgente pero es deuda técnica:

| Archivo | LOC | Recomendación |
|---------|-----|---------------|
| `InventoryPanel.tsx` | 1345 | Extraer: `InventoryTable`, `InventoryToolbar`, `InventorySearch` |
| `CartPanel.tsx` (POS) | 1027 | Extraer: `CartItemList`, `CartSummary`, `CartActions` |
| `ImportProductsModal.tsx` | 763 | Extraer: `ImportPreviewTable`, `ImportMappingStep` |
| `EditProductModal.tsx` | 725 | Extraer: `ProductForm` compartido con NewProductModal |
| `NewProductModal.tsx` | 702 | Compartir `ProductForm` con EditProductModal |
| `StatsView.tsx` | 623 | Extraer: `RevenueChart`, `SalesMetrics`, `StatsCards` |
| `SalesHistoryTable.tsx` | 606 | Extraer: `SaleRow`, `EditSalePanel` |
| `PriceListsPanel.tsx` | 590 | Extraer: `PriceListTable`, `OverridesList` |

### 5.2. NO recomiendo barrel files (index.ts)

Para un proyecto de este tamaño, barrel files:
- Dificultan tree-shaking
- Causan circular imports difíciles de debuggear
- No aportan valor real con el alias `@/` ya configurado

El único barrel file existente (`lib/types/index.ts`) está bien porque agrupa tipos puros.

### 5.3. NO recomiendo feature-based routing (aún)

Mover componentes dentro de `app/(app)/dashboard/_components/` es un patrón válido pero:
- Requiere mover TODOS los módulos a la vez para ser consistente
- Rompe el patrón actual que funciona bien
- El proyecto no es lo suficientemente grande para justificar el cambio

El patrón actual (`app/` para rutas, `components/` para UI) es perfectamente escalable hasta ~200-300 archivos.

### 5.4. Aliases adicionales — NO necesarios

El alias `@/` → `src/` ya cubre todos los casos. No agregar más aliases.

### 5.5. `.DS_Store` cleanup

```bash
# Agregar a .gitignore si no está
echo ".DS_Store" >> .gitignore

# Eliminar de tracking
git rm --cached -r \*\*/.DS_Store 2>/dev/null
find . -name ".DS_Store" -delete
```

---

## Estado: COMPLETADO

Branch: `refactor/folder-structure` (2 commits sobre master)

## Resumen de Riesgo por Fase

| Fase | Cambios | Riesgo | Tiempo estimado |
|------|---------|--------|-----------------|
| Fase 1: Renombrar componentes | 6 movimientos + imports | BAJO | — |
| Fase 2: Renombrar rutas | 3 rutas + refs en sidebar/proxy | MEDIO | — |
| Fase 3: Verificación | Build + grep | NINGUNO | — |

**Riesgo principal:** Olvidar actualizar una referencia en `proxy.ts` o `sidebar.tsx` → la ruta devuelve 404 o no aplica permisos.

**Mitigación:** Los comandos `sed` cubren el 100% de las referencias. El `npm run build` de TypeScript detectará imports rotos. Un `grep` final confirma que no quedan referencias en español.
