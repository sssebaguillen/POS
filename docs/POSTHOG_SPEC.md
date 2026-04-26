# POSTHOG_SPEC.md — Analytics de comportamiento

Spec de instrumentación con PostHog para Pulsar POS.  
Implementar en sesión de Claude Code junto con o después de P-CC1.

---

## Tool elegido: PostHog

**Por qué PostHog sobre Mixpanel u otras:**
- Open source — posibilidad de self-host en el futuro
- Plan cloud gratuito: 1M eventos/mes, sesiones de grabación incluidas
- SDK oficial para Next.js App Router (no requiere workarounds)
- Session replay + heatmaps sin configuración extra
- Compatible con feature flags (útil para rollout progresivo en P12+)

---

## Instalación

```bash
npm install posthog-js posthog-node
```

Provider en `app/(app)/layout.tsx`:

```typescript
// app/providers/PostHogProvider.tsx
'use client'
import posthog from 'posthog-js'
import { PostHogProvider as PHProvider } from 'posthog-js/react'
import { useEffect } from 'react'

export function PostHogProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    posthog.init(process.env.NEXT_PUBLIC_POSTHOG_KEY!, {
      api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST || 'https://app.posthog.com',
      capture_pageview: false, // manual — ver abajo
      capture_pageleave: true,
    })
  }, [])
  return <PHProvider client={posthog}>{children}</PHProvider>
}
```

Variables de entorno a agregar:
```
NEXT_PUBLIC_POSTHOG_KEY=phc_...
NEXT_PUBLIC_POSTHOG_HOST=https://app.posthog.com
```

---

## Identificación de usuarios

**Criterio: identificar por `business_id`, nunca por email ni nombre personal.**

```typescript
// En app/(app)/layout.tsx, después de cargar el perfil:
posthog.identify(businessId, {
  plan: 'beta',         // actualizar cuando haya planes
  region: 'latam',
  // NO incluir: email, nombre, teléfono, dirección
})
```

Esto agrupa todos los eventos de un mismo negocio, incluyendo diferentes operadores en el mismo dispositivo.

---

## Eventos a trackear

### Navegación

```typescript
// Pageview manual en cada ruta — en layout o en cada page.tsx
posthog.capture('$pageview', { $current_url: pathname })
```

### Ventas

| Evento | Cuándo | Propiedades |
|--------|--------|-------------|
| `sale_completed` | Al confirmar venta exitosa | `item_count`, `payment_methods[]`, `total_amount_range` (`0-1k`, `1k-10k`, `10k+`) |
| `sale_abandoned` | Al cerrar PaymentModal sin confirmar | `item_count`, `reason: 'modal_closed'` |
| `price_override_used` | Al aplicar override de precio en CartPanel | `reason` (el motivo seleccionado) |
| `sale_edited` | Al guardar edición de venta existente | — |
| `sale_deleted` | Al eliminar venta | — |

### Inventario

| Evento | Cuándo | Propiedades |
|--------|--------|-------------|
| `product_created` | Al guardar NewProductModal | `has_image`, `has_barcode`, `has_brand` |
| `product_edited` | Al guardar EditProductModal | campos modificados (array de strings) |
| `bulk_action_used` | Al ejecutar acción en bloque | `action` (`delete`, `category`, `brand`, `status`), `count` |
| `import_completed` | Al terminar importación CSV | `product_count`, `error_count` |
| `import_undone` | Al usar undo de importación | `product_count` |

### Gastos

| Evento | Cuándo | Propiedades |
|--------|--------|-------------|
| `expense_created` | Al guardar gasto exitoso | `category`, `has_supplier`, `has_attachment` |
| `mercaderia_expense_created` | Al guardar gasto de mercadería | `item_count`, `updated_costs_count`, `stock_updated` |
| `mercaderia_expense_abandoned` | Al cerrar modal con items cargados sin guardar | `item_count` |

### Onboarding

| Evento | Cuándo | Propiedades |
|--------|--------|-------------|
| `onboarding_step_completed` | Al completar un paso del wizard | `step_name`, `step_index` |
| `onboarding_step_skipped` | Al saltar un paso | `step_name`, `step_index` |
| `onboarding_completed` | Al terminar el wizard completo | `total_time_seconds` |
| `onboarding_mercaderia_started` | Al abrirse el tooltip de mercadería | — |
| `onboarding_mercaderia_completed` | Al cerrar el último tooltip | — |
| `onboarding_mercaderia_dismissed` | Al cerrar sin completar | `at_step: 0\|1\|2` |

### Operadores

| Evento | Cuándo | Propiedades |
|--------|--------|-------------|
| `operator_switched` | Al cambiar de operador con PIN | `role` del nuevo operador |
| `operator_created` | Al crear operador | `role` |

### Errores

```typescript
// En los catch blocks de acciones críticas:
posthog.capture('error_occurred', {
  context: 'sale_completion' | 'expense_save' | 'product_import' | ...,
  error_type: error.message,
})
```

---

## Eventos de tiempo en pantalla

PostHog captura `$pageleave` automáticamente con `capture_pageleave: true`. Para pantallas SPA (sin navegación real entre subrutas):

```typescript
// Hook personalizado para trackear tiempo activo en una sección
// Usar en ExpensesPanel, InventoryPanel, POSView, StatsView
useEffect(() => {
  const start = Date.now()
  return () => {
    posthog.capture('section_time_spent', {
      section: 'expenses' | 'inventory' | 'pos' | 'stats',
      seconds: Math.round((Date.now() - start) / 1000),
    })
  }
}, [])
```

---

## Privacy y compliance

- **No** capturar PII (nombres, emails, teléfonos, direcciones)
- **No** capturar montos exactos de ventas — usar rangos: `0-1k`, `1k-10k`, `10k+` en pesos
- **No** capturar contenido de campos de texto libre (notas, descripciones)
- Identificar negocios por `business_id` (UUID opaco) — no trazable a una persona sin acceso a la DB

PostHog cloud cumple GDPR. Para el mercado LATAM no hay requerimiento adicional en beta.

---

## Lo que habilita esto

**Corto plazo (beta):**
- Saber qué secciones se usan y cuáles se ignoran
- Detectar flujos que se abandonan (¿los usuarios crean gastos? ¿usan listas de precios?)
- Identificar errores que los usuarios no reportan

**Mediano plazo (post-beta):**
- Datos para priorizar el backlog con evidencia real
- Base de comportamiento para segmentar tipos de negocio

**Largo plazo (P12 — AI proactiva):**
- Los patrones de comportamiento informan qué insights son relevantes para cada negocio
- Detección de anomalías: si un negocio siempre vende 50 productos/día y hoy vendió 5, es una señal
