# Tests — Pulsar POS

Tests de regresión manual + scripts SQL automatizables para validar los flujos críticos antes de incorporar usuarios de alto volumen.

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
| `08-auditoria-seguridad.md` | Auditoría RLS + RPC SECURITY DEFINER + GRANTs (hallazgo crítico) | Resultados |

## Cómo ejecutar los tests SQL

Los tests en `05-db-automatizados.sql` se ejecutan directamente en el SQL Editor de Supabase (o vía MCP desde Claude Code). Cada bloque es independiente y muestra `PASS` o `FAIL` con el detalle del error.

## Decisión de diseño — stock negativo permitido

El POS permite vender con stock en 0 o negativo. Es una decisión explícita para no bloquear la velocidad de venta en almacenes de alto volumen, donde es común vender un producto antes de haberlo cargado al sistema. El stock negativo es una señal de mercadería pendiente de registrar, no un error.

## Convención de estado

- `[ ]` — pendiente
- `[x]` — pasó
- `[!]` — falló (anotar qué pasó)
