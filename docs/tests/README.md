# Tests — Pulsar POS

Tests de regresión manual + scripts SQL automatizables + **suite de tests unitarios automatizados (Vitest)** para validar los flujos críticos antes de incorporar usuarios de alto volumen.

## Estructura

| Archivo | Flujo | Tipo |
|---|---|---|
| `01-ventas.md` | Flujo de venta en el POS | Manual |
| `02-stock-mercaderia.md` | Stock y gastos de mercadería | Manual + SQL |
| `03-listas-precios.md` | Listas de precios y distribución | Manual |
| `04-caja.md` | Sesiones de caja y arqueo | Manual |
| `05-db-automatizados.sql` | Validaciones de capa DB | SQL (Supabase) |
| `06-reconciliacion.sql` | Integridad numérica sobre todo el dataset (cuentas que dan) | SQL (Supabase) |
| `07-stress-volumen.md` | Stress de volumen + aislamiento multi-tenant (resultados) | Resultados |
| `08-auditoria-seguridad.md` | Auditoría RLS + RPC SECURITY DEFINER + GRANTs + Storage + API/frontend | Resultados |
| `09-auditoria-calidad.md` | Auditoría de calidad de código (deuda, duplicación, dead code, tipos, convenciones) | Resultados |
| `10-stress-gastos.md` | Stress de gastos operativos + mercadería (mueven stock) + reconciliación E1–E5/R11 | Resultados |
| `11-tests-unitarios.md` | Suite Vitest: lógica de negocio (`lib/`) + API routes — cobertura, casos y hallazgos | Automatizado (Vitest) |

## Cómo ejecutar los tests unitarios (Vitest)

```bash
npm test          # corre toda la suite una vez (CI)
npm run test:watch  # modo watch (desarrollo)
npx vitest run --coverage   # con reporte de cobertura
```

Detalle completo de qué cubre cada archivo en `11-tests-unitarios.md`.

## Cómo ejecutar los tests SQL

Los tests en `05-db-automatizados.sql` se ejecutan directamente en el SQL Editor de Supabase (o vía MCP desde Claude Code). Cada bloque es independiente y muestra `PASS` o `FAIL` con el detalle del error.

## Decisión de diseño — stock negativo permitido

El POS permite vender con stock en 0 o negativo. Es una decisión explícita para no bloquear la velocidad de venta en almacenes de alto volumen, donde es común vender un producto antes de haberlo cargado al sistema. El stock negativo es una señal de mercadería pendiente de registrar, no un error.

## Convención de estado

- `[ ]` — pendiente
- `[x]` — pasó
- `[!]` — falló (anotar qué pasó)
